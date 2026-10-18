-- Milestone 3. Presentation, explicit future defaults and caller-scoped summaries.
-- Existing group/session IDs, recurrence,
-- meeting URL validation, attendance and enrollment authorization are preserved.
alter table public.study_groups add column stream_label text not null default 'Live interactive stream' check(length(btrim(stream_label)) between 1 and 80 and stream_label !~ '[[:cntrl:]]');
alter table public.study_groups add column stream_icon text not null default 'video' check(stream_icon in ('video','radio','users','presentation','headphones','messages'));
-- Existing RLS/SELECT grants apply. No new client table-write privilege or public table.
create or replace function private.group_command(p_group uuid,p_action text,p_version integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.study_groups; s public.group_sessions; old jsonb; u uuid:=(select private.current_app_user_id());
 e public.enrollments; m public.group_memberships; target uuid; entry jsonb; schedules jsonb; sid uuid; result jsonb; reason text;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>65536 then raise exception 'Invalid input' using errcode='23514'; end if;

 if p_data?'applyMeetingDefaults' and jsonb_typeof(p_data->'applyMeetingDefaults')<>'boolean' then raise exception 'Invalid defaults instruction' using errcode='23514'; end if;
 if p_data?'streamLabel' and (jsonb_typeof(p_data->'streamLabel')<>'string' or length(btrim(p_data->>'streamLabel')) not between 1 and 80 or (p_data->>'streamLabel') ~ '[[:cntrl:]]') then raise exception 'Invalid stream label' using errcode='23514'; end if;
 if p_data?'streamIcon' and (jsonb_typeof(p_data->'streamIcon')<>'string' or (p_data->>'streamIcon') not in ('video','radio','users','presentation','headphones','messages')) then raise exception 'Invalid stream icon' using errcode='23514'; end if;
 if p_action='create' then
  target:=(p_data->>'offeringId')::uuid;
  if not private.can_manage_offering(target) then raise exception 'Permission denied' using errcode='42501'; end if;
  insert into public.study_groups(offering_id,name,mode,location,join_url,instructions,description,capacity,created_by)
  values(target,btrim(p_data->>'name'),p_data->>'mode',coalesce(p_data->>'location',''),coalesce(p_data->>'joinUrl',''),coalesce(p_data->>'instructions',''),coalesce(p_data->>'description',''),(p_data->>'capacity')::int,u) returning * into g;
 else
  -- Offering lock serializes membership capacity, uniqueness and transfers.
  select offering_id into target from public.study_groups where id=p_group;
  if not private.can_manage_group(p_group) then raise exception 'Permission denied' using errcode='42501'; end if;
  perform 1 from public.course_offerings where id=target for update;
  select * into g from public.study_groups where id=p_group for update;
  if not private.can_manage_group(p_group) then raise exception 'Permission changed' using errcode='42501'; end if;
  if p_action not in ('attendance','finalize','reopen','session') and p_version is distinct from g.version then raise exception 'Stale group' using errcode='PT409'; end if;
  if g.status='archived' and p_action not in ('reopen','attendance','finalize','unarchive') then raise exception 'Group archived' using errcode='23514'; end if;
 end if;
 old:=to_jsonb(g); reason:=coalesce(p_data->>'reason','');
 if length(reason)>1000 then raise exception 'Reason too long' using errcode='23514'; end if;
 if p_action in ('create','edit') then
  if p_action='edit' then
   if not private.can_manage_offering(g.offering_id) then raise exception 'Group configuration requires instructor' using errcode='42501'; end if;
   if (p_data->>'capacity')::int<(select count(*) from public.group_memberships where group_id=g.id and ends_at is null) then raise exception 'Capacity below membership' using errcode='23514'; end if;
   update public.study_groups set name=case when p_data?'name' then btrim(p_data->>'name') else name end,description=case when p_data?'description' then p_data->>'description' else description end,mode=case when p_data?'mode' then p_data->>'mode' else mode end,location=case when p_data?'location' then p_data->>'location' else location end,join_url=case when p_data?'joinUrl' then p_data->>'joinUrl' else join_url end,instructions=case when p_data?'instructions' then p_data->>'instructions' else instructions end,capacity=case when p_data?'capacity' then (p_data->>'capacity')::int else capacity end where id=g.id returning * into g;
  end if;
    -- Group defaults apply only to unstarted automatic draft occurrences.
    -- Stable IDs, recurrence templates, started/history and one-off exceptions survive.
    if p_action='edit' and p_data->'applyMeetingDefaults'='true'::jsonb then
     update public.group_sessions occurrence set mode=g.mode,location=g.location,join_url=g.join_url,instructions=g.instructions,
      version=occurrence.version+1,updated_at=clock_timestamp(),updated_by=u
     where occurrence.group_id=g.id and occurrence.starts_at>clock_timestamp() and not occurrence.exception and not occurrence.cancelled
      and occurrence.schedule_id is not null and occurrence.attendance_state='draft'
      and (occurrence.mode,occurrence.location,occurrence.join_url,occurrence.instructions) is distinct from (g.mode,g.location,g.join_url,g.instructions);
    end if;
  -- Omission leaves recurrence untouched. [] explicitly clears automatic future
  -- recurrence; exceptions and historical sessions are retained.
  if p_data?'schedules' then
   schedules:=p_data->'schedules';
   if jsonb_typeof(schedules) is distinct from 'array' or jsonb_array_length(schedules)>14 then raise exception 'Invalid weekly schedule' using errcode='23514'; end if;
   for entry in select value from jsonb_array_elements(schedules) loop
    if jsonb_typeof(entry) is distinct from 'object' or (entry->>'time') is null or entry->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (entry->>'weekday') is null or (entry->>'weekday')::int not between 0 and 6 or (entry->>'durationMinutes') is null or (entry->>'durationMinutes')::int not between 1 and 1440 then raise exception 'Invalid weekly schedule' using errcode='23514'; end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(schedules) x group by (x->>'weekday')::int,x->>'time' having count(*)>1) then raise exception 'Duplicate weekly slot' using errcode='23505'; end if;
   update public.group_schedules r set active=false where r.group_id=g.id and r.active and not exists(
    select 1 from jsonb_array_elements(schedules) x where (x->>'weekday')::int=r.weekday and (x->>'time')::time=r.local_time and (x->>'durationMinutes')::int=r.duration_minutes);
   update public.group_sessions set cancelled=true,cancellation_reason='Recurring schedule revised',version=version+1,updated_at=clock_timestamp(),updated_by=u
   where group_id=g.id and schedule_id in (select id from public.group_schedules where group_id=g.id and not active) and starts_at>clock_timestamp() and not exception and not cancelled;
   for entry in select value from jsonb_array_elements(schedules) loop
    if not exists(select 1 from public.group_schedules r where r.group_id=g.id and r.active and r.weekday=(entry->>'weekday')::int and r.local_time=(entry->>'time')::time and r.duration_minutes=(entry->>'durationMinutes')::int) then
     insert into public.group_schedules(group_id,weekday,local_time,duration_minutes) values(g.id,(entry->>'weekday')::int,(entry->>'time')::time,(entry->>'durationMinutes')::int);
    end if;
   end loop;
   perform private.materialize_group(g.id);
  end if;
 elsif p_action in ('archive','unarchive') then
  if not private.can_manage_offering(g.offering_id) then raise exception 'Instructor required' using errcode='42501'; end if;
  update public.study_groups set status=case p_action when 'archive' then 'archived' else 'active' end where id=g.id;
  if p_action='archive' then
   update public.group_sessions set cancelled=true,cancellation_reason='Group archived',version=version+1,updated_by=u,updated_at=clock_timestamp() where group_id=g.id and starts_at>clock_timestamp() and not cancelled;
  end if;
 elsif p_action='staff' then
  if not private.can_manage_offering(g.offering_id) then raise exception 'Instructor required' using errcode='42501'; end if;
  target:=(p_data->>'userId')::uuid;
  if not exists(select 1 from public.offering_staff os join public.course_offerings o on o.id=os.offering_id join public.courses c on c.id=o.course_id join public.organization_memberships om on om.organization_id=c.organization_id and om.user_id=os.user_id join public.profiles p on p.id=os.user_id where os.offering_id=g.offering_id and os.user_id=target and om.status='active' and p.status='active') then raise exception 'Assign offering staff first' using errcode='23514'; end if;
  if coalesce((p_data->>'remove')::boolean,false) then delete from public.group_staff where group_id=g.id and user_id=target;
  else insert into public.group_staff(group_id,user_id) values(g.id,target) on conflict do nothing; end if;
 elsif p_action in ('add','remove','transfer') then
  target:=(p_data->>'userId')::uuid;
  -- Enrollment UPDATE takes its row lock before its AFTER trigger acquires the
  -- offering lock. Do not invert that order with an enrollment FOR UPDATE here.
  -- The shared offering lock serializes the interval trigger with this command;
  -- a concurrent uncommitted suspension completes afterward and closes the interval.
  select * into e from public.enrollments where offering_id=g.offering_id and user_id=target;
  if p_action<>'remove' and (e.id is null or e.status<>'active' or (e.expires_at is not null and e.expires_at<=clock_timestamp()) or (e.enrolled_at is not null and e.enrolled_at>clock_timestamp()) or not exists(select 1 from public.profiles where id=target and status='active')) then raise exception 'Active eligible enrollment required' using errcode='23514'; end if;
  select * into m from public.group_memberships where offering_id=g.offering_id and user_id=target and ends_at is null for update;
  if p_action='add' and m.group_id=g.id then return jsonb_build_object('id',g.id,'version',g.version); end if;
  if p_action='add' and m.id is not null then raise exception 'Already assigned; use transfer' using errcode='23514'; end if;
  if p_action in ('remove','transfer') and (m.id is null or m.group_id<>g.id) then raise exception 'Membership changed' using errcode='PT409'; end if;
  if p_action='transfer' then
   sid:=(p_data->>'targetGroupId')::uuid;
   if sid=g.id or not private.can_manage_group(sid) then raise exception 'Target permission denied' using errcode='42501'; end if;
   if not exists(select 1 from public.study_groups where id=sid and offering_id=g.offering_id and status='active') then raise exception 'Target offering mismatch' using errcode='23514'; end if;
   perform 1 from public.study_groups where id=sid for update;
  else sid:=g.id; end if;
  if p_action<>'remove' and exists(select 1 from public.study_groups x where x.id=sid and x.capacity is not null and x.capacity<=(select count(*) from public.group_memberships where group_id=sid and ends_at is null)) then raise exception 'Group is full' using errcode='23514'; end if;
  if m.id is not null then update public.group_memberships set ends_at=clock_timestamp() where id=m.id; end if;
  if p_action<>'remove' then
   insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,enrollment_expires_at,created_by) values(sid,g.offering_id,target,e.id,e.expires_at,u);
  end if;
  if sid<>g.id then

 if p_action in ('create','edit') then
  update public.study_groups set stream_label=case when p_data?'streamLabel' then btrim(p_data->>'streamLabel') else stream_label end,
   stream_icon=case when p_data?'streamIcon' then p_data->>'streamIcon' else stream_icon end where id=g.id;
 end if;
 update public.study_groups set version=version+1,updated_at=clock_timestamp() where id=sid;
   insert into private.group_audit(group_id,actor_id,action,reason,after_data) values(sid,u,'transfer_in',reason,jsonb_build_object('userId',target,'from',g.id));
  end if;
 elsif p_action='one-off' then
  insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,location,join_url,instructions,exception,created_by,updated_by)
  values(g.id,btrim(p_data->>'title'),(p_data->>'startsAt')::timestamptz,(p_data->>'endsAt')::timestamptz,(p_data->>'startsAt')::timestamptz,(p_data->>'endsAt')::timestamptz,g.mode,g.location,g.join_url,g.instructions,true,u,u) returning id into sid;
 elsif p_action in ('session','attendance','finalize','reopen') then
  select * into s from public.group_sessions where id=(p_data->>'sessionId')::uuid and group_id=g.id for update;
  if s.id is null then raise exception 'Session unavailable' using errcode='42501'; end if;
  if s.version is distinct from (p_data->>'sessionVersion')::int then raise exception 'Stale session' using errcode='PT409'; end if;
  old:=jsonb_build_object('session',to_jsonb(s),'marks',(select coalesce(jsonb_agg(to_jsonb(a) order by a.user_id),'[]'::jsonb) from public.session_attendance a where session_id=s.id and p_action='attendance' and exists(select 1 from jsonb_array_elements(coalesce(p_data->'marks','[]'::jsonb)) mark where (mark->>'userId')::uuid=a.user_id))); sid:=s.id;
  if p_action='session' then
   if s.attendance_state<>'draft' then raise exception 'Attendance already finalized' using errcode='23514'; end if;
   if p_data->>'operation'='reschedule' then
    if s.starts_at<=clock_timestamp() or s.roster_at is not null then raise exception 'Past session or saved roster immutable' using errcode='23514'; end if;
    update public.group_sessions set starts_at=(p_data->>'startsAt')::timestamptz,ends_at=(p_data->>'endsAt')::timestamptz,
    mode=g.mode,location=g.location,join_url=g.join_url,instructions=g.instructions,exception=true where id=s.id;
   elsif p_data->>'operation' in ('cancel','restore') then
    update public.group_sessions set cancelled=(p_data->>'operation'='cancel'),cancellation_reason=reason,exception=true where id=s.id;
   else raise exception 'Invalid session operation' using errcode='23514'; end if;
  else
   if s.cancelled then raise exception 'Cancelled session' using errcode='23514'; end if;
   if p_action='reopen' then
    if not private.can_manage_offering(g.offering_id) then raise exception 'Instructor required' using errcode='42501'; end if;
    if s.attendance_state<>'finalized' or length(btrim(reason))<3 then raise exception 'Correction requires finalized sheet and reason' using errcode='23514'; end if;
    update public.group_sessions set attendance_state='reopened' where id=s.id;
   else
    if s.attendance_state='finalized' then raise exception 'Attendance finalized' using errcode='PT409'; end if;
    perform private.snapshot_group_roster(s.id);
    if p_action='attendance' then
     if jsonb_typeof(p_data->'marks')<>'array' or jsonb_array_length(p_data->'marks')>100 then raise exception 'Maximum 100 marks per atomic save' using errcode='23514'; end if;
     for entry in select value from jsonb_array_elements(p_data->'marks') loop
      update public.session_attendance set status=entry->>'status',updated_by=u,updated_at=clock_timestamp() where session_id=s.id and user_id=(entry->>'userId')::uuid;
      if not found then raise exception 'Student not in dated roster' using errcode='23514'; end if;
     end loop;
    else
     if not private.can_manage_offering(g.offering_id) then raise exception 'Instructor required' using errcode='42501'; end if;
     update public.group_sessions set attendance_state='finalized' where id=s.id;
    end if;
   end if;
  end if;
  update public.group_sessions set version=version+1,updated_at=clock_timestamp(),updated_by=u where id=s.id;
 else raise exception 'Unknown operation' using errcode='23514'; end if;

 if p_action in ('create','edit') then
  update public.study_groups set stream_label=case when p_data?'streamLabel' then btrim(p_data->>'streamLabel') else stream_label end,
   stream_icon=case when p_data?'streamIcon' then p_data->>'streamIcon' else stream_icon end where id=g.id;
 end if;
 update public.study_groups set version=version+1,updated_at=clock_timestamp() where id=g.id returning * into g;
 select case when sid is not null and p_action not in ('transfer','add','remove') then (select to_jsonb(x) from public.group_sessions x where id=sid) else to_jsonb(g) end into result;
 insert into private.group_audit(group_id,session_id,actor_id,action,reason,before_data,after_data) values(g.id,case when p_action in ('session','attendance','finalize','reopen','one-off') then sid end,u,p_action,reason,old,jsonb_build_object('record',result,'input',p_data,'sheetDigest',case when p_action in ('finalize','reopen') then (select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(a.user_id,a.membership_id,a.status) order by a.user_id)::text,'[]'),'UTF8')),'hex') from public.session_attendance a where a.session_id=sid) end));
 return jsonb_build_object('id',g.id,'version',g.version,'sessionId',case when p_action in ('session','attendance','finalize','reopen','one-off') then sid end);
end$$;

-- Extend existing read RPC; signatures, grants and RLS policies stay unchanged.
create or replace function private.group_view(p_group uuid,p_section text,p_page integer,p_search text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.study_groups; staff boolean; u uuid:=(select private.current_app_user_id()); result jsonb; session_uuid uuid; group_row record;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_page not between 0 and 100000 or length(p_search)>160 then raise exception 'Invalid page or search' using errcode='23514'; end if;

 -- Summary is caller-scoped even inside this SECURITY DEFINER function.
 if p_section='summary' then
  if p_group is not null and not private.can_view_group(p_group) then raise exception 'Group unavailable' using errcode='42501'; end if;
  select jsonb_build_object(
   'own',jsonb_build_object('attended',count(*) filter(where a.user_id=u and s.attendance_state='finalized' and a.status='attended'),
    'absent',count(*) filter(where a.user_id=u and s.attendance_state='finalized' and a.status='absent')),
   'staff',jsonb_build_object('attended',count(*) filter(where private.can_manage_group(s.group_id) and a.status='attended'),
    'absent',count(*) filter(where private.can_manage_group(s.group_id) and a.status='absent')))
   into result from public.session_attendance a join public.group_sessions s on s.id=a.session_id
   where not s.cancelled and (p_group is null or s.group_id=p_group)
    and (a.user_id=u or private.can_manage_group(s.group_id));
  return result||jsonb_build_object('pendingHomework',(
   select count(*) from public.homework_assignments h
    where private.homework_enrolled(h.id)
    and (p_group is null or h.offering_id=(select offering_id from public.study_groups where id=p_group))
    and not exists(select 1 from public.homework_assignments newer where newer.family_id=h.family_id and newer.status='published' and newer.version>h.version)
    and not exists(select 1 from public.homework_submissions submission where submission.assignment_id=h.id and submission.user_id=u and submission.status='submitted')
  ));
 end if;
 if p_group is null and p_section like 'offering:%' then
  session_uuid:=substring(p_section from 10)::uuid;
  if not private.can_manage_offering(session_uuid) then raise exception 'Offering unavailable' using errcode='42501'; end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(
   select count(*)>25 from (select 1 from public.study_groups listed where listed.offering_id=session_uuid and private.can_view_group(listed.id) and listed.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z))
   into result from (select listed.*,private.can_manage_group(listed.id) as staff,private.can_manage_offering(listed.offering_id) as instructor,o.name as offering_name
    from public.study_groups listed join public.course_offerings o on o.id=listed.offering_id
    where listed.offering_id=session_uuid and private.can_view_group(listed.id) and listed.name ilike '%'||p_search||'%' order by listed.created_at,listed.id limit 25 offset p_page*25) x;
  return result;
 end if;

 if p_group is null then
  if p_section='history' then
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page) into result from (
    select a.status,s.id as session_id,s.title,s.starts_at,listed.name as group_name from public.session_attendance a join public.group_sessions s on s.id=a.session_id join public.study_groups listed on listed.id=s.group_id
    where a.user_id=u and s.attendance_state='finalized' and not s.cancelled order by s.starts_at desc,s.id limit 25 offset p_page*25) x;
   return result;
  end if;
  if p_section='upcoming' then
   if (select count(*) from public.study_groups listed where private.can_view_group(listed.id) and listed.status='active')>100 then raise exception 'Open an individual group to view its sessions' using errcode='23514'; end if;
   for group_row in select id from public.study_groups where status='active' and private.can_view_group(id) order by id limit 100 loop perform private.materialize_group(group_row.id); end loop;
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'serverNow',clock_timestamp(),'page',0,'catchingUp',exists(select 1 from public.group_schedules r join public.study_groups listed on listed.id=r.group_id where r.active and private.can_view_group(listed.id) and r.materialized_through<(clock_timestamp() at time zone 'Africa/Cairo')::date)) into result from (
    select s.*,listed.name as group_name from public.group_sessions s join public.study_groups listed on listed.id=s.group_id where private.can_view_group(listed.id) and not s.cancelled and s.ends_at>clock_timestamp() order by s.starts_at,s.id limit 25) x;
   return result;
  end if;
  if p_section='offerings' then
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.course_offerings o where private.can_manage_offering(o.id) and o.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z)) into result from (select o.id,o.name from public.course_offerings o where private.can_manage_offering(o.id) and o.name ilike '%'||p_search||'%' order by o.id limit 25 offset p_page*25) x;
   return result;
  end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.study_groups listed where private.can_view_group(listed.id) and listed.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z),'serverNow',clock_timestamp()) into result
  from (select listed.*,private.can_manage_group(listed.id) as staff,private.can_manage_offering(listed.offering_id) as instructor,o.name as offering_name from public.study_groups listed join public.course_offerings o on o.id=listed.offering_id where private.can_view_group(listed.id) and listed.name ilike '%'||p_search||'%' order by listed.created_at,listed.id limit 25 offset p_page*25) x;
  return result;
 end if;
 select * into g from public.study_groups where id=p_group;
 staff:=private.can_manage_group(p_group);
 if not private.can_view_group(p_group) then
  if p_section<>'history' or not exists(select 1 from public.group_memberships where group_id=p_group and user_id=u) then raise exception 'Group unavailable' using errcode='42501'; end if;
 end if;
 if p_section='detail' then
  return jsonb_build_object('group',to_jsonb(g)||jsonb_build_object('staff',staff,'instructor',private.can_manage_offering(g.offering_id),'offering_name',(select name from public.course_offerings where id=g.offering_id)),
  'schedules',(select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'time',to_char(local_time,'HH24:MI'),'durationMinutes',duration_minutes)),'[]'::jsonb) from public.group_schedules where group_id=g.id and active),'serverNow',clock_timestamp());
 elsif p_section='sessions' then
  perform private.materialize_group(g.id);
  if not private.can_view_group(g.id) then raise exception 'Access changed' using errcode='42501'; end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'serverNow',clock_timestamp(),'nextSession',(select to_jsonb(ns) from public.group_sessions ns where ns.group_id=g.id and not ns.cancelled and ns.ends_at>clock_timestamp() order by ns.starts_at,ns.id limit 1),'catchingUp',exists(select 1 from public.group_schedules r where r.group_id=g.id and r.active and r.materialized_through<(clock_timestamp() at time zone 'Africa/Cairo')::date),'hasMore',(select count(*)>25 from (select 1 from public.group_sessions where group_id=g.id limit 26 offset p_page*25) z)) into result
  from (select s.*,case when s.cancelled then 'cancelled' when s.ends_at<=clock_timestamp() then 'completed' when s.starts_at<=clock_timestamp() then 'ongoing' else 'upcoming' end as state
   from public.group_sessions s where s.group_id=g.id order by case when s.ends_at>clock_timestamp() and not s.cancelled then 0 else 1 end,case when s.ends_at>clock_timestamp() and not s.cancelled then s.starts_at end asc,s.starts_at desc,s.id limit 25 offset p_page*25) x;
 elsif p_section in ('members','eligible','staff','audit') then
  if not staff then raise exception 'Staff required' using errcode='42501'; end if;
  if p_section='members' then
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.group_memberships m join public.profiles p on p.id=m.user_id where m.group_id=g.id and coalesce(p.display_name,'') ilike '%'||p_search||'%' limit 26 offset p_page*25) z)) into result
   from (select m.*,p.display_name,exists(select 1 from public.enrollments e where e.id=m.enrollment_id and e.status='active' and (e.expires_at is null or e.expires_at>clock_timestamp()) and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp())) as eligible from public.group_memberships m join public.profiles p on p.id=m.user_id where m.group_id=g.id and coalesce(p.display_name,'') ilike '%'||p_search||'%' order by m.starts_at desc,m.id limit 25 offset p_page*25) x;
  elsif p_section='eligible' then
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.enrollments e join public.profiles p on p.id=e.user_id where e.offering_id=g.offering_id and e.status='active' and p.status='active' and (e.expires_at is null or e.expires_at>clock_timestamp()) and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and coalesce(p.display_name,'') ilike '%'||p_search||'%' limit 26 offset p_page*25) z)) into result
   from (select e.user_id,p.display_name from public.enrollments e join public.profiles p on p.id=e.user_id where e.offering_id=g.offering_id and e.status='active' and p.status='active' and (e.expires_at is null or e.expires_at>clock_timestamp()) and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and coalesce(p.display_name,'') ilike '%'||p_search||'%' order by p.display_name,e.user_id limit 25 offset p_page*25) x;
  elsif p_section='staff' then
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page) into result from (select os.user_id,p.display_name,exists(select 1 from public.group_staff gs where gs.group_id=g.id and gs.user_id=os.user_id) as assigned from public.offering_staff os join public.profiles p on p.id=os.user_id where os.offering_id=g.offering_id order by os.user_id limit 25 offset p_page*25) x;
  else
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page) into result from (select action,reason,actor_id,created_at,before_data,after_data from private.group_audit where group_id=g.id order by created_at desc,id limit 25 offset p_page*25) x;
  end if;
 elsif p_section='history' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page) into result from (
   select a.user_id,a.status,s.id as session_id,s.title,s.starts_at,p.display_name from public.session_attendance a join public.group_sessions s on s.id=a.session_id join public.profiles p on p.id=a.user_id
   where s.group_id=g.id and not s.cancelled and (staff or (a.user_id=u and s.attendance_state='finalized')) and (p_search='' or a.user_id::text=p_search or coalesce(p.display_name,'') ilike '%'||p_search||'%') order by s.starts_at desc,a.user_id limit 25 offset p_page*25) x;
 else
  if not staff then raise exception 'Staff required' using errcode='42501'; end if;
  session_uuid:=p_section::uuid;
   if not exists(select 1 from public.group_sessions where id=session_uuid and group_id=g.id) then raise exception 'Session unavailable' using errcode='42501'; end if;
   perform private.snapshot_group_roster(session_uuid);
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.session_attendance where session_id=session_uuid limit 26 offset p_page*25) z),
    'session',(select to_jsonb(s) from public.group_sessions s where id=session_uuid),
    'counts',(select jsonb_build_object('attended',count(*) filter(where status='attended'),'absent',count(*) filter(where status='absent'),'not_marked',count(*) filter(where status='not_marked')) from public.session_attendance where session_id=session_uuid)) into result
   from (select a.*,p.display_name from public.session_attendance a join public.profiles p on p.id=a.user_id where a.session_id=session_uuid order by a.user_id limit 25 offset p_page*25) x;
 end if;
 return result;
end$$;

-- Retain the existing notification policy when propagating future group defaults.
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
  if new.mode<>'online' or new.cancelled or new.starts_at<=clock_timestamp() or new.join_url='' then return new;end if;
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
