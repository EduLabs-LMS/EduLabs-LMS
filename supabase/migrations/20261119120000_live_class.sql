-- Live online classes: the "EduLabs class" (self-hosted Jitsi, docs/ai/ONLINE_CLASS_RUNBOOK.md). DRAFT: not applied anywhere.
-- Applied after 20261118120000_reports_last_4_weeks.sql; no earlier migration is edited. Resolves the caller with private.current_app_user_id(),
-- never auth.uid(). create or replace keeps the existing grants. The owner's answers are in docs/ai/ONLINE_CLASS_AUDIT.md, section 6.
--
-- 1. Which Sessions are an EduLabs class. No new column: an ONLINE Session with NO link is an EduLabs class; an online Session with a link is
--    "Own link" and works as before. This is exactly the owner's rule: existing online Groups with a link stay "Own link", online Groups
--    without a link become "EduLabs class", and a new online Group is an EduLabs class unless the teacher pastes a link. A Session copies its
--    Group's link like today (materialization, one-off, reschedule, "apply to future sessions"), so nothing in group_command or group_view
--    changes. When the server is not configured (LIVE_CLASS_* missing on the web server), the API and every button are hidden.
-- 2. Two private tables. live_class_rooms: one row per Session once a teacher or assistant pressed Start class (the random room name, who and
--    when). live_class_joins: who opened the class from EduLabs (a token was issued), first/last time and how often. A row means "opened the
--    class from EduLabs", not proof of being connected. Both go with their Session (ON DELETE CASCADE): Sessions are only ever deleted by the
--    demo Clear, and the rows are the teacher's and the demo students' own.
-- 3. private.live_class_open(session, start): the one door. Staff of the Group (private.can_manage_group: owner, instructor, the Group's
--    assistants) and the Group's current students (private.can_view_group) only; anyone else gets 42501 "Session unavailable" (no hint that
--    it exists). Window: 15 minutes before the start to 30 minutes after the end. A cancelled Session or an archived Group is closed.
--    A student gets no room until staff started the class ("waiting"). Staff press Start class (start=true): the room is created once,
--    the Group's students get "Your class has started" once, and it is written to the Group audit. Opening the class records a join row.
--    It NEVER writes attendance (owner's answer 3).
-- 4. private.live_class_joined(session): for the Group's staff, who opened the class. Take attendance uses it to show "Joined online" and to
--    save the joined students who are still not marked as Present with the existing attendance save, as the teacher.
-- 5. Notifications. A new type class_started ("Your class has started", own In-app and Push switches): both event_type checks widen. It is
--    current while the class can be joined (until 30 minutes after the end) and links to /class/<session>. EduLabs class Sessions now also get
--    the existing "starts soon" reminder (session_starting, linking to /class/<session>) and the existing per-Session notices when a Session is
--    added, moved, cancelled or restored (session_details). The Group-level "joining details" notice still needs a link (there is nothing to
--    join before the class starts): private.group_notice_upcoming is unchanged. Functions replaced, each the same body with the lines marked
--    "live class": notification_current, notification_link, emit_session_notice, notification_business_event, notification_worker.
-- 6. Demo seed version 9 (module live_class, docs/ai/DEMO_DATA.md): Demo Group 2's draft earlier Session was an EduLabs class that students
--    joined, and a new Group 2 Session starts 5 minutes after the fill so the teacher can press Start class. demo_fill_core is version 8
--    (20261116120000) with that block added before the version is stored.
begin;

-- ---------------------------------------------------------------------------------------
-- 2. Tables (private; no table grant, no policy: only the functions below read and write them).
-- ---------------------------------------------------------------------------------------
create table private.live_class_rooms (
 session_id uuid primary key references public.group_sessions(id) on delete cascade,
 room text not null unique check(room ~ '^[0-9a-f]{64}$'),
 started_at timestamptz not null default clock_timestamp(),
 started_by uuid not null references public.profiles(id) on delete restrict
);
create index live_class_rooms_started_by on private.live_class_rooms(started_by);
create table private.live_class_joins (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.group_sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 staff boolean not null,
 first_at timestamptz not null default clock_timestamp(), last_at timestamptz not null default clock_timestamp(),
 joins integer not null default 1 check(joins between 1 and 1000),
 unique(session_id,user_id), check(last_at>=first_at)
);
create index live_class_joins_user on private.live_class_joins(user_id);
alter table private.live_class_rooms enable row level security;
alter table private.live_class_joins enable row level security;
revoke all on private.live_class_rooms,private.live_class_joins from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. The new notification type.
-- ---------------------------------------------------------------------------------------
alter table public.notification_preferences drop constraint notification_preferences_event_type_check;
alter table public.notification_preferences add constraint notification_preferences_event_type_check check(event_type in
 ('account_approved','lesson_published','session_details','session_starting','exam_released','homework_released','support_reply','class_started'));
alter table private.notification_events drop constraint notification_events_event_type_check;
alter table private.notification_events add constraint notification_events_event_type_check check(event_type in
 ('account_approved','lesson_published','session_details','session_starting','exam_released','homework_released','support_reply','class_started'));

-- "Your class has started": once per Session (the event key), to the Group's current students. In-app/Push preferences apply as for every type.
create function private.emit_class_started(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.group_sessions; org uuid; users uuid[]; k text:='class-started:'||p_session;
begin
 select * into s from public.group_sessions where id=p_session;
 if s.id is null then return; end if;
 select c.organization_id into org from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where g.id=s.group_id;
 select array_agg(distinct m.user_id order by m.user_id) into users from public.group_memberships m
  where m.group_id=s.group_id and m.ends_at is null and private.group_notice_recipient(s.group_id,m.user_id);
 perform private.emit_notification(k,'class_started',org,s.group_id,users);
 update private.notification_events set session_id=s.id where event_key=k and session_id is null;
end $$;
revoke all on function private.emit_class_started(uuid) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- 3. Open (and start) a class.
-- ---------------------------------------------------------------------------------------
create function private.live_class_open(p_session uuid,p_start boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.current_app_user_id(); s public.group_sessions; g public.study_groups; staff boolean; r private.live_class_rooms;
 opens timestamptz; closes timestamptz; base jsonb; who text; fresh boolean:=false;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_session is null or p_start is null then raise exception 'Session unavailable' using errcode='42501'; end if;
 -- Shared lock: a cancel, move or "apply to future sessions" (group_command takes the Session FOR UPDATE) waits for this, and this sees its result.
 select * into s from public.group_sessions where id=p_session for share;
 if s.id is null then raise exception 'Session unavailable' using errcode='42501'; end if;
 select * into g from public.study_groups where id=s.group_id;
 staff:=private.can_manage_group(g.id);
 if not staff and not private.can_view_group(g.id) then raise exception 'Session unavailable' using errcode='42501'; end if;
 if s.mode<>'online' or s.join_url<>'' then raise exception 'Not an EduLabs class' using errcode='23514'; end if;
 opens:=s.starts_at-interval '15 minutes'; closes:=s.ends_at+interval '30 minutes';
 base:=jsonb_build_object('sessionId',s.id,'groupId',g.id,'title',s.title,'groupName',g.name,'startsAt',s.starts_at,'endsAt',s.ends_at,
  'opensAt',opens,'closesAt',closes,'serverNow',clock_timestamp(),'staff',staff);
 if s.cancelled or g.status<>'active' then return base||jsonb_build_object('state','cancelled'); end if;
 if clock_timestamp()<opens then return base||jsonb_build_object('state','early'); end if;
 if clock_timestamp()>=closes then return base||jsonb_build_object('state','ended'); end if;
 select * into r from private.live_class_rooms where session_id=s.id;
 if r.session_id is null then
  if not staff then return base||jsonb_build_object('state','waiting'); end if;
  if not p_start then return base||jsonb_build_object('state','ready'); end if;
  insert into private.live_class_rooms(session_id,room,started_by)
   values(s.id,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),u)
   on conflict(session_id) do nothing returning * into r;
  if r.session_id is not null then
   fresh:=true;
   perform private.emit_class_started(s.id);
   insert into private.group_audit(group_id,session_id,actor_id,action,after_data) values(g.id,s.id,u,'live_class_start',jsonb_build_object('startedAt',r.started_at));
  else
   select * into r from private.live_class_rooms where session_id=s.id;
  end if;
 end if;
 insert into private.live_class_joins(session_id,user_id,staff) values(s.id,u,staff)
  on conflict(session_id,user_id) do update set last_at=greatest(live_class_joins.last_at,clock_timestamp()),joins=least(live_class_joins.joins+1,1000),staff=excluded.staff;
 select display_name into who from public.profiles where id=u;
 return base||jsonb_build_object('state','open','room',r.room,'moderator',staff,'displayName',coalesce(nullif(btrim(who),''),'EduLabs'),
  'startedAt',r.started_at,'startedNow',fresh);
end $$;
revoke all on function private.live_class_open(uuid,boolean) from public,anon;
grant execute on function private.live_class_open(uuid,boolean) to authenticated;
create function public.live_class_open(p_session uuid,p_start boolean default false) returns jsonb language sql security invoker set search_path='' as $$select private.live_class_open(p_session,p_start)$$;
revoke all on function public.live_class_open(uuid,boolean) from public,anon;
grant execute on function public.live_class_open(uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 4. Who opened the class (the Group's staff only). Students' ids only, ordered; no times or counts leave the database.
-- ---------------------------------------------------------------------------------------
create function private.live_class_joined(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.group_sessions;
begin
 if private.current_app_user_id() is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into s from public.group_sessions where id=p_session;
 if s.id is null or not private.can_manage_group(s.group_id) then raise exception 'Session unavailable' using errcode='42501'; end if;
 return jsonb_build_object('sessionId',s.id,'liveClass',s.mode='online' and s.join_url='',
  'startedAt',(select r.started_at from private.live_class_rooms r where r.session_id=s.id),
  'joined',coalesce((select jsonb_agg(j.user_id order by j.user_id) from private.live_class_joins j where j.session_id=s.id and not j.staff),'[]'::jsonb));
end $$;
revoke all on function private.live_class_joined(uuid) from public,anon;
grant execute on function private.live_class_joined(uuid) to authenticated;
create function public.live_class_joined(p_session uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.live_class_joined(p_session)$$;
revoke all on function public.live_class_joined(uuid) from public,anon;
grant execute on function public.live_class_joined(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- 5. Notification functions: 20261015185510 bodies, live class lines marked.
-- ---------------------------------------------------------------------------------------
create or replace function private.notification_current(p_event uuid,p_user uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare e private.notification_events;s public.group_sessions;
begin
 select * into e from private.notification_events where id=p_event;
 if e.id is null or e.revoked_at is not null then return false;end if;
 if e.event_type not in ('session_details','session_starting','class_started') then return true;end if; -- live class: class_started
 if not private.group_notice_recipient(e.resource_id,p_user) then return false;end if;
 if e.session_id is null then return e.event_type='session_details' and e.context_hash=private.group_notice_hash(e.resource_id) and private.group_notice_upcoming(e.resource_id);end if;
 select * into s from public.group_sessions where id=e.session_id and group_id=e.resource_id;
 -- live class: "Your class has started" while the class can be joined.
 if e.event_type='class_started' then
  return coalesce(s.id is not null and not s.cancelled and s.mode='online' and s.join_url='' and clock_timestamp()<s.ends_at+interval '30 minutes'
  and exists(select 1 from private.live_class_rooms r where r.session_id=s.id),false);
 end if;
 -- live class: no "s.join_url<>''" any more (an EduLabs class Session has no link).
 return coalesce(s.id is not null and not s.cancelled and s.mode='online' and s.starts_at>clock_timestamp()
 and e.context_hash=private.session_notice_hash(s.id),false);
end $$;

create or replace function private.emit_session_notice(p_key text,p_type text,p_group uuid,p_session uuid,p_users uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;fingerprint text;
begin
 select c.organization_id into org from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where g.id=p_group;
 select array_agg(distinct x order by x) into p_users from unnest(coalesce(p_users,'{}'::uuid[])) x where private.group_notice_recipient(p_group,x);
 if coalesce(cardinality(p_users),0)=0 then return;end if;
 if p_session is null then
  if not private.group_notice_upcoming(p_group) then return;end if;
  fingerprint:=private.group_notice_hash(p_group);
 else
  -- live class: no "s.join_url<>''" any more.
  if not exists(select 1 from public.group_sessions s where s.id=p_session and s.group_id=p_group and s.mode='online' and not s.cancelled and s.starts_at>clock_timestamp()) then return;end if;
  fingerprint:=private.session_notice_hash(p_session);
 end if;
 perform private.emit_notification(p_key,p_type,org,p_group,p_users);
 update private.notification_events set session_id=p_session,context_hash=fingerprint where event_key=p_key and revoked_at is null and context_hash is null;
end $$;

-- notification_business_event: 20261018100132 body, one line changed (marked).
create or replace function private.notification_business_event() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;resource uuid;kind text;recipients uuid[];key text;item record;lesson public.lessons;
begin
 if tg_table_name='courses' then
  if new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new;end if;
  select array_agg(distinct e.user_id) into recipients from public.enrollments e join public.course_offerings o on o.id=e.offering_id where o.course_id=new.id and o.status='active' and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp());
  for item in select l.id from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=new.id and l.status='published' loop
   perform private.emit_notification('course-publish:'||new.id||':'||new.updated_at||':'||item.id,'lesson_published',new.organization_id,item.id,recipients);
  end loop;return new;
 elsif tg_table_name='lesson_segments' then
  if new.status<>'published' or (tg_op='UPDATE' and old.status='published') or (select count(*) from public.lesson_segments where lesson_id=new.lesson_id and status='published')<>1 then return new;end if;
  select * into lesson from public.lessons where id=new.lesson_id and status='published';if lesson.id is null then return new;end if;
  select c.organization_id into org from public.course_modules m join public.courses c on c.id=m.course_id where m.id=lesson.module_id and c.status='published';if org is null then return new;end if;
  select array_agg(distinct e.user_id) into recipients from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.course_modules m on m.course_id=o.course_id where m.id=lesson.module_id and o.status='active' and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp());
  kind:='lesson_published';resource:=lesson.id;key:='lesson:'||lesson.id||':'||lesson.updated_at;
 elsif tg_table_name='enrollments' then
  if new.status<>'active' or (tg_op='UPDATE' and old.status='active') then return new;end if;
  select c.organization_id into org from public.course_offerings o join public.courses c on c.id=o.course_id where o.id=new.offering_id;
  kind:='account_approved';resource:=new.id;recipients:=array[new.user_id];key:='enrollment:'||new.id||':'||new.updated_at;
 elsif tg_table_name='lessons' then
  if new.status<>'published' or (tg_op='UPDATE' and old.status='published') then return new;end if;
  select c.organization_id into org from public.course_modules m join public.courses c on c.id=m.course_id where m.id=new.module_id and c.status='published';
  if org is null then return new;end if;
  select array_agg(distinct e.user_id) into recipients from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.course_modules m on m.course_id=o.course_id where m.id=new.module_id and o.status='active' and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp());
  kind:='lesson_published';resource:=new.id;key:='lesson:'||new.id||':'||new.updated_at;
 elsif tg_table_name='assessment_participations' then
  if new.released_at is null or (tg_op='UPDATE' and old.released_at is not distinct from new.released_at) then return new;end if;
  select c.organization_id into org from public.offering_assessments a join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=o.course_id where a.id=new.schedule_id;
  kind:='exam_released';resource:=new.schedule_id;recipients:=array[new.user_id];key:='exam:'||new.id||':'||new.released_at;
 elsif tg_table_name='homework_corrections' then
  if new.released_at is null or (tg_op='UPDATE' and old.released_at is not distinct from new.released_at) then return new;end if;
  select c.organization_id,array[s.user_id] into org,recipients from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=o.course_id where s.id=new.submission_id;
  kind:='homework_released';resource:=new.submission_id;key:='homework:'||new.submission_id||':'||new.released_at;
 elsif tg_table_name='study_groups' then
  if tg_op='UPDATE' and (old.mode,old.join_url,old.instructions,old.status) is not distinct from (new.mode,new.join_url,new.instructions,new.status) then return new;end if;
  perform private.revoke_session_notices(new.id,null);
  perform private.emit_group_joining_notice(new.id);return new;
 elsif tg_table_name='group_memberships' then
  if new.ends_at is null then perform private.emit_group_joining_notice(new.group_id,new.user_id);end if;return new;
 elsif tg_table_name='group_sessions' then
  if tg_op='UPDATE' then
   if (old.starts_at,old.ends_at,old.mode,old.join_url,old.instructions,old.cancelled) is not distinct from (new.starts_at,new.ends_at,new.mode,new.join_url,new.instructions,new.cancelled) then return new;end if;
   perform private.revoke_session_notices(new.group_id,new.id);
  end if;
  -- live class: an online Session with no link (an EduLabs class) gets the per-Session notices too. The Group-level joining notice below still
  -- needs a link: private.emit_group_joining_notice stops at private.group_notice_upcoming, which is unchanged.
  if new.mode<>'online' or new.cancelled or new.starts_at<=clock_timestamp() then return new;end if;
  if tg_op='UPDATE' and new.schedule_id is not null and not new.exception and (old.starts_at,old.ends_at) is not distinct from (new.starts_at,new.ends_at) then
   -- A defaults-only change uses the existing bounded, recipient-aware group
   -- announcement revision. It must not announce every 90-day occurrence.
   if new.starts_at<=clock_timestamp()+interval '14 days' then perform private.emit_group_joining_notice(new.group_id);end if;return new;
  end if;
  if tg_op='INSERT' and new.schedule_id is not null and not new.exception then
   -- Materialization is silent per occurrence. At most one joining summary per
   -- recipient/revision is created, and only for the next 14 days.
   if new.starts_at<=clock_timestamp()+interval '14 days' then perform private.emit_group_joining_notice(new.group_id);end if;return new;
  end if;
  select array_agg(distinct m.user_id) into recipients from public.group_memberships m where m.group_id=new.group_id and private.group_notice_recipient(new.group_id,m.user_id);
  perform private.emit_session_notice('session:'||new.id||':'||new.version||':'||private.session_notice_hash(new.id),'session_details',new.group_id,new.id,recipients);return new;
 end if;
 if kind is not null then perform private.emit_notification(key,kind,org,resource,recipients);end if;return new;
end $$;

-- notification_worker: 20261015185510 body, one condition removed (marked).
create or replace function private.notification_worker(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare session_row record;d private.notification_deliveries;recipient uuid[];result jsonb;
begin
 if p_action in ('claim','sweep') then
  for session_row in select x.* from public.group_sessions x join public.study_groups g on g.id=x.group_id
  where x.mode='online' and not x.cancelled and g.status='active' -- live class: no "x.join_url<>''": an EduLabs class Session gets the reminder too
  and x.starts_at between clock_timestamp() and clock_timestamp()+interval '15 minutes'
  and exists(select 1 from public.group_memberships m where m.group_id=x.group_id and private.group_notice_recipient(g.id,m.user_id)
   and (coalesce((select in_app from public.notification_preferences where user_id=m.user_id and event_type='session_starting'),true) or coalesce((select push from public.notification_preferences where user_id=m.user_id and event_type='session_starting'),false))
   and not exists(select 1 from public.notifications n join private.notification_events e on e.id=n.event_id where e.event_key='reminder:'||x.id||':'||x.version||':'||private.session_notice_hash(x.id) and n.recipient_id=m.user_id))
  order by x.starts_at,x.id limit 500 loop
   select array_agg(distinct m.user_id order by m.user_id) into recipient from public.group_memberships m where m.group_id=session_row.group_id and private.group_notice_recipient(m.group_id,m.user_id);
   perform private.emit_session_notice('reminder:'||session_row.id||':'||session_row.version||':'||private.session_notice_hash(session_row.id),'session_starting',session_row.group_id,session_row.id,recipient);
  end loop;
  if p_action='sweep' then return jsonb_build_object('ok',true);end if;
  update private.notification_deliveries set status='failed',lease_token=null,lease_until=null where status='leased' and lease_until<clock_timestamp() and attempts>=8;
  update private.notification_deliveries x set status='cancelled',lease_token=null where status in ('pending','leased') and (not exists(select 1 from private.push_subscriptions s where s.id=x.subscription_id and s.active) or exists(select 1 from public.notifications n join public.notification_preferences p on p.user_id=n.recipient_id and p.event_type=n.event_type where n.id=x.notification_id and not p.push) or not exists(select 1 from public.notifications n join public.profiles p on p.id=n.recipient_id and p.status='active' where n.id=x.notification_id) or exists(select 1 from public.notifications n where n.id=x.notification_id and not private.notification_current(n.event_id,n.recipient_id)));
  with due as (select id from private.notification_deliveries where (status='pending' or status='leased' and lease_until<clock_timestamp()) and next_attempt_at<=clock_timestamp() and attempts<8 order by next_attempt_at,id for update skip locked limit 25), claimed as (update private.notification_deliveries x set status='leased',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1 from due where x.id=due.id returning x.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'lease',x.lease_token,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb) into result from claimed x join private.push_subscriptions s on s.id=x.subscription_id;return result;
 elsif p_action='check' then
  select * into d from private.notification_deliveries where id=(p_data->>'id')::uuid for update;
  if d.id is null or d.status<>'leased' or d.lease_token is distinct from (p_data->>'lease')::uuid or d.lease_until<=clock_timestamp() then return jsonb_build_object('valid',false);end if;
  if not exists(select 1 from public.notifications n join private.push_subscriptions s on s.id=d.subscription_id and s.active
   join public.profiles p on p.id=n.recipient_id and p.status='active'
   join public.notification_preferences pref on pref.user_id=n.recipient_id and pref.event_type=n.event_type and pref.push
   where n.id=d.notification_id and private.notification_current(n.event_id,n.recipient_id)) then
   update private.notification_deliveries set status='cancelled',lease_token=null,lease_until=null where id=d.id;return jsonb_build_object('valid',false);
  end if;
  return jsonb_build_object('valid',true);
 elsif p_action='finish' then
  select * into d from private.notification_deliveries where id=(p_data->>'id')::uuid for update;
  if d.status<>'leased' or d.lease_token is distinct from (p_data->>'lease')::uuid or d.lease_until<=clock_timestamp() then raise exception 'Expired lease' using errcode='PT409';end if;
  if (p_data->>'status')::int in (404,410) then update private.push_subscriptions set active=false where id=d.subscription_id;end if;
  update private.notification_deliveries set status=case when (p_data->>'status')::int between 200 and 299 then 'sent' when (p_data->>'status')::int in (400,401,403,404,410,413) or attempts>=8 then 'failed' else 'pending' end,last_status=(p_data->>'status')::int,sent_at=case when (p_data->>'status')::int between 200 and 299 then clock_timestamp() end,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,(power(2,attempts)*30)::int)),lease_token=null,lease_until=null where id=d.id;return jsonb_build_object('ok',true);
 else raise exception 'Unknown action' using errcode='23514';end if;
end $$;

-- notification_link: 20261116120000 body, the Session branch changed (marked).
create or replace function private.notification_link(p_event uuid,p_user uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare e private.notification_events; l public.lessons; course uuid; part uuid; off uuid; exam_ uuid;
begin
 if p_user is distinct from private.current_app_user_id() then return null;end if;
 select * into e from private.notification_events where id=p_event;
 if e.event_type='account_approved' then return null;
 elsif e.event_type='support_reply' then if private.support_access(e.resource_id) then return '/support?ticket='||e.resource_id;end if;
 elsif e.event_type in ('session_starting','session_details','class_started') then
  -- live class: "starts soon" and "has started" for an EduLabs class open the class page; everything else opens Groups as before.
  if private.notification_current(e.id,p_user) then
   if e.event_type in ('session_starting','class_started') and exists(select 1 from public.group_sessions s where s.id=e.session_id and s.mode='online' and s.join_url='') then return '/class/'||e.session_id;end if;
   return '/groups';
  end if;
 elsif e.event_type='exam_released' then
  if exists(select 1 from private.assessment_participations p where p.schedule_id=e.resource_id and p.user_id=p_user and p.released_at is not null)  then return '/exams/'||e.resource_id;end if;
  -- A result of the new exams (20261114120000): the resource is the result; the link opens that exam once the student may see the result.
  select r.exam_id into exam_ from private.exam_results r where r.id=e.resource_id and r.user_id=p_user and private.exam_released(r.id);
  if exam_ is not null then return '/exams/'||exam_;end if;
 elsif e.event_type='homework_released' then
  select a.lesson_id,a.offering_id,a.segment_id into l.id,off,part from public.homework_submissions s join public.homework_assignments a on a.id=s.assignment_id join private.homework_corrections c on c.submission_id=s.id where s.id=e.resource_id and s.user_id=p_user and c.released_at is not null and private.homework_enrolled(a.id);
 elsif e.event_type='lesson_published' then
  select x.* into l from public.lessons x where x.id=e.resource_id and x.status='published' and private.can_view_lesson(x.id);
 end if;
 if l.id is not null then
  select m.course_id into course from public.course_modules m join public.lessons x on x.module_id=m.id where x.id=l.id;
  if part is null then select s.id into part from public.lesson_segments s where s.lesson_id=l.id and s.status='published' order by s.position limit 1;
  elsif not exists(select 1 from public.lesson_segments s where s.id=part and s.lesson_id=l.id and s.status='published') then return null;end if;
  if off is null then select o.id into off from public.course_offerings o where o.course_id=course and private.is_enrolled(o.id) order by o.id limit 1;end if;
  if part is not null and off is not null then return '/courses/'||course||'/chapters/'||part||'?offering='||off;end if;
  -- (b) NEW: homework in a lesson with no published part opens the lesson page by its id (a published lesson only: the page refuses any other).
  if part is null and off is not null and e.event_type='homework_released' and exists(select 1 from public.lessons x where x.id=l.id and x.status='published') then
   return '/courses/'||course||'/lessons/'||l.id||'?offering='||off;end if;
 end if;return null;
end $$;

-- ---------------------------------------------------------------------------------------
-- 6. Demo seed version 9: the version 8 fill (20261116120000) with the live_class block before the version is stored.
-- ---------------------------------------------------------------------------------------
alter table private.demo_seed_rows drop constraint demo_seed_rows_table_name_check;
alter table private.demo_seed_rows add constraint demo_seed_rows_table_name_check check (table_name in
 ('courses','course_modules','lessons','course_offerings','study_groups','group_staff','group_sessions','profiles','enrollments','group_memberships',
  'homework_assignments','homework_questions','homework_options','homework_keys','homework_solutions','homework_submissions','homework_responses',
  'homework_marks','homework_corrections','homework_uploads','homework_submission_files',
  'exams','exam_questions','exam_options','exam_keys','exam_attempts','exam_results','live_class_rooms','live_class_joins'));

create or replace function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamp; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 groups_ uuid[]; fin_ uuid[] := '{}'; dra_ uuid[] := '{}'; g uuid; gi integer; n integer; sn integer := 0; st timestamptz; dur interval;
 pid uuid; eid uuid; mid uuid; a_status text; a_marked boolean; les_pub uuid; ev uuid; k integer; titles_ text[];
 n_courses integer := 0; n_lessons integer := 0; n_groups integer := 0; n_sessions integer := 0; n_students integer := 0;
 les_ uuid[] := '{}'; studs_ uuid[] := '{}'; hw_ uuid[]; hw_at timestamptz; dl timestamptz; sub_ uuid; nxt uuid; hw_row uuid; st_ text;
 mag_ uuid; les_review uuid; lc_ uuid; lc_at timestamptz;
 ex_ uuid[]; ex_day date; at_ uuid; n_exams integer := 5; win_open timestamptz; win_close timestamptz; gx uuid; sx uuid; rr uuid;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;
 if exists(select 1 from private.demo_spaces where organization_id=p_org and filled_at is not null) then
  raise exception 'Demo data is already present. Clear it first.' using errcode='PT409'; end if;
 select user_id into v_owner from public.organization_memberships
  where organization_id=p_org and role='owner' and status='active' order by joined_at nulls last limit 1;
 if v_owner is null then raise exception 'The teacher has not accepted the invitation yet' using errcode='PT409'; end if;
 if private.space_has_real_students(p_org) then
  raise exception 'A space with enrolled students cannot receive demo data' using errcode='PT409'; end if;
 v_day := date_trunc('day', now() at time zone 'Africa/Cairo');

 -- Courses: A (published) and B (draft). Seed version 4: A has the board's tree, three chapters with 3, 2 and 0 lessons, the first lesson of a chapter published and
 -- the others draft; B has no chapters, so the empty Content section can be tried. The type and the number come from the trigger, like a chapter a teacher adds.
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Physics, Third Secondary','demo-physics','published','private',v_owner) returning id into crs_a;
 perform private.demo_track(p_org,'courses','courses',crs_a);
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Chemistry, Second Secondary','demo-chemistry','draft','private',v_owner) returning id into crs_b;
 perform private.demo_track(p_org,'courses','courses',crs_b);
 n_courses := 2;
 for i in 0..2 loop
  insert into public.course_modules(course_id,title,position)
   values(crs_a,(array['Electric current','Magnetism','Electromagnetic induction'])[i+1],i) returning id into mod_id;
  perform private.demo_track(p_org,'courses','course_modules',mod_id);
  titles_ := case i when 0 then array['Ohm''s law','Resistors in series and parallel','Kirchhoff''s laws'] when 1 then array['Magnetic field of a wire','Force on a wire'] else '{}'::text[] end;
  for j in 1..cardinality(titles_) loop
   insert into public.lessons(module_id,title,position,status) values(mod_id,titles_[j],j-1,case when j=1 then 'published' else 'draft' end) returning id into s;
   perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1; les_ := les_||s;
   if les_pub is null and j=1 then les_pub := s; end if;
  end loop;
 end loop;
 insert into public.course_offerings(course_id,name,delivery_mode,status)
  values(crs_a,'Demo offering','blended','active') returning id into off_id;
 perform private.demo_track(p_org,'courses','course_offerings',off_id);

 -- Groups with upcoming sessions (Cairo wall time): one at a centre, one online; one session is cancelled.
 insert into public.study_groups(offering_id,name,mode,location,created_by)
  values(off_id,'Demo Group 1','center','Demo centre, room 1',v_owner) returning id into g1;
 perform private.demo_track(p_org,'groups','study_groups',g1);
 insert into public.study_groups(offering_id,name,mode,created_by)
  values(off_id,'Demo Group 2','online',v_owner) returning id into g2;
 perform private.demo_track(p_org,'groups','study_groups',g2);
 n_groups := 2; groups_ := array[g1,g2];
 insert into public.group_staff(group_id,user_id) values(g1,v_owner),(g2,v_owner);
 perform private.demo_track(p_org,'groups','group_staff',g1);
 perform private.demo_track(p_org,'groups','group_staff',g2);
 for i in 1..3 loop
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by,cancelled,cancellation_reason)
   select g1,'Demo session '||i,t,t+interval '90 minutes',t,t+interval '90 minutes','center','Demo centre, room 1',v_owner,v_owner,(i=2),case when i=2 then 'Demo cancellation' else '' end
   from (select ((v_day + make_interval(days => i*2+1) + interval '18 hours') at time zone 'Africa/Cairo') as t) x returning id into s;
  perform private.demo_track(p_org,'groups','group_sessions',s); n_sessions := n_sessions+1;
 end loop;
 for i in 1..2 loop
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by)
   select g2,'Demo session '||i,t,t+interval '60 minutes',t,t+interval '60 minutes','online','',v_owner,v_owner
   from (select ((v_day + make_interval(days => i*3) + interval '20 hours') at time zone 'Africa/Cairo') as t) x returning id into s;
  perform private.demo_track(p_org,'groups','group_sessions',s); n_sessions := n_sessions+1;
 end loop;

 -- Seed version 2, attendance: per Group one finalized and one draft past Session. Their list of students is saved (roster_at) with the
 -- students below, so Take attendance opens them as they are.
 for gi in 1..2 loop
  g := groups_[gi]; dur := case when gi=1 then interval '90 minutes' else interval '60 minutes' end;
  for j in 1..2 loop
   st := ((v_day - make_interval(days => case when j=1 then 9-gi+1 else 3-gi end) + case when gi=1 then interval '18 hours' else interval '20 hours' end) at time zone 'Africa/Cairo');
   insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,created_by,updated_by,attendance_state,roster_at)
    values(g,'Demo earlier session '||j,st,st+dur,st,st+dur,case when gi=1 then 'center' else 'online' end,case when gi=1 then 'Demo centre, room 1' else '' end,
     v_owner,v_owner,case when j=1 then 'finalized' else 'draft' end,st+dur) returning id into s;
   perform private.demo_track(p_org,'attendance','group_sessions',s); n_sessions := n_sessions+1;
   if j=1 then fin_ := fin_||s; else dra_ := dra_||s; end if;
  end loop;
 end loop;

 -- Seed version 2, students: 14 per Group, named plainly, enrolled in the one offering, members of their Group, with attendance on the
 -- two past Sessions. Finalized: every student marked (every fourth absent). Draft: the first eight marked, the rest not marked yet.
 for gi in 1..2 loop
  g := groups_[gi];
  for n in 1..14 loop
   sn := sn+1;
   insert into public.profiles(id,display_name) values(gen_random_uuid(),'Demo Student '||sn) returning id into pid;
   perform private.demo_track(p_org,'students','profiles',pid); studs_ := studs_||pid;
   insert into public.enrollments(offering_id,user_id,status,enrolled_at,source,created_by)
    values(off_id,pid,'active',now()-interval '60 days','demo',v_owner) returning id into eid;
   perform private.demo_track(p_org,'students','enrollments',eid);
   insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
    values(g,off_id,pid,eid,now()-interval '60 days',v_owner) returning id into mid;
   perform private.demo_track(p_org,'students','group_memberships',mid);
   n_students := n_students+1;
   a_status := case when n%4=0 then 'absent' else 'attended' end;
   insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by) values(fin_[gi],pid,mid,a_status,v_owner);
   a_marked := n<=8;
   insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by)
    values(dra_[gi],pid,mid,case when a_marked then a_status else 'not_marked' end,case when a_marked then v_owner end);
  end loop;
 end loop;

 -- Seed version 3, notifications: five real notifications for the teacher, one per event type that can reach a teacher's Home. They are
 -- inserted directly (not through private.emit_notification), so no push delivery is ever queued for a demo notification. Every event key
 -- starts with 'demo:<org id>:', which is what Clear already removes. The newest four are unread (Home lists unread ones); the oldest is read.
 -- Not seeded: session_details and session_starting. They are only "current" for a student who is a member of the Group, never for staff.
 for k in 1..5 loop
  insert into private.notification_events(event_key,event_type,organization_id,resource_id)
   values('demo:'||p_org::text||':notification:'||k::text,
    (array['account_approved','lesson_published','support_reply','exam_released','homework_released'])[k],p_org,
    case k when 1 then p_org when 2 then les_pub when 3 then g1 else g2 end) returning id into ev;
  insert into public.notifications(event_id,recipient_id,event_type,in_app,created_at,read_at)
   values(ev,v_owner,(array['account_approved','lesson_published','support_reply','exam_released','homework_released'])[k],true,
    now()-make_interval(hours => k*5),case when k=5 then now()-interval '1 hour' end);
 end loop;

 -- Seed version 5, homework, in the published Physics course (the whole course gets it). Every state the board shows:
 --   1. Kirchhoff's laws (draft lesson): a draft.
 --   2. Ohm's law: open, deadline in 4 days, late allowed, fix mistakes with 2 tries, solutions after the deadline. Students 1-10 handed
 --      in: 1-5 waiting, 6-8 corrected and not released, 9 released and now on try 2 (a draft with one kept answer), 10 handed in try 2.
 --   3. Ohm's law: closed 3 days ago, late allowed, one time, solutions after hand-in. Students 1-26 handed in (25 and 26 late), 27 and
 --      28 missing: 1-9 waiting, 10-21 corrected and not released, 22-26 released.
 --   4. Magnetic field of a wire: closed 10 days ago, from zero with 2 tries, solutions after the deadline. Students 1-20, all released,
 --      each with one photo (an upload row with no file).
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[3],'Kirchhoff''s laws practice','draft',((v_day+interval '7 days'+interval '20 hours') at time zone 'Africa/Cairo'),false,'from_zero',3,'after_deadline');
 dl := ((v_day+interval '4 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[1],'Ohm''s law: practice set','published',dl,true,'fix_mistakes',2,'after_deadline');
 for i in 1..10 loop
  st_ := case when i<=5 then 'waiting' when i<=8 then 'corrected' else 'released' end;
  hw_at := now()-make_interval(hours => 2+i*3);
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,false,case when i=10 then 'corrected' else st_ end,case when i=9 then 1 else i end,false);
  if i=9 then
   -- Try 2 started: the right textbook answer is kept and cannot change.
   insert into public.homework_submissions(assignment_id,user_id,number,status,revision,created_at,updated_at)
    values(hw_[1],studs_[i],2,'draft',1,now()-interval '30 minutes',now()-interval '30 minutes') returning id into nxt;
   perform private.demo_track(p_org,'homework','homework_submissions',nxt);
   insert into public.homework_responses(submission_id,question_id,response) select nxt,r.question_id,r.response from public.homework_responses r where r.submission_id=sub_ and r.question_id=hw_[2] returning id into hw_row;
   perform private.demo_track(p_org,'homework','homework_responses',hw_row);
   insert into private.homework_carried(submission_id,question_id,source_submission_id) values(nxt,hw_[2],sub_);
  elsif i=10 then
   nxt := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],2,now()-interval '1 hour',false,'waiting',2,false);
  end if;
 end loop;
 dl := ((v_day-interval '3 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[1],'Ohm''s law: textbook page 34','published',dl,true,'one_time',1,'after_hand_in');
 for i in 1..26 loop
  st_ := case when i<=9 then 'waiting' when i<=21 then 'corrected' else 'released' end;
  hw_at := case when i>=25 then dl+make_interval(hours => i-23) else dl-make_interval(hours => 2+i*2) end;
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,i>=25,st_,i,false);
 end loop;
 dl := ((v_day-interval '10 days'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_[4],'Magnetic field of a wire','published',dl,false,'from_zero',2,'after_deadline');
 for i in 1..20 loop
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,dl-make_interval(hours => 3+i*2),false,'released',i,true);
 end loop;

 -- Seed version 6, a lesson with homework and no parts (DECISIONS.md, "A lesson is never tethered to one of its components"), so the student
 -- lesson page addressed by the lesson id and correcting can be tried. "Magnetism review" is the third lesson of Magnetism, published, with no
 -- part, video, content item or cover. Its homework (a blank-answer question, a choice question and an essay) closed yesterday at 20:00 Cairo,
 -- late hand-ins allowed, one time, solutions after hand-in. Students 1-14 handed in, 15-28 are missing:
 --   1-5 waiting (1, 2 and 4 with a photo; student 1's photo deleted to free space), 6-9 corrected and not released (for "Release N grades"),
 --   10-12 released, 13-14 handed in late and waiting ("Missed the deadline").
 select m.id into mag_ from public.course_modules m where m.course_id=crs_a and m.position=1;
 insert into public.lessons(module_id,title,position,status) values(mag_,'Magnetism review',2,'published') returning id into les_review;
 perform private.demo_track(p_org,'courses','lessons',les_review); n_lessons := n_lessons+1; les_ := les_||les_review;
 dl := ((v_day-interval '1 day'+interval '20 hours') at time zone 'Africa/Cairo');
 hw_ := private.demo_homework_make(p_org,v_owner,crs_a,off_id,les_review,'Magnetism review homework','published',dl,true,'one_time',1,'after_hand_in');
 for i in 1..14 loop
  st_ := case when i<=5 or i>=13 then 'waiting' when i<=9 then 'corrected' else 'released' end;
  hw_at := case when i>=13 then dl+make_interval(hours => i-11) else dl-make_interval(hours => 1+i) end;
  sub_ := private.demo_homework_try(p_org,v_owner,hw_,studs_[i],1,hw_at,i>=13,st_,i,i in (1,2,4));
 end loop;
 -- Student 1's photo was removed to free space: the row stays 'deleted' (as Delete images leaves it); the answer and marks are kept.
 update private.homework_uploads u set status='deleted',deleted_at=now()-interval '1 hour'
  where u.assignment_id=hw_[1] and u.uploaded_by=studs_[1] and u.purpose='submission';


 -- Seed version 7, exams, in the published Physics course (the whole course gets them). Online: 4 questions (a choice, several choices, a number, an
 -- essay with text and a photo allowed), 12 points, 30 minutes. Paper: out of 50. Students 1-14 are in Demo Group 1, 15-28 in Demo Group 2.
 --   1. "Electric current: quiz (open now)": Group 1's window runs from an hour before the fill to three hours after it (students 1-3 handed in,
 --      4 and 5 are still working, 6-14 have not started); Group 2's window is its next session. Fix mistakes (a second try inside the window).
 --   2. "Electric current: mid-term (closed)": both windows closed (3 and 2 days ago); students 1-12 and 15-26 handed in; essays are waiting for
 --      most, every third one is corrected and not released.
 --   3. "Magnetism: unit test (released)": both windows closed 9 days ago; students 1-20 handed in, all corrected and released, so answer review is open.
 --   4. "Electromagnetic induction: quiz (upcoming)": each Group's window is its next session.
 --   5. "Electricity: paper exam": out of 50, held two days ago: students 1-9 and 15-22 have a mark (1-4 released), student 10 is Absent, the rest are missing.
 ex_day := (now() at time zone 'Africa/Cairo')::date;
 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electric current: quiz (open now)',30,'fix_mistakes',ex_day,now()-interval '2 hours');
 win_open := now()-interval '1 hour'; win_close := now()+interval '3 hours';
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values(ex_[1],g1,'custom',win_open,win_close,v_owner);
 select x.id into sx from public.group_sessions x where x.group_id=g2 and not x.cancelled and x.starts_at>=now() order by x.starts_at,x.id limit 1;
 insert into private.exam_group_windows(exam_id,group_id,source,session_id,updated_by) values(ex_[1],g2,'auto',sx,v_owner);
 for i in 1..5 loop
  at_ := private.demo_exam_try(p_org,ex_,studs_[i],g1,1,case when i<=3 then now()-make_interval(mins => 50-i) else now()-make_interval(mins => 15-i) end,30,i<=3,i);
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electric current: mid-term (closed)',30,'one_time',ex_day-3,now()-interval '4 days');
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values
  (ex_[1],g1,'custom',now()-interval '3 days 2 hours',now()-interval '3 days',v_owner),(ex_[1],g2,'custom',now()-interval '2 days 2 hours',now()-interval '2 days',v_owner);
 for i in 1..28 loop
  if (i<=12) or (i>=15 and i<=26) then
   at_ := private.demo_exam_try(p_org,ex_,studs_[i],case when i<=14 then g1 else g2 end,1,
    case when i<=14 then now()-interval '3 days 90 minutes'+make_interval(mins => i) else now()-interval '2 days 90 minutes'+make_interval(mins => i-14) end,30,true,i);
   if i%3=0 then perform private.demo_exam_correct(at_,(i%9)::numeric/2); end if;
  end if;
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Magnetism: unit test (released)',30,'one_time',ex_day-10,now()-interval '11 days');
 insert into private.exam_group_windows(exam_id,group_id,source,custom_opens_at,custom_closes_at,updated_by) values
  (ex_[1],g1,'custom',now()-interval '9 days 2 hours',now()-interval '9 days',v_owner),(ex_[1],g2,'custom',now()-interval '9 days 2 hours',now()-interval '9 days',v_owner);
 for i in 1..20 loop
  at_ := private.demo_exam_try(p_org,ex_,studs_[i],case when i<=14 then g1 else g2 end,1,now()-interval '9 days 90 minutes'+make_interval(mins => i),30,true,i);
  perform private.demo_exam_correct(at_,((i*3)%9)::numeric/2);
  update private.exam_results set released_at=now()-interval '8 days',released_by=v_owner where exam_id=ex_[1] and user_id=studs_[i];
 end loop;

 ex_ := private.demo_exam_make(p_org,v_owner,crs_a,off_id,'Electromagnetic induction: quiz (upcoming)',30,'one_time',ex_day,now()-interval '1 hour');
 foreach gx in array groups_ loop
  select x.id into sx from public.group_sessions x where x.group_id=gx and not x.cancelled and x.starts_at>=now() order by x.starts_at,x.id limit 1;
  insert into private.exam_group_windows(exam_id,group_id,source,session_id,updated_by) values(ex_[1],gx,'auto',sx,v_owner);
 end loop;

 -- The paper exam: no windows, no tries; a result row per student with a mark (the mark is also the score), Absent, or none.
 at_ := gen_random_uuid();
 insert into private.exams(id,family_id,course_id,offering_id,kind,title,status,published_at,max_marks,held_on,created_by,revision)
  values(at_,at_,crs_a,off_id,'paper','Electricity: paper exam','published',now()-interval '1 day',50,ex_day-2,v_owner,1);
 perform private.demo_track(p_org,'exams','exams',at_);
 for i in 1..22 loop
  if i<=9 or i>=15 then
   insert into private.exam_results(exam_id,user_id,paper_mark,status,score,max_score,released_at,released_by,updated_by)
    values(at_,studs_[i],20+((i*7)%25)+case when i%2=0 then 0.5 else 0 end,'corrected',20+((i*7)%25)+case when i%2=0 then 0.5 else 0 end,50,
     case when i<=4 then now()-interval '1 day' end,case when i<=4 then v_owner end,v_owner) returning id into rr;
  elsif i=10 then
   insert into private.exam_results(exam_id,user_id,absent,status,max_score,updated_by) values(at_,studs_[i],true,'corrected',50,v_owner) returning id into rr;
  else rr := null;
  end if;
  if rr is not null then perform private.demo_track(p_org,'exams','exam_results',rr); end if;
 end loop;


 -- Seed version 9, live_class (migration 20261119120000_live_class.sql). Demo Group 2 is online with no link, so it is an EduLabs class.
 -- (1) Group 2's draft earlier Session was held as an EduLabs class: started by the teacher at its start time, and students 17 to 26 (3rd to
 --     12th of the Group) opened it. Take attendance shows them as "Joined online" and saves the joined ones still not marked (students 23
 --     to 26) as Present; students 18 and 22 joined but stay Absent (a mark is never overwritten); 27 and 28 neither joined nor are marked.
 -- (2) A class the teacher can start now: a one-off Group 2 Session that starts 5 minutes after the fill and lasts an hour. Not started.
 select x.starts_at into lc_at from public.group_sessions x where x.id=dra_[2];
 insert into private.live_class_rooms(session_id,room,started_by,started_at)
  values(dra_[2],replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),v_owner,lc_at);
 perform private.demo_track(p_org,'live_class','live_class_rooms',dra_[2]);
 insert into private.live_class_joins(session_id,user_id,staff,first_at,last_at) values(dra_[2],v_owner,true,lc_at,lc_at) returning id into lc_;
 perform private.demo_track(p_org,'live_class','live_class_joins',lc_);
 for i in 17..26 loop
  insert into private.live_class_joins(session_id,user_id,staff,first_at,last_at)
   values(dra_[2],studs_[i],false,lc_at+make_interval(mins => i-16),lc_at+make_interval(mins => i-16)) returning id into lc_;
  perform private.demo_track(p_org,'live_class','live_class_joins',lc_);
 end loop;
 insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,exception,created_by,updated_by)
  values(g2,'Demo live class',now()+interval '5 minutes',now()+interval '65 minutes',now()+interval '5 minutes',now()+interval '65 minutes','online','',true,v_owner,v_owner)
  returning id into lc_;
 perform private.demo_track(p_org,'live_class','group_sessions',lc_); n_sessions := n_sessions+1;

 update private.demo_spaces set seed_version=9,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',9,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'notifications',5,'homework',5,'exams',n_exams));
 return jsonb_build_object('seedVersion',9,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions,'students',n_students,'homework',5,'exams',n_exams);
end $$;

create or replace function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',9) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',9));
end $$;

notify pgrst,'reload schema';

commit;
