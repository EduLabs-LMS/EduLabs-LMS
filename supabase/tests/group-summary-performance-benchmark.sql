-- Benchmark, not part of the default suite (run: node scripts/exam-sql-local.cjs --postgres --bench). Disposable local PostgreSQL only; rolls back.
-- Builds 6 extra spaces with 20 learners, 1 group and 170 sessions each (20,400 attendance rows) next to the equivalence fixture, then times
-- the summary EXPLAIN (ANALYZE) before and after migration 20261105120000 for a teacher and a student, and checks that the answers are equal.
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
create function pg_temp.call(fn text,who uuid,grp uuid) returns text language plpgsql as $$declare r jsonb;begin
 perform pg_temp.claim(who);
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

reset role;
insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','gsp-bulk-'||n||'@example.invalid','','infinity','{"provider":"email"}'::jsonb,jsonb_build_object('display_name','GSP bulk '||n),now(),now() from generate_series(1,20) n;
insert into public.organizations(id,name,slug,created_by) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'GSP bulk space '||n,'gsp-bulk-'||n,pg_temp.u(1) from generate_series(1,6) n;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,pg_temp.u(1),'owner','active',now() from generate_series(1,6) n on conflict(organization_id,user_id) do nothing;
insert into public.courses(id,organization_id,title,slug,status,created_by) select ('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'GSP bulk course '||n,'gsp-bulk-course-'||n,'published',pg_temp.u(1) from generate_series(1,6) n;
insert into public.course_offerings(id,course_id,name,delivery_mode,status,capacity) select ('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'GSP bulk offering '||n,'blended','active',100 from generate_series(1,6) n;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select ('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '300 days' from generate_series(1,6) o cross join generate_series(1,20) n;
insert into public.study_groups(id,offering_id,name,mode,location,created_by) select ('a2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'GSP bulk group '||n,'center','Room',pg_temp.u(1) from generate_series(1,6) n;
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by) select ('a2000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,e.offering_id,e.user_id,e.id,now()-interval '300 days',pg_temp.u(1)
 from generate_series(1,6) o join public.enrollments e on e.offering_id=('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid;
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select ('a2000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,'Bulk '||k,now()-(k||' days')::interval,now()-(k||' days')::interval+interval '1 hour',now()-(k||' days')::interval,now()-(k||' days')::interval+interval '1 hour','center',k%17=0,(array['finalized','draft','reopened'])[1+k%3],pg_temp.u(1),pg_temp.u(1)
 from generate_series(1,6) o cross join generate_series(1,170) k;
insert into public.session_attendance(session_id,user_id,membership_id,status,updated_by)
 select s.id,m.user_id,m.id,(array['attended','absent','not_marked'])[1+abs(hashtext(s.id::text||m.user_id::text))%3],pg_temp.u(1)
 from public.group_sessions s join public.group_memberships m on m.group_id=s.group_id where s.group_id::text like 'a2000000%';
select pg_temp.ok((select count(*) from public.session_attendance)>=20000,'at least 20,000 attendance rows across several spaces ('||(select count(*) from public.session_attendance)||')');
analyze public.session_attendance; analyze public.group_sessions; analyze public.group_memberships; analyze public.study_groups;

create temp table gsp_timing(person text,version text,ms numeric);
grant select,insert on gsp_timing to authenticated;
create function pg_temp.explain_ms(fn text,who uuid) returns numeric language plpgsql as $$declare line text;ms numeric;begin
 perform pg_temp.claim(who);
 for line in execute format('explain (analyze, costs off, timing off) select %s(null,''summary'',0,'''')',fn) loop
  if line like 'Execution Time:%' then ms:=substring(line from 'Execution Time: ([0-9.]+)')::numeric; end if;
 end loop;
 return ms;end$$;
set local role authenticated;
do $$declare who uuid;label text;begin
 for who,label in select pg_temp.u(2),'teacher' union all select pg_temp.u(5),'student' loop
  insert into gsp_timing values(label,'before',pg_temp.explain_ms('private.group_view_before',who));
  insert into gsp_timing values(label,'after',pg_temp.explain_ms('private.group_view',who));
  if pg_temp.call('private.group_view_before',who,null) is distinct from pg_temp.call('private.group_view',who,null) then raise exception 'FAILED answers differ at scale for %',label; end if;
 end loop;
end$$;
select pg_temp.ok((select bool_and(a.ms<b.ms) from gsp_timing a join gsp_timing b on a.person=b.person and a.version='after' and b.version='before'),'the new summary is faster than the old one for both');
reset role;
select jsonb_agg(jsonb_build_object('person',person,'version',version,'ms',ms) order by person,version) as gsp_bench_results from gsp_timing;
select count(*)||' checks passed' as gsp_bench_tests from gsp_results;
rollback;
