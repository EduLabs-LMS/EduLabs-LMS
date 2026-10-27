-- Demo spaces: a platform administrator can mark a provisioned teaching space as a DEMO space and fill it with tagged,
-- clearly labelled synthetic data (and clear exactly that data again). Additive only: new private tables and functions,
-- plus a wider audit-action list. Nothing is created automatically, and nothing here can run for a space that is not
-- marked demo, that has real students enrolled, or by anyone who is not an active platform administrator.
begin;

-- ---------------------------------------------------------------------------------------
-- Registry. A space is "demo" only while it has a row here. Every row the fill creates is
-- recorded, so Clear removes exactly those rows by id and never matches by name or content.
-- ---------------------------------------------------------------------------------------
create table private.demo_spaces (
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 marked_by uuid not null references public.profiles(id) on delete restrict,
 marked_at timestamptz not null default now(),
 seed_version integer check (seed_version is null or seed_version > 0),
 filled_at timestamptz,
 check ((seed_version is null) = (filled_at is null))
);
alter table private.demo_spaces enable row level security;
revoke all on private.demo_spaces from public,anon,authenticated,service_role;

create table private.demo_seed_rows (
 id bigint generated always as identity primary key,
 organization_id uuid not null references private.demo_spaces(organization_id) on delete restrict,
 module text not null check (module ~ '^[a-z_]{1,40}$'),
 table_name text not null check (table_name in ('courses','course_modules','lessons','course_offerings','study_groups','group_staff','group_sessions')),
 row_id uuid not null,
 unique (table_name,row_id)
);
create index demo_seed_rows_org_idx on private.demo_seed_rows(organization_id,id);
alter table private.demo_seed_rows enable row level security;
revoke all on private.demo_seed_rows from public,anon,authenticated,service_role;

-- Demo notifications are tagged by their event key prefix: 'demo:<organization id>:...'.

-- ---------------------------------------------------------------------------------------
-- Audit: the existing append-only trail gains four actions.
-- ---------------------------------------------------------------------------------------
alter table private.platform_audit drop constraint platform_audit_action_check;
alter table private.platform_audit add constraint platform_audit_action_check check (action in
 ('portal.provision','invitation.revoke','invitation.reissue','invitation.accept','demo.mark','demo.unmark','demo.fill','demo.clear'));

-- ---------------------------------------------------------------------------------------
-- Internal helpers (not callable by API roles).
-- ---------------------------------------------------------------------------------------
create function private.demo_track(p_org uuid,p_module text,p_table text,p_id uuid) returns void
language sql set search_path='' as $$
 insert into private.demo_seed_rows(organization_id,module,table_name,row_id) values(p_org,p_module,p_table,p_id)
$$;

-- Fill. Seed version 1 = courses and chapters and lessons, one offering, two Groups with upcoming sessions (one cancelled).
-- Every future teacher feature that has data adds its own module here and bumps the version (see docs/ai/DECISIONS.md).
create function private.demo_fill_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid; v_day timestamptz; crs_a uuid; crs_b uuid; mod_id uuid; off_id uuid; g1 uuid; g2 uuid; s uuid; i integer; j integer;
 n_courses integer := 0; n_lessons integer := 0; n_groups integer := 0; n_sessions integer := 0;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;
 if exists(select 1 from private.demo_spaces where organization_id=p_org and filled_at is not null) then
  raise exception 'Demo data is already present. Clear it first.' using errcode='PT409'; end if;
 select user_id into v_owner from public.organization_memberships
  where organization_id=p_org and role='owner' and status='active' order by joined_at nulls last limit 1;
 if v_owner is null then raise exception 'The teacher has not accepted the invitation yet' using errcode='PT409'; end if;
 if exists(select 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id
   where c.organization_id=p_org) then
  raise exception 'A space with enrolled students cannot receive demo data' using errcode='PT409'; end if;
 v_day := date_trunc('day', now() at time zone 'Africa/Cairo');

 -- Courses: A (published) and B (draft), chapters with published and draft lessons.
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Physics, Third Secondary','demo-physics','published','private',v_owner) returning id into crs_a;
 perform private.demo_track(p_org,'courses','courses',crs_a);
 insert into public.courses(organization_id,title,slug,status,visibility,created_by)
  values(p_org,'Demo · Chemistry, Second Secondary','demo-chemistry','draft','private',v_owner) returning id into crs_b;
 perform private.demo_track(p_org,'courses','courses',crs_b);
 n_courses := 2;
 for i in 0..1 loop
  insert into public.course_modules(course_id,title,position) values(crs_a,'Demo chapter '||(i+1),i) returning id into mod_id;
  perform private.demo_track(p_org,'courses','course_modules',mod_id);
  for j in 0..1 loop
   insert into public.lessons(module_id,title,position,status) values(mod_id,'Demo lesson '||(i*2+j+1),j,case when j=0 then 'published' else 'draft' end) returning id into s;
   perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1;
  end loop;
 end loop;
 insert into public.course_modules(course_id,title,position) values(crs_b,'Demo chapter 1',0) returning id into mod_id;
 perform private.demo_track(p_org,'courses','course_modules',mod_id);
 insert into public.lessons(module_id,title,position,status) values(mod_id,'Demo lesson 1',0,'draft') returning id into s;
 perform private.demo_track(p_org,'courses','lessons',s); n_lessons := n_lessons+1;
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
 n_groups := 2;
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

 update private.demo_spaces set seed_version=1,filled_at=clock_timestamp() where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.fill','organization',p_org,p_org,
  jsonb_build_object('seedVersion',1,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions));
 return jsonb_build_object('seedVersion',1,'courses',n_courses,'lessons',n_lessons,'groups',n_groups,'sessions',n_sessions);
end $$;

-- Clear: removes exactly the recorded rows, newest first, plus the dependents that triggers created for them.
create function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; n integer := 0; groups_ uuid[]; sessions_ uuid[]; courses_ uuid[]; events_ uuid[];
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;
 select coalesce(array_agg(row_id) filter (where table_name='study_groups'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='group_sessions'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='courses'),'{}')
  into groups_,sessions_,courses_ from private.demo_seed_rows where organization_id=p_org;
 -- Notifications that belong to the demo rows (by event key prefix, or created by triggers for the tracked groups and sessions).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id = any(sessions_) or resource_id = any(groups_);
 delete from public.notifications where event_id = any(events_);
 delete from private.notification_events where id = any(events_);
 delete from private.group_notification_state where group_id = any(groups_);
 delete from private.group_audit where group_id = any(groups_);
 delete from public.session_attendance where session_id = any(sessions_);
 delete from private.course_stage_versions where course_id = any(courses_);
 for r in select table_name,row_id from private.demo_seed_rows where organization_id=p_org order by id desc loop
  case r.table_name
   when 'group_sessions' then delete from public.group_sessions where id=r.row_id;
   when 'group_staff' then delete from public.group_staff where group_id=r.row_id;
   when 'study_groups' then delete from public.group_schedules where group_id=r.row_id; delete from public.study_groups where id=r.row_id;
   when 'course_offerings' then delete from public.course_offerings where id=r.row_id;
   when 'lessons' then delete from public.lessons where id=r.row_id;
   when 'course_modules' then delete from public.course_modules where id=r.row_id;
   when 'courses' then delete from public.courses where id=r.row_id;
  end case;
  n := n+1;
 end loop;
 delete from private.demo_seed_rows where organization_id=p_org;
 update private.demo_spaces set seed_version=null,filled_at=null where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.clear','organization',p_org,p_org,jsonb_build_object('rows',n));
 return jsonb_build_object('removedRows',n);
end $$;

revoke all on function private.demo_track(uuid,text,text,uuid),private.demo_fill_core(uuid,uuid),private.demo_clear_core(uuid,uuid) from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------
-- Administrator operations (platform administrators only; every call is audited).
-- ---------------------------------------------------------------------------------------
create function private.platform_set_demo_space(p_org uuid,p_on boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id();
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_org is null or p_on is null or not exists(select 1 from private.teacher_invitations where organization_id=p_org) then
  raise exception 'Portal unavailable' using errcode='PT404'; end if;
 perform 1 from public.organizations where id=p_org for update;
 if p_on then
  if exists(select 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id where c.organization_id=p_org) then
   raise exception 'A space with enrolled students cannot become a demo space' using errcode='PT409'; end if;
  insert into private.demo_spaces(organization_id,marked_by) values(p_org,u) on conflict do nothing;
  perform private.write_platform_audit(u,'demo.mark','organization',p_org,p_org,'{}'::jsonb);
 else
  if exists(select 1 from private.demo_spaces where organization_id=p_org and filled_at is not null) then
   raise exception 'Clear the demo data before turning demo off' using errcode='PT409'; end if;
  delete from private.demo_spaces where organization_id=p_org;
  perform private.write_platform_audit(u,'demo.unmark','organization',p_org,p_org,'{}'::jsonb);
 end if;
 return jsonb_build_object('organizationId',p_org,'demo',p_on);
end $$;

create function private.platform_demo_fill(p_org uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id();
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return private.demo_fill_core(p_org,u);
end $$;

create function private.platform_demo_clear(p_org uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id();
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return private.demo_clear_core(p_org,u);
end $$;

create function private.platform_demo_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_app_user_id() is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('demo',true,'filled',d.filled_at is not null,'seedVersion',d.seed_version,'filledAt',d.filled_at,
   'latestSeedVersion',1) from private.demo_spaces d where d.organization_id=p_org),jsonb_build_object('demo',false,'filled',false,'latestSeedVersion',1));
end $$;

-- The teacher's own screens can show a "Demo space" label. Members of the space only; nothing else is disclosed.
create function private.space_is_demo(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.demo_spaces d where d.organization_id=p_org
  and exists(select 1 from public.organization_memberships m where m.organization_id=p_org and m.user_id=(select private.current_app_user_id()) and m.status='active'))
$$;

revoke all on function private.platform_set_demo_space(uuid,boolean),private.platform_demo_fill(uuid),private.platform_demo_clear(uuid),
 private.platform_demo_status(uuid),private.space_is_demo(uuid) from public,anon;
grant execute on function private.platform_set_demo_space(uuid,boolean),private.platform_demo_fill(uuid),private.platform_demo_clear(uuid),
 private.platform_demo_status(uuid),private.space_is_demo(uuid) to authenticated;

create function public.platform_set_demo_space(p_org uuid,p_on boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.platform_set_demo_space(p_org,p_on) $$;
create function public.platform_demo_fill(p_org uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.platform_demo_fill(p_org) $$;
create function public.platform_demo_clear(p_org uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.platform_demo_clear(p_org) $$;
create function public.platform_demo_status(p_org uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.platform_demo_status(p_org) $$;
create function public.space_is_demo(p_org uuid) returns boolean language sql stable security invoker set search_path='' as $$ select private.space_is_demo(p_org) $$;
revoke all on function public.platform_set_demo_space(uuid,boolean),public.platform_demo_fill(uuid),public.platform_demo_clear(uuid),
 public.platform_demo_status(uuid),public.space_is_demo(uuid) from public,anon;
grant execute on function public.platform_set_demo_space(uuid,boolean),public.platform_demo_fill(uuid),public.platform_demo_clear(uuid),
 public.platform_demo_status(uuid),public.space_is_demo(uuid) to authenticated;

commit;
