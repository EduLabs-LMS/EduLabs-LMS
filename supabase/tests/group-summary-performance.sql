-- Disposable local PostgreSQL only; everything rolls back; synthetic people only. Covers migration 20261105120000_group_summary_performance.sql
-- (run with every earlier migration applied): the new summary returns exactly what the previous private.group_view returned, for a teacher of several
-- groups in two spaces, an assistant, a student of several groups, a student whose membership ended, the owner of another space and a person with nothing,
-- with and without a group, with cancelled sessions and draft, reopened and finalized attendance, and homework. The previous function is installed
-- below under another name so both run in the same database. Timing at 20,000+ rows is in group-summary-performance-benchmark.sql.
begin;
create temp table gsp_results(name text primary key);
grant select,insert on gsp_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.gsp_results values(label);end$$;
create function pg_temp.claim(u uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub',u::text)::text,true)::void$$;
create function pg_temp.u(n integer) returns uuid language sql as $$select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.g(n integer) returns uuid language sql as $$select ('a1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
-- One summary call, as the signed-in user, by function name: the JSON it returned, or ERR plus the SQLSTATE of the refusal.
-- The same person signing in with Firebase: the subject is NOT a UUID, the issuer and audience are the project's, and the identity row maps it to the profile.
create function pg_temp.fbclaim(u uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,'auth_time',floor(extract(epoch from now()))::bigint,'sub','gsp-firebase-'||right(u::text,3))::text,true)::void$$;
create function pg_temp.call(fn text,who uuid,grp uuid,fb boolean default false) returns text language plpgsql as $$declare r jsonb;begin
 if fb then perform pg_temp.fbclaim(who); else perform pg_temp.claim(who); end if;
 begin execute format('select %s($1,''summary'',0,'''')',fn) into r using grp; return r::text;
 exception when others then return 'ERR '||sqlstate; end;end$$;

-- The function as it was before this migration, under another name, so the two can be compared in the same database.
create or replace function private.group_view_before(p_group uuid,p_section text,p_page integer,p_search text) returns jsonb language plpgsql security definer set search_path='' as $$
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
grant execute on function private.group_view_before(uuid,text,integer,text) to authenticated;

-- Synthetic people from the development seed (teacher 2 teaches in space 1 and administers space 2; assistant 4; students 5, 6, 7; owner of space 2 is 3)
-- plus one person who has nothing at all.
insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.u(225),'authenticated','authenticated','gsp-nobody@example.invalid','','infinity','{"provider":"email"}'::jsonb,'{"display_name":"GSP nobody"}'::jsonb,now(),now());
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values
 ('60000000-0000-0000-0000-000000000001',pg_temp.u(4),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000001',pg_temp.u(6),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000002',pg_temp.u(2),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000002',pg_temp.u(5),'active',now()-interval '90 days') on conflict(offering_id,user_id) do nothing;
-- Four groups: A and B in offering 1, C in offering 2 (same space), X in space 2.
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values
 (pg_temp.g(1),'60000000-0000-0000-0000-000000000001','GSP A','center','Room 1',pg_temp.u(2)),
 (pg_temp.g(2),'60000000-0000-0000-0000-000000000001','GSP B','center','Room 2',pg_temp.u(2)),
 (pg_temp.g(3),'60000000-0000-0000-0000-000000000002','GSP C','center','Room 3',pg_temp.u(2)),
 (pg_temp.g(4),'60000000-0000-0000-0000-000000000003','GSP X','center','Room 4',pg_temp.u(3));
insert into public.group_staff(group_id,user_id) values(pg_temp.g(1),pg_temp.u(4));
-- Student 5 is in A and C (one active Group per course); student 6 was in B (ended) and is in C; the teacher and the assistant are also students of C and B; student 7 is in X.
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
select v.g,e.offering_id,e.user_id,e.id,now()-interval '60 days',v.ends,pg_temp.u(2)
from (values (pg_temp.g(1),pg_temp.u(5),null::timestamptz),(pg_temp.g(3),pg_temp.u(5),null),(pg_temp.g(2),pg_temp.u(4),null),(pg_temp.g(2),pg_temp.u(6),now()-interval '1 day'),
 (pg_temp.g(3),pg_temp.u(6),null),(pg_temp.g(3),pg_temp.u(2),null),(pg_temp.g(4),pg_temp.u(7),null)) v(g,who,ends)
join public.study_groups sg on sg.id=v.g join public.enrollments e on e.offering_id=sg.offering_id and e.user_id=v.who;
-- Sessions: finalized x2, a draft, a reopened one, a cancelled one and an upcoming one, in every group.
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
select sg.id,'Lesson '||v.k,v.t,v.t+interval '1 hour',v.t,v.t+interval '1 hour','center',v.c,v.st,pg_temp.u(2),pg_temp.u(2)
from public.study_groups sg cross join (values (1,now()-interval '20 days','finalized',false),(2,now()-interval '15 days','finalized',false),(3,now()-interval '10 days','draft',false),
 (4,now()-interval '5 days','reopened',false),(5,now()-interval '3 days','finalized',true),(6,now()+interval '2 days','draft',false)) v(k,t,st,c)
where sg.id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4));
insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by)
select s.id,m.user_id,m.id,(array['attended','absent','not_marked'])[1+(right(s.title,1)::int+('x'||right(m.user_id::text,2))::bit(8)::int)%3],pg_temp.u(2)
from public.group_sessions s join public.group_memberships m on m.group_id=s.group_id where s.group_id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4));
-- Homework: one pending in offering 1 (students 5 and 6 and the assistant are enrolled there), one already submitted by student 5, one in offering 2, one draft.
insert into public.homework_assignments(id,course_id,offering_id,lesson_id,title,status,family_id,created_by) values
 ('e3000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','GSP pending','published','e3000000-0000-0000-0000-0000000000a1',pg_temp.u(2)),
 ('e3000000-0000-0000-0000-0000000000a2','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','GSP submitted','published','e3000000-0000-0000-0000-0000000000a2',pg_temp.u(2)),
 ('e3000000-0000-0000-0000-0000000000a3','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','GSP other offering','published','e3000000-0000-0000-0000-0000000000a3',pg_temp.u(2)),
 ('e3000000-0000-0000-0000-0000000000a4','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','GSP draft','draft','e3000000-0000-0000-0000-0000000000a4',pg_temp.u(2));
insert into public.homework_submissions(assignment_id,user_id,number,status,submitted_at) values('e3000000-0000-0000-0000-0000000000a2',pg_temp.u(5),1,'submitted',now());

-- Each person also has a Firebase identity (as the database owner, the way the onboarding function would have stored it).
insert into private.external_identities(profile_id,provider,issuer,subject,verified_at)
select p.id,'firebase','https://securetoken.google.com/diagonproduction','gsp-firebase-'||right(p.id::text,3),now()
from public.profiles p where p.id in (pg_temp.u(2),pg_temp.u(3),pg_temp.u(4),pg_temp.u(5),pg_temp.u(6),pg_temp.u(7),pg_temp.u(225));
select pg_temp.ok((select count(*)=7 from private.external_identities where provider='firebase' and subject like 'gsp-firebase-%' and subject !~ '^[0-9a-f-]{36}$'),'seven Firebase identities with subjects that are not UUIDs');

-- ---------------------------------------------------------------- what the data really holds (as the database owner), so nothing is compared as zeros
select set_config('gsp.u5_att',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where a.user_id=pg_temp.u(5) and s.attendance_state='finalized' and not s.cancelled and a.status='attended')::text,true);
select set_config('gsp.u5_abs',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where a.user_id=pg_temp.u(5) and s.attendance_state='finalized' and not s.cancelled and a.status='absent')::text,true);
select set_config('gsp.all_att',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4)) and not s.cancelled and a.status='attended')::text,true);
select set_config('gsp.all_abs',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4)) and not s.cancelled and a.status='absent')::text,true);
select set_config('gsp.all_att_with_cancelled',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4)) and a.status='attended')::text,true);
select set_config('gsp.x_att',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id=pg_temp.g(4) and not s.cancelled and a.status='attended')::text,true);
select set_config('gsp.a_att',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id=pg_temp.g(1) and not s.cancelled and a.status='attended')::text,true);
select set_config('gsp.a_abs',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where s.group_id=pg_temp.g(1) and not s.cancelled and a.status='absent')::text,true);
select set_config('gsp.u4_own_att',(select count(*) from public.session_attendance a join public.group_sessions s on s.id=a.session_id where a.user_id=pg_temp.u(4) and s.attendance_state='finalized' and not s.cancelled and a.status='attended')::text,true);
select set_config('gsp.rows',(select count(*) from public.session_attendance where session_id in (select id from public.group_sessions where group_id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4))))::text,true);
select pg_temp.ok(current_setting('gsp.rows')::int>=40 and current_setting('gsp.all_att')::int>0 and current_setting('gsp.all_abs')::int>0 and current_setting('gsp.u5_att')::int>0,'the fixture has real attendance in every state');
select pg_temp.ok(current_setting('gsp.all_att_with_cancelled')::int>current_setting('gsp.all_att')::int,'the fixture has marks on a cancelled session that must not be counted');
select pg_temp.ok((select count(distinct attendance_state)=3 and bool_or(cancelled) from public.group_sessions where group_id=pg_temp.g(1)),'draft, reopened and finalized sessions and a cancelled one exist');

-- ---------------------------------------------------------------- the old and the new function, person by person and group by group
set local role authenticated;
do $$declare who uuid;grp uuid;a text;b text;n integer:=0;bad integer:=0;real integer:=0;begin
 foreach who in array array[pg_temp.u(2),pg_temp.u(3),pg_temp.u(4),pg_temp.u(5),pg_temp.u(6),pg_temp.u(7),pg_temp.u(225)] loop
  foreach grp in array array[null::uuid,pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4)] loop
   a:=pg_temp.call('private.group_view_before',who,grp); b:=pg_temp.call('private.group_view',who,grp); n:=n+1;
   if a is distinct from b then bad:=bad+1; raise warning 'DIFFERENT for % group %: before % after %',who,grp,a,b; end if;
   if a not like 'ERR%' and a not like '%"attended": 0%"absent": 0%"attended": 0%"absent": 0%' then real:=real+1; end if;
  end loop;
 end loop;
 perform set_config('gsp.cases',n::text,true);perform set_config('gsp.bad',bad::text,true);perform set_config('gsp.real',real::text,true);
end$$;
select pg_temp.ok(current_setting('gsp.bad')::int=0,'before and after agree in all '||current_setting('gsp.cases')||' cases');
select pg_temp.ok(current_setting('gsp.cases')::int=35 and current_setting('gsp.real')::int>=15,'the comparison covered 35 cases, at least 15 with real counts ('||current_setting('gsp.real')||')');

-- The same 35 cases signed in with Firebase: the old and the new function agree, the Firebase answer is the one the same person gets with a Supabase
-- sign-in, and nothing raises 22P02 (auth.uid() casts the subject to uuid, which a Firebase subject is not).
do $$declare who uuid;grp uuid;a text;b text;c text;n integer:=0;bad integer:=0;real integer:=0;raised integer:=0;begin
 foreach who in array array[pg_temp.u(2),pg_temp.u(3),pg_temp.u(4),pg_temp.u(5),pg_temp.u(6),pg_temp.u(7),pg_temp.u(225)] loop
  foreach grp in array array[null::uuid,pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4)] loop
   a:=pg_temp.call('private.group_view_before',who,grp,true); b:=pg_temp.call('private.group_view',who,grp,true); c:=pg_temp.call('private.group_view',who,grp); n:=n+1;
   if a is distinct from b or b is distinct from c then bad:=bad+1; raise warning 'FIREBASE DIFFERENT for % group %: before % after % supabase %',who,grp,a,b,c; end if;
   if b like 'ERR 22%' or a like 'ERR 22%' then raised:=raised+1; end if;
   if b not like 'ERR%' and b not like '%"attended": 0%"absent": 0%"attended": 0%"absent": 0%' then real:=real+1; end if;
  end loop;
 end loop;
 perform set_config('gsp.fbcases',n::text,true);perform set_config('gsp.fbbad',bad::text,true);perform set_config('gsp.fbreal',real::text,true);perform set_config('gsp.fbraised',raised::text,true);
end$$;
select pg_temp.ok(current_setting('gsp.fbraised')::int=0,'no Firebase call raised an invalid-uuid error (22P02)');
select pg_temp.ok(current_setting('gsp.fbbad')::int=0 and current_setting('gsp.fbcases')::int=35 and current_setting('gsp.fbreal')::int>=15,'with a Firebase sign-in, before and after agree in all 35 cases and match the Supabase sign-in ('||current_setting('gsp.fbreal')||' with real counts)');

-- ---------------------------------------------------------------- and the values are the right ones, not merely equal
create function pg_temp.f(who uuid,grp uuid,fb boolean default false) returns jsonb language sql as $$select pg_temp.call('private.group_view',who,grp,fb)::jsonb$$;
select pg_temp.ok((pg_temp.f(pg_temp.u(2),null)->'staff'->>'attended')=current_setting('gsp.all_att') and (pg_temp.f(pg_temp.u(2),null)->'staff'->>'absent')=current_setting('gsp.all_abs'),'a teacher of several groups in two spaces: every mark of every group they manage, no cancelled session');
select pg_temp.ok((pg_temp.f(pg_temp.u(2),pg_temp.g(1))->'staff'->>'attended')=current_setting('gsp.a_att') and (pg_temp.f(pg_temp.u(2),pg_temp.g(1))->'staff'->>'absent')=current_setting('gsp.a_abs'),'with a group: only that group');
select pg_temp.ok((pg_temp.f(pg_temp.u(4),null)->'staff'->>'attended')=current_setting('gsp.a_att') and (pg_temp.f(pg_temp.u(4),null)->'staff'->>'absent')=current_setting('gsp.a_abs'),'an assistant: only the group they are assigned to');
select pg_temp.ok((pg_temp.f(pg_temp.u(4),null)->'own'->>'attended')=current_setting('gsp.u4_own_att'),'an assistant is also a student of another group: own finalized marks counted');
select pg_temp.ok((pg_temp.f(pg_temp.u(3),null)->'staff'->>'attended')=current_setting('gsp.x_att'),'the owner of the other space counts only their own space');
select pg_temp.ok((pg_temp.f(pg_temp.u(5),null)->'own'->>'attended')=current_setting('gsp.u5_att') and (pg_temp.f(pg_temp.u(5),null)->'own'->>'absent')=current_setting('gsp.u5_abs'),'a student of several groups: own finalized marks only (draft and reopened are not released)');
select pg_temp.ok((pg_temp.f(pg_temp.u(5),null)->'staff')='{"attended":0,"absent":0}'::jsonb,'a student sees no staff counts');
select pg_temp.ok(pg_temp.f(pg_temp.u(225),null)='{"own":{"attended":0,"absent":0},"staff":{"attended":0,"absent":0},"pendingHomework":0}'::jsonb,'a person with nothing gets zeros');
select pg_temp.ok(pg_temp.call('private.group_view',pg_temp.u(5),pg_temp.g(2))='ERR 42501' and pg_temp.call('private.group_view',pg_temp.u(5),pg_temp.g(4))='ERR 42501','a group the caller cannot see is still refused');
select pg_temp.ok(pg_temp.call('private.group_view',pg_temp.u(6),pg_temp.g(2))='ERR 42501','a former member is still refused');
select pg_temp.ok((pg_temp.f(pg_temp.u(5),null)->>'pendingHomework')='2' and (pg_temp.f(pg_temp.u(6),null)->>'pendingHomework')='3' and (pg_temp.f(pg_temp.u(4),null)->>'pendingHomework')='2' and (pg_temp.f(pg_temp.u(7),null)->>'pendingHomework')='0','pending homework: submitted, draft and other offerings are not counted');
select pg_temp.ok((pg_temp.f(pg_temp.u(2),null,true)->'staff'->>'attended')=current_setting('gsp.all_att') and (pg_temp.f(pg_temp.u(2),pg_temp.g(1),true)->'staff'->>'absent')=current_setting('gsp.a_abs'),'Firebase teacher: every group they manage, and one group when given');
select pg_temp.ok((pg_temp.f(pg_temp.u(4),null,true)->'staff'->>'attended')=current_setting('gsp.a_att') and (pg_temp.f(pg_temp.u(4),null,true)->'own'->>'attended')=current_setting('gsp.u4_own_att'),'Firebase assistant: the assigned group and their own marks');
select pg_temp.ok((pg_temp.f(pg_temp.u(5),null,true)->'own'->>'attended')=current_setting('gsp.u5_att') and (pg_temp.f(pg_temp.u(5),null,true)->'staff')='{"attended":0,"absent":0}'::jsonb and (pg_temp.f(pg_temp.u(5),null,true)->>'pendingHomework')='2','Firebase student: own finalized marks, no staff counts, pending homework');
select pg_temp.ok(pg_temp.f(pg_temp.u(225),null,true)='{"own":{"attended":0,"absent":0},"staff":{"attended":0,"absent":0},"pendingHomework":0}'::jsonb,'Firebase person with nothing: zeros, no error');
select pg_temp.ok(pg_temp.call('private.group_view',pg_temp.u(5),pg_temp.g(4),true)='ERR 42501','Firebase student asking for a group they cannot see: still refused with 42501');

-- ---------------------------------------------------------------- the same function, the same grants
reset role;
select pg_temp.ok((select p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_function_identity_arguments(p.oid)='p_group uuid, p_section text, p_page integer, p_search text' and l.lanname='plpgsql' from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.group_view(uuid,text,integer,text)'::regprocedure),'same signature, language, security definer and search_path');
select pg_temp.ok(has_function_privilege('authenticated','private.group_view(uuid,text,integer,text)','execute') and not has_function_privilege('anon','private.group_view(uuid,text,integer,text)','execute') and not has_function_privilege('anon','public.group_view(uuid,text,integer,text)','execute') and has_function_privilege('authenticated','public.group_view(uuid,text,integer,text)','execute'),'grants unchanged');
select pg_temp.ok((select pg_get_functiondef('private.group_view(uuid,text,integer,text)'::regprocedure) like '%private.can_manage_group(s.group_id)%')=false,'the per-row authorization call is gone from the summary');

select count(*)||' checks passed' as group_summary_performance_tests from gsp_results;
rollback;
