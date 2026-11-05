-- Disposable local PostgreSQL only; everything rolls back; synthetic people only. Covers migration 20261106120000_listing_performance.sql (run with every
-- earlier migration applied): the new private.group_view listing sections (default list, offering:<id>, offerings, upcoming) and the new
-- private.student_administration actions (offerings, metrics) return exactly what the previous functions returned, for a teacher of several groups in two
-- spaces, an assistant, students, a former member, the owner of another space, the owner of many extra spaces, and a person with nothing, with a
-- Supabase-style sign-in and with a Firebase sign-in (subject is not a UUID). The previous functions are installed below under other names so both run
-- in the same database. Timing on a large synthetic dataset is in listing-performance-benchmark.sql.
begin;
create temp table lp_results(name text primary key);
grant select,insert on lp_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.lp_results values(label);end$$;
create function pg_temp.claim(u uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub',u::text)::text,true)::void$$;
create function pg_temp.u(n integer) returns uuid language sql as $$select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.g(n integer) returns uuid language sql as $$select ('a1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
-- The same person signing in with Firebase: the subject is NOT a UUID, the issuer and audience are the project's, and the identity row maps it to the profile.
create function pg_temp.fbclaim(u uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,'auth_time',floor(extract(epoch from now()))::bigint,'sub','lp-firebase-'||u::text)::text,true)::void$$;
create function pg_temp.sign(who uuid,fb boolean) returns void language plpgsql as $$begin
 if fb then perform pg_temp.fbclaim(who); else perform pg_temp.claim(who); end if;end$$;
-- One listing call as the signed-in user, by function name: the JSON it returned (without the clock), or ERR plus the SQLSTATE of the refusal.
create function pg_temp.vcall(fn text,who uuid,section text,page integer,search text,fb boolean default false) returns text language plpgsql as $$declare r jsonb;begin
 perform pg_temp.sign(who,fb);
 begin execute format('select %s(null::uuid,$1,$2,$3)',fn) into r using section,page,search; return (r-'serverNow')::text;
 exception when others then return 'ERR '||sqlstate; end;end$$;
create function pg_temp.acall(fn text,who uuid,action text,data jsonb,fb boolean default false) returns text language plpgsql as $$declare r jsonb;begin
 perform pg_temp.sign(who,fb);
 begin execute format('select %s($1,null::uuid,null::uuid,null::bigint,null::uuid,$2)',fn) into r using action,data; return r::text;
 exception when others then return 'ERR '||sqlstate; end;end$$;

-- The functions as they were before this migration, under other names, so the two can be compared in the same database.
create or replace function private.group_view_before(p_group uuid,p_section text,p_page integer,p_search text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.study_groups; staff boolean; u uuid:=(select private.current_app_user_id()); result jsonb; session_uuid uuid; group_row record; managed uuid[]; offs uuid[];
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_page not between 0 and 100000 or length(p_search)>160 then raise exception 'Invalid page or search' using errcode='23514'; end if;

 -- Summary is caller-scoped even inside this SECURITY DEFINER function.
 if p_section='summary' then
  if p_group is not null and not private.can_view_group(p_group) then raise exception 'Group unavailable' using errcode='42501'; end if;
  -- The groups this caller manages, decided ONCE (not once per attendance row, three times). Managing a group needs an active membership of its
  -- organization (private.has_org_role / is_org_member, which resolve the caller with private.current_app_user_id()), so only groups of the caller's
  -- organizations are candidates; each candidate still goes through private.can_manage_group, so the answer is exactly the one the per-row call gave.
  -- The caller is the profile resolved once above (u), never the token subject cast to uuid: a Firebase subject is not a UUID, and that cast raises 22P02.
  managed:=array(select g2.id from public.study_groups g2 join public.course_offerings o2 on o2.id=g2.offering_id join public.courses c2 on c2.id=o2.course_id
   where (p_group is null or g2.id=p_group)
    and c2.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active')
    and private.can_manage_group(g2.id));
  -- Only two bounded sets are read: the caller's own marks (index on user_id) and the marks of the sessions of the groups the caller manages.
  select jsonb_build_object(
   'own',jsonb_build_object('attended',count(*) filter(where r.kind='own' and r.final and r.status='attended'),
    'absent',count(*) filter(where r.kind='own' and r.final and r.status='absent')),
   'staff',jsonb_build_object('attended',count(*) filter(where r.kind='staff' and r.status='attended'),
    'absent',count(*) filter(where r.kind='staff' and r.status='absent')))
   into result from (
    select 'own'::text as kind,(s.attendance_state='finalized') as final,a.status from public.session_attendance a join public.group_sessions s on s.id=a.session_id
     where a.user_id=u and not s.cancelled and (p_group is null or s.group_id=p_group)
    union all
    select 'staff'::text,false,a.status from public.group_sessions s join public.session_attendance a on a.session_id=s.id
     where s.group_id=any(managed) and not s.cancelled and (p_group is null or s.group_id=p_group)) r;
  -- Homework is visible only in an offering the caller is enrolled in (private.homework_enrolled requires it), so only those offerings are
  -- candidates; the function still decides each one.
  offs:=array(select e.offering_id from public.enrollments e where e.user_id=u and e.status='active');
  return result||jsonb_build_object('pendingHomework',(
   select count(*) from public.homework_assignments h
    where h.offering_id=any(offs) and private.homework_enrolled(h.id)
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
create or replace function private.student_administration_before(p_action text,p_offering uuid,p_subject uuid,p_version bigint,p_request uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.current_app_user_id(); f public.course_offerings; course_row public.courses; link private.student_access_links;
 req public.enrollment_requests; enrollment_row public.enrollments; saved private.student_admin_commands; result jsonb; previous jsonb:='{}';
 fingerprint text; token text:=p_data->>'token'; page integer:=coalesce((p_data->>'page')::integer,0); search text:=coalesce(p_data->>'search','');
 filter text:=coalesce(p_data->>'filter','all'); expires timestamptz; v bigint; target uuid:=p_subject; org uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8000 or page not between 0 and 100000 or length(search)>120 then raise exception 'Invalid input' using errcode='23514';end if;
 if p_action='offerings' then
  return jsonb_build_object('page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select o.id,o.name,c.title course_title,g.name organization_name,private.can_manage_offering(o.id) manage
   from public.course_offerings o join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id
   where private.can_support_offering(o.id) order by g.name,o.name,o.id limit 25 offset page*25)x),'[]'));
 elsif p_action='metrics' then
  if p_data->>'organizationId' is not null then org:=(p_data->>'organizationId')::uuid;
   if not private.is_org_member(org) then raise exception 'Organization unavailable' using errcode='42501';end if;
  end if;
  return jsonb_build_object(
   'totalStudents',(select count(distinct e.user_id) from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id join public.profiles p on p.id=e.user_id
    where private.can_support_offering(o.id) and (org is null or c.organization_id=org) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp()) and p.status='active' and o.status='active' and c.status='published' and g.status='active'),
   'pendingWaitlistCount',(select count(*) from public.enrollment_requests r join public.course_offerings o on o.id=r.offering_id join public.courses c on c.id=o.course_id where r.status='pending' and private.can_support_offering(o.id) and (org is null or c.organization_id=org)),
   'pendingHomeworkCount',(select count(*) from public.homework_submissions s join private.homework_corrections h on h.submission_id=s.id join public.homework_assignments a on a.id=s.assignment_id join public.courses c on c.id=a.course_id where s.status='submitted' and h.status='under_correction' and h.released_at is null and private.homework_staff(a.id,'grade') and (org is null or c.organization_id=org)),
   'activeGroupsCount',(select count(*) from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where g.status='active' and private.can_support_offering(o.id) and (org is null or c.organization_id=org))
  );
 elsif p_action='mine' then return jsonb_build_object('profileId',u,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select r.id,r.status,r.version,r.reason,r.created_at,o.name offering_name,g.name organization_name from public.enrollment_requests r join public.course_offerings o on o.id=r.offering_id join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id where r.user_id=u order by r.created_at desc,r.id limit 25 offset page*25)x),'[]'));
 end if;
 if p_action in ('inspect','request','accept') then
  if coalesce(token,'')!~'^[A-Za-z0-9_-]{43}$' then raise exception 'Link unavailable' using errcode='42501';end if;
  select * into link from private.student_access_links where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
  if link.id is null or link.revoked_at is not null or link.expires_at<=clock_timestamp() or (link.kind='invite' and link.recipient_id<>u) or (link.claimed_by is not null and link.claimed_by<>u) or not private.student_link_issuer(link.offering_id,link.created_by) then
   raise exception 'Link unavailable' using errcode='42501';end if;
  p_offering:=link.offering_id;target:=u;
 end if;
 select * into f from public.course_offerings where id=p_offering;
 select * into course_row from public.courses where id=f.course_id;
 if f.id is null then raise exception 'Offering unavailable' using errcode='42501';end if;
 if p_action='inspect' then
  if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') then raise exception 'Link unavailable' using errcode='42501';end if;
  return jsonb_build_object('name',f.name,'organization',(select name from public.organizations where id=course_row.organization_id),'kind',link.kind,'expiresAt',link.expires_at,'enrolled',private.is_enrolled(f.id),'requestStatus',(select status from public.enrollment_requests where offering_id=f.id and user_id=u));
 end if;
 if p_action not in ('request','accept') and not private.can_support_offering(f.id) then raise exception 'Offering unavailable' using errcode='42501';end if;
 if p_action='roster' then
  if filter not in ('all','active','suspended','expired','completed','cancelled','invited') then raise exception 'Invalid filter' using errcode='23514';end if;
  return jsonb_build_object('manage',private.can_manage_offering(f.id),'page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select e.id,e.user_id,p.display_name,e.status,e.expires_at,e.enrolled_at,coalesce(v.version,0) version,
    (e.status='active' and p.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp()) and f.status='active' and course_row.status='published') eligible
   from public.enrollments e join public.profiles p on p.id=e.user_id left join private.enrollment_admin_versions v on v.enrollment_id=e.id
   where e.offering_id=f.id and (search='' or position(lower(search) in lower(coalesce(p.display_name,'')))>0)
   and (filter='all' or filter=e.status and (filter<>'active' or e.expires_at is null or e.expires_at>clock_timestamp()) or filter='expired' and e.expires_at<=clock_timestamp())
   order by coalesce(p.display_name,''),e.id limit 25 offset page*25)x),'[]'));
 elsif p_action='requests' then
  if filter not in ('all','pending','approved','rejected') then raise exception 'Invalid filter' using errcode='23514';end if;
  return jsonb_build_object('manage',private.can_manage_offering(f.id),'page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select r.id,r.user_id,p.display_name,r.status,r.version,r.reason,r.created_at from public.enrollment_requests r join public.profiles p on p.id=r.user_id
   where r.offering_id=f.id and (filter='all' or r.status=filter) and (search='' or position(lower(search) in lower(coalesce(p.display_name,'')))>0)
   order by r.created_at,r.id limit 25 offset page*25)x),'[]'));
 elsif p_action='links' then
  if not private.can_manage_offering(f.id) then raise exception 'Instructor required' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from(select id,kind,expires_at,revoked_at,claimed_at from private.student_access_links where offering_id=f.id order by created_at desc,id limit 25 offset page*25)x),'[]');
 end if;
 if p_request is null then raise exception 'Request ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('student-admin:'||u,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_action,p_offering,p_subject,p_version,p_data)::text,'UTF8')),'hex');
 select * into saved from private.student_admin_commands where actor_id=u and request_id=p_request;
 if found then if fingerprint<>saved.fingerprint then raise exception 'Request ID reused' using errcode='23514';end if;return saved.result;end if;
 if (select count(*) from private.student_admin_commands where actor_id=u and created_at>clock_timestamp()-interval '1 hour')>=(case when private.can_manage_offering(f.id) then 2000 else 100 end) then raise exception 'Command rate limit' using errcode='PT429';end if;
 -- Offering first matches capacity/group enrollment trigger lock order.
 select * into f from public.course_offerings where id=f.id for update;
 select * into course_row from public.courses where id=f.course_id for share;
 perform 1 from public.profiles p where p.id in(u,target,case when p_action in ('request','accept') then link.created_by else u end) order by p.id for share;
 if not private.is_active_user() then raise exception 'Identity revoked' using errcode='42501';end if;
 -- Keep the authorizing membership/assignment stable through the grant transaction.
 perform 1 from public.organization_memberships m where m.organization_id=course_row.organization_id and m.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 perform 1 from public.course_staff s where s.course_id=course_row.id and s.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 perform 1 from public.offering_staff s where s.offering_id=f.id and s.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 -- The existing last-owner trigger locks membership before organization.
 perform 1 from public.organizations where id=course_row.organization_id for share;
 if p_action in ('request','accept') then
  select * into link from private.student_access_links where id=link.id for update;
  if link.revoked_at is not null or link.expires_at<=clock_timestamp() or (link.kind='invite' and link.recipient_id<>u) or (link.claimed_by is not null and link.claimed_by<>u) or not private.student_link_issuer(f.id,link.created_by) then raise exception 'Link unavailable' using errcode='42501';end if;
 else
  if not private.can_manage_offering(f.id) then raise exception 'Instructor required' using errcode='42501';end if;
 end if;
 if p_action='link' then
  if coalesce(token,'')!~'^[A-Za-z0-9_-]{43}$' or p_data->>'kind' not in ('request','invite') then raise exception 'Invalid link' using errcode='23514';end if;
  expires:=(p_data->>'expiresAt')::timestamptz;
  if expires is null or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' or (p_data->>'enrollmentExpiresAt' is not null and (p_data->>'enrollmentExpiresAt')::timestamptz<=clock_timestamp()) then raise exception 'Invalid expiry' using errcode='23514';end if;
  if (select count(*) from private.student_access_links where created_by=u and created_at>clock_timestamp()-interval '1 hour')>=100 then raise exception 'Rate limit' using errcode='PT429';end if;
  if p_data->>'kind'='invite' and not exists(select 1 from public.profiles where id=(p_data->>'recipientId')::uuid and status='active') then raise exception 'Recipient unavailable' using errcode='42501';end if;
  insert into private.student_access_links(offering_id,token_hash,kind,recipient_id,created_by,expires_at,enrollment_expires_at) values(f.id,encode(sha256(convert_to(token,'UTF8')),'hex'),p_data->>'kind',(p_data->>'recipientId')::uuid,u,expires,(p_data->>'enrollmentExpiresAt')::timestamptz) returning * into link;
  result:=jsonb_build_object('id',link.id);target:=null;
 elsif p_action='revoke-link' then
  update private.student_access_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=(p_data->>'linkId')::uuid and offering_id=f.id returning * into link;
  if link.id is null then raise exception 'Link unavailable' using errcode='42501';end if;result:=jsonb_build_object('id',link.id);target:=null;
 elsif p_action='request' then
  if link.kind<>'request' then raise exception 'Wrong link type' using errcode='23514';end if;
  if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or (f.enrollment_opens_at is not null and f.enrollment_opens_at>clock_timestamp()) or (f.enrollment_closes_at is not null and f.enrollment_closes_at<=clock_timestamp()) or (f.ends_at is not null and f.ends_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  if exists(select 1 from public.enrollments where offering_id=f.id and user_id=u) then raise exception 'Contact teacher about existing enrollment' using errcode='23514';end if;
  if (select count(*) from public.enrollment_requests where user_id=u and created_at>clock_timestamp()-interval '1 hour')>=10 and not exists(select 1 from public.enrollment_requests where offering_id=f.id and user_id=u) then raise exception 'Request rate limit' using errcode='PT429';end if;
  insert into public.enrollment_requests(offering_id,user_id) values(f.id,u) on conflict(offering_id,user_id) do nothing;
  select * into req from public.enrollment_requests where offering_id=f.id and user_id=u;
  result:=jsonb_build_object('id',req.id,'status',req.status,'version',req.version);
 elsif p_action in ('approve','reject','accept','enroll') then
  if p_action in ('approve','reject') then
   select * into req from public.enrollment_requests where offering_id=f.id and user_id=target for update;
   if req.id is null then raise exception 'Request unavailable' using errcode='42501';end if;
   if p_version is distinct from req.version then raise exception 'Stale request' using errcode='PT409';end if;
   if req.status<>'pending' then raise exception 'Request already decided' using errcode='PT409';end if;
   previous:=to_jsonb(req);
  elsif p_action='accept' then
   if link.kind<>'invite' then raise exception 'Wrong link type' using errcode='23514';end if;
   if (f.enrollment_opens_at is not null and f.enrollment_opens_at>clock_timestamp()) or (f.enrollment_closes_at is not null and f.enrollment_closes_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  elsif not exists(select 1 from public.enrollments prior_enrollment join public.course_offerings o on o.id=prior_enrollment.offering_id join public.courses pc on pc.id=o.course_id where prior_enrollment.user_id=target and pc.organization_id=course_row.organization_id) then raise exception 'Use a student request or invitation first' using errcode='42501';end if;
  if p_action='reject' then
   update public.enrollment_requests set status='rejected',version=version+1,reason=coalesce(p_data->>'reason',''),reviewed_by=u,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=req.id returning * into req;
   result:=jsonb_build_object('id',req.id,'version',req.version,'status',req.status);
  else
   if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or (f.ends_at is not null and f.ends_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
   if target is null or not exists(select 1 from public.profiles where id=target and status='active') then raise exception 'Student unavailable' using errcode='42501';end if;
   expires:=case when p_action='accept' then link.enrollment_expires_at else (p_data->>'expiresAt')::timestamptz end;
   if expires<=clock_timestamp() then raise exception 'Expiry must be future' using errcode='23514';end if;
   select * into enrollment_row from public.enrollments where offering_id=f.id and user_id=target for update;
   if enrollment_row.id is not null and (enrollment_row.status<>'active' or enrollment_row.expires_at<=clock_timestamp()) then raise exception 'Existing access requires explicit reactivation' using errcode='23514';end if;
   if enrollment_row.id is null then insert into public.enrollments(offering_id,user_id,status,enrolled_at,expires_at,created_by,source) values(f.id,target,'active',now(),expires,case when p_action='accept' then link.created_by else u end,'student-administration') returning * into enrollment_row;end if;
   if req.id is not null then update public.enrollment_requests set status='approved',version=version+1,reviewed_by=u,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=req.id returning * into req;end if;
   if p_action='accept' then
    update private.student_access_links set claimed_by=u,claimed_at=coalesce(claimed_at,clock_timestamp()) where id=link.id;
    update public.enrollment_requests set status='approved',version=version+1,reviewed_by=link.created_by,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where offering_id=f.id and user_id=u and status<>'approved';
   end if;
   result:=jsonb_build_object('id',enrollment_row.id,'status',enrollment_row.status);
  end if;
 elsif p_action in ('suspend','reactivate') then
  select * into enrollment_row from public.enrollments where offering_id=f.id and user_id=target for update;
  if enrollment_row.id is null then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  select coalesce((select version from private.enrollment_admin_versions where enrollment_id=enrollment_row.id),0) into v;
  if p_version is distinct from v then raise exception 'Stale enrollment' using errcode='PT409';end if;
  previous:=to_jsonb(enrollment_row);expires:=(p_data->>'expiresAt')::timestamptz;
    if p_action='reactivate' and (expires<=clock_timestamp() or f.status<>'active' or (f.ends_at is not null and f.ends_at<=clock_timestamp()) or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or not exists(select 1 from public.profiles where id=target and status='active')) then raise exception 'Cannot reactivate' using errcode='23514';end if;
  update public.enrollments set status=case when p_action='suspend' then 'suspended' else 'active' end,
   enrolled_at=case when p_action='reactivate' then now() else enrolled_at end,
   expires_at=case when p_action='reactivate' then expires else expires_at end where id=enrollment_row.id returning * into enrollment_row;
  result:=jsonb_build_object('id',enrollment_row.id,'status',enrollment_row.status,'version',(select version from private.enrollment_admin_versions where enrollment_id=enrollment_row.id));
 else raise exception 'Unknown action' using errcode='23514';end if;
 insert into private.student_admin_audit(offering_id,actor_id,subject_id,action,before_data,after_data) values(f.id,u,target,p_action,previous,result);
 insert into private.student_admin_commands(actor_id,request_id,fingerprint,result) values(u,p_request,fingerprint,result);
 return result;
end$$;
grant execute on function private.student_administration_before(text,uuid,uuid,bigint,uuid,jsonb) to authenticated;

-- Synthetic people from the development seed (teacher 2 teaches in space 1 and administers space 2; assistant 4; students 5, 6, 7; owner of space 2 is 3)
-- plus one person who has nothing at all.
insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.u(225),'authenticated','authenticated','lp-nobody@example.invalid','','infinity','{"provider":"email"}'::jsonb,'{"display_name":"LP nobody"}'::jsonb,now(),now());
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values
 ('60000000-0000-0000-0000-000000000001',pg_temp.u(4),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000001',pg_temp.u(6),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000002',pg_temp.u(2),'active',now()-interval '90 days'),
 ('60000000-0000-0000-0000-000000000002',pg_temp.u(5),'active',now()-interval '90 days') on conflict(offering_id,user_id) do nothing;
-- Four groups: A and B in offering 1, C in offering 2 (same space), X in space 2. Group C is archived-looking material for the upcoming section: it has a schedule.
insert into public.study_groups(id,offering_id,name,mode,location,created_by) values
 (pg_temp.g(1),'60000000-0000-0000-0000-000000000001','LP A','center','Room 1',pg_temp.u(2)),
 (pg_temp.g(2),'60000000-0000-0000-0000-000000000001','LP B','center','Room 2',pg_temp.u(2)),
 (pg_temp.g(3),'60000000-0000-0000-0000-000000000002','LP C','center','Room 3',pg_temp.u(2)),
 (pg_temp.g(4),'60000000-0000-0000-0000-000000000003','LP X','center','Room 4',pg_temp.u(3));
update public.study_groups set status='archived' where id=pg_temp.g(2);
insert into public.group_staff(group_id,user_id) values(pg_temp.g(1),pg_temp.u(4));
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
select v.g,e.offering_id,e.user_id,e.id,now()-interval '60 days',v.ends,pg_temp.u(2)
from (values (pg_temp.g(1),pg_temp.u(5),null::timestamptz),(pg_temp.g(3),pg_temp.u(5),null),(pg_temp.g(2),pg_temp.u(4),null),(pg_temp.g(2),pg_temp.u(6),now()-interval '1 day'),
 (pg_temp.g(3),pg_temp.u(6),null),(pg_temp.g(3),pg_temp.u(2),null),(pg_temp.g(4),pg_temp.u(7),null)) v(g,who,ends)
join public.study_groups sg on sg.id=v.g join public.enrollments e on e.offering_id=sg.offering_id and e.user_id=v.who;
-- Sessions in every group: past and upcoming, one cancelled.
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
select sg.id,'Lesson '||v.k,v.t,v.t+interval '1 hour',v.t,v.t+interval '1 hour','center',v.c,v.st,pg_temp.u(2),pg_temp.u(2)
from public.study_groups sg cross join (values (1,now()-interval '20 days','finalized',false),(2,now()-interval '3 days','finalized',true),(3,now()+interval '2 days','draft',false),(4,now()+interval '9 days','draft',false)) v(k,t,st,c)
where sg.id in (pg_temp.g(1),pg_temp.g(2),pg_temp.g(3),pg_temp.g(4));
-- A weekly schedule on group A so "upcoming" has something to materialize.
insert into public.group_schedules(group_id,weekday,local_time,duration_minutes) values(pg_temp.g(1),3,'17:00',90);
select pg_temp.g(1),3,'17:00',90,true,(now() at time zone 'Africa/Cairo')::date-1,pg_temp.u(2) where exists(select 1 from information_schema.columns where table_schema='public' and table_name='group_schedules' and column_name='materialized_through');
-- (An assistant cannot be staff of an offering in a space they do not belong to: the integrity trigger forbids it, so offering 3 is simply unrelated to assistant 4.)

-- Many extra spaces owned by person 1: 6 spaces, 40 groups in the first one (so the list needs a second page), 3 groups in each other one.
-- Nobody else is a member of them: they must never appear for anybody else.
insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','lp-bulk-'||n||'@example.invalid','','infinity','{"provider":"email"}'::jsonb,jsonb_build_object('display_name','LP bulk '||n),now(),now() from generate_series(1,10) n;
insert into public.organizations(id,name,slug,created_by) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LP bulk space '||n,'lp-bulk-'||n,pg_temp.u(1) from generate_series(1,6) n;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,pg_temp.u(1),'owner','active',now() from generate_series(1,6) n on conflict(organization_id,user_id) do nothing;
insert into public.courses(id,organization_id,title,slug,status,created_by) select ('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LP bulk course '||n,'lp-bulk-course-'||n,'published',pg_temp.u(1) from generate_series(1,6) n;
insert into public.course_offerings(id,course_id,name,delivery_mode,status,capacity) select ('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LP bulk offering '||n,'blended','active',100 from generate_series(1,6) n;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select ('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '300 days' from generate_series(1,6) o cross join generate_series(1,10) n;
insert into public.study_groups(id,offering_id,name,mode,location,created_by)
 select ('a2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('f0000000-0000-0000-0000-'||lpad((case when n<=40 then 1 else 2+(n-41)%5 end)::text,12,'0'))::uuid,'LP bulk group '||lpad(n::text,2,'0'),'center','Room',pg_temp.u(1) from generate_series(1,55) n;
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select ('a2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Bulk lesson '||k,now()+(k||' days')::interval,now()+(k||' days')::interval+interval '1 hour',now()+(k||' days')::interval,now()+(k||' days')::interval+interval '1 hour','center',false,'draft',pg_temp.u(1),pg_temp.u(1) from generate_series(1,55) n cross join generate_series(1,2) k;
-- Bulk student 1 is a current member of one bulk group (a student of a space they do not belong to still sees their own group).
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,ends_at,created_by)
select ('a2000000-0000-0000-0000-'||lpad(41::text,12,'0'))::uuid,e.offering_id,e.user_id,e.id,now()-interval '30 days',null,pg_temp.u(1)
from public.enrollments e where e.user_id=('b0000000-0000-0000-0000-'||lpad(1::text,12,'0'))::uuid and e.offering_id=('f0000000-0000-0000-0000-'||lpad(2::text,12,'0'))::uuid;

-- Each person also has a Firebase identity (as the database owner, the way the onboarding function would have stored it).
insert into private.external_identities(profile_id,provider,issuer,subject,verified_at)
select p.id,'firebase','https://securetoken.google.com/diagonproduction','lp-firebase-'||p.id::text,now()
from public.profiles p where p.id in (pg_temp.u(1),pg_temp.u(2),pg_temp.u(3),pg_temp.u(4),pg_temp.u(5),pg_temp.u(6),pg_temp.u(7),pg_temp.u(225),('b0000000-0000-0000-0000-'||lpad(1::text,12,'0'))::uuid);
select pg_temp.ok((select count(*)=9 from private.external_identities where provider='firebase' and subject like 'lp-firebase-%' and subject !~ '^[0-9a-f-]{36}$'),'nine Firebase identities with subjects that are not UUIDs');
select set_config('lp.bulk_student',('b0000000-0000-0000-0000-'||lpad(1::text,12,'0')),true);

-- ---------------------------------------------------------------- the fixture really holds something in every place we compare
select pg_temp.ok((select count(*) from public.study_groups where name like 'LP %')=59 and (select count(*) from public.course_offerings where name like 'LP bulk offering %')=6,'the fixture has 59 groups across the seed spaces and 6 extra spaces');
select pg_temp.ok((select count(*) from public.study_groups where offering_id='f0000000-0000-0000-0000-000000000001')=40,'one extra offering holds 40 groups (a second page)');

-- ---------------------------------------------------------------- the old and the new function, person by person and section by section
select set_config('lp.owner_groups',(select count(*) from public.study_groups sg join public.course_offerings o on o.id=sg.offering_id join public.courses c on c.id=o.course_id where c.organization_id in (select organization_id from public.organization_memberships where user_id=pg_temp.u(1) and status='active'))::text,true);
select set_config('lp.owner_offerings',(select count(*) from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id in (select organization_id from public.organization_memberships where user_id=pg_temp.u(1) and status='active'))::text,true);
set local role authenticated;
create temp table lp_people(n integer primary key,who uuid);
grant all on lp_people to authenticated;
insert into lp_people values(1,pg_temp.u(1)),(2,pg_temp.u(2)),(3,pg_temp.u(3)),(4,pg_temp.u(4)),(5,pg_temp.u(5)),(6,pg_temp.u(6)),(7,pg_temp.u(7)),(8,pg_temp.u(225)),(9,('b0000000-0000-0000-0000-'||lpad(1::text,12,'0'))::uuid);
create temp table lp_sections(section text,page integer,search text);
grant all on lp_sections to authenticated;
insert into lp_sections values
 ('sessions-placeholder',0,''),('summary',0,''),
 ('list',0,''),('list',1,''),('list',0,'bulk group 1'),('list',0,'LP A'),('list',2,''),
 ('offering:60000000-0000-0000-0000-000000000001',0,''),('offering:60000000-0000-0000-0000-000000000002',0,''),('offering:60000000-0000-0000-0000-000000000003',0,''),
 ('offering:f0000000-0000-0000-0000-000000000001',0,''),('offering:f0000000-0000-0000-0000-000000000001',1,''),('offering:f0000000-0000-0000-0000-000000000001',0,'group 3'),('offering:f0000000-0000-0000-0000-000000000002',0,''),
 ('offerings',0,''),('offerings',0,'bulk'),('offerings',1,''),('upcoming',0,'');
delete from lp_sections where section='sessions-placeholder';
-- The default list is requested with a section the function does not know ('list' stands for "no special section").
do $$declare p record;s record;fb boolean;a text;b text;n integer:=0;bad integer:=0;real integer:=0;errs integer:=0;fberrs integer:=0;sec text;begin
 foreach fb in array array[false,true] loop
  for p in select * from lp_people order by n loop
   for s in select * from lp_sections order by section,page,search loop
    sec:=case when s.section='list' then 'groups' else s.section end;
    a:=pg_temp.vcall('private.group_view_before',p.who,sec,s.page,s.search,fb); b:=pg_temp.vcall('private.group_view',p.who,sec,s.page,s.search,fb); n:=n+1;
    if a is distinct from b then bad:=bad+1; raise warning 'DIFFERENT person % section % page % search %: before % after %',p.n,sec,s.page,s.search,left(a,300),left(b,300); end if;
    if b like 'ERR%' then errs:=errs+1; if fb then fberrs:=fberrs+1; end if; elsif b not like '%"rows": []%' then real:=real+1; end if;
   end loop;
  end loop;
 end loop;
 perform set_config('lp.cases',n::text,true);perform set_config('lp.bad',bad::text,true);perform set_config('lp.real',real::text,true);perform set_config('lp.errs',errs::text,true);perform set_config('lp.fberrs',fberrs::text,true);
end$$;
select pg_temp.ok(current_setting('lp.bad')::int=0,'group_view: before and after agree in all '||current_setting('lp.cases')||' cases (Supabase and Firebase sign-ins)');
select pg_temp.ok(current_setting('lp.cases')::int=2*9*17 and current_setting('lp.real')::int>=80 and current_setting('lp.errs')::int>=20,'the comparison covered '||current_setting('lp.cases')||' cases, '||current_setting('lp.real')||' with rows and '||current_setting('lp.errs')||' refusals, '||current_setting('lp.fberrs')||' of them Firebase');

-- student_administration: offerings (pages) and metrics (all spaces, then one space), person by person, both sign-ins.
do $$declare p record;fb boolean;a text;b text;n integer:=0;bad integer:=0;real integer:=0;org text;pg integer;begin
 foreach fb in array array[false,true] loop
  for p in select * from lp_people order by n loop
   foreach org in array array[null,'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002'] loop
    a:=pg_temp.acall('private.student_administration_before',p.who,'metrics',case when org is null then '{}'::jsonb else jsonb_build_object('organizationId',org) end,fb);
    b:=pg_temp.acall('private.student_administration',p.who,'metrics',case when org is null then '{}'::jsonb else jsonb_build_object('organizationId',org) end,fb); n:=n+1;
    if a is distinct from b then bad:=bad+1; raise warning 'ADMIN DIFFERENT person % metrics org %: before % after %',p.n,org,a,b; end if;
    if b not like 'ERR%' and b not like '%"totalStudents": 0%"activeGroupsCount": 0%' then real:=real+1; end if;
   end loop;
   for pg in 0..2 loop
    a:=pg_temp.acall('private.student_administration_before',p.who,'offerings',jsonb_build_object('page',pg),fb);
    b:=pg_temp.acall('private.student_administration',p.who,'offerings',jsonb_build_object('page',pg),fb); n:=n+1;
    if a is distinct from b then bad:=bad+1; raise warning 'ADMIN DIFFERENT person % offerings page %: before % after %',p.n,pg,a,b; end if;
    if b not like 'ERR%' and b not like '%"rows": []%' then real:=real+1; end if;
   end loop;
  end loop;
 end loop;
 perform set_config('lp.acases',n::text,true);perform set_config('lp.abad',bad::text,true);perform set_config('lp.areal',real::text,true);
end$$;
select pg_temp.ok(current_setting('lp.abad')::int=0 and current_setting('lp.acases')::int=2*9*6 and current_setting('lp.areal')::int>=15,'student_administration: before and after agree in all '||current_setting('lp.acases')||' cases ('||current_setting('lp.areal')||' with real data)');

-- ---------------------------------------------------------------- and the answers are the right ones, not merely equal
create function pg_temp.f(who uuid,section text,page integer default 0,search text default '',fb boolean default false) returns jsonb language sql as $$select case when t like 'ERR%' then jsonb_build_object('err',t,'rows','[]'::jsonb) else t::jsonb end from (select pg_temp.vcall('private.group_view',who,section,page,search,fb) t) z$$;
select pg_temp.ok(jsonb_array_length(pg_temp.f(pg_temp.u(1),'groups')->'rows')=25 and (pg_temp.f(pg_temp.u(1),'groups')->>'hasMore')='true' and (select sum(jsonb_array_length(pg_temp.f(pg_temp.u(1),'groups',p)->'rows')) from generate_series(0,4) p)=current_setting('lp.owner_groups')::int and current_setting('lp.owner_groups')::int>=58,'the owner of the extra spaces lists all '||current_setting('lp.owner_groups')||' groups of their spaces over several pages');
select pg_temp.ok(not (pg_temp.f(pg_temp.u(5),'groups')::text like '%a2000000%') and not (pg_temp.f(pg_temp.u(2),'groups')::text like '%a2000000%') and not (pg_temp.f(pg_temp.u(3),'groups')::text like '%a2000000%'),'another space''s groups never appear in anybody else''s list');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.f(pg_temp.u(2),'groups')->'rows') r where (r->>'staff')::boolean)=(select count(*) from jsonb_array_elements(pg_temp.f(pg_temp.u(2),'groups')->'rows')) and jsonb_array_length(pg_temp.f(pg_temp.u(2),'groups')->'rows')>=3,'the teacher lists the groups of both seed spaces, all as staff');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.f(pg_temp.u(5),'groups')->'rows') r where r->>'name'='LP A') and not exists(select 1 from jsonb_array_elements(pg_temp.f(pg_temp.u(5),'groups')->'rows') r where (r->>'staff')::boolean),'a student lists the groups they are a current member of, never as staff');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.f(pg_temp.u(6),'groups')->'rows') r where r->>'name'='LP B'),'a former member does not list the group they left');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.f(('b0000000-0000-0000-0000-'||lpad(1::text,12,'0'))::uuid,'groups')->'rows') r where r->>'name'='LP bulk group 41') and jsonb_array_length(pg_temp.f(('b0000000-0000-0000-0000-'||lpad(1::text,12,'0'))::uuid,'groups')->'rows')=1,'a person with a current membership in a space they do not belong to sees exactly that group');
select pg_temp.ok(pg_temp.f(pg_temp.u(225),'groups')->'rows'='[]'::jsonb and pg_temp.f(pg_temp.u(225),'upcoming')->'rows'='[]'::jsonb and pg_temp.f(pg_temp.u(225),'offerings')->'rows'='[]'::jsonb,'a person with nothing gets empty lists');
select pg_temp.ok(pg_temp.vcall('private.group_view',pg_temp.u(5),'offering:60000000-0000-0000-0000-000000000001',0,'')='ERR 42501' and pg_temp.vcall('private.group_view',pg_temp.u(4),'offering:60000000-0000-0000-0000-000000000003',0,'')='ERR 42501','an offering the caller does not manage is still refused (a student; an assistant with no part in that space)');
select pg_temp.ok(jsonb_array_length(pg_temp.f(pg_temp.u(1),'offering:f0000000-0000-0000-0000-000000000001')->'rows')=25 and (select bool_and((r->>'instructor')::boolean) from jsonb_array_elements(pg_temp.f(pg_temp.u(1),'offering:f0000000-0000-0000-0000-000000000001')->'rows') r),'an offering list: 25 rows a page, instructor true on every row');
select pg_temp.ok(jsonb_array_length(pg_temp.f(pg_temp.u(1),'offerings')->'rows')=current_setting('lp.owner_offerings')::int and current_setting('lp.owner_offerings')::int>=6 and jsonb_array_length(pg_temp.f(pg_temp.u(5),'offerings')->'rows')=0,'the offerings picker lists all of the owner''s offerings and a student none');
select pg_temp.ok(jsonb_array_length(pg_temp.f(pg_temp.u(1),'upcoming')->'rows')=25 and not (pg_temp.f(pg_temp.u(2),'upcoming')::text like '%a2000000%') and jsonb_array_length(pg_temp.f(pg_temp.u(5),'upcoming')->'rows')>=1,'upcoming: the owner''s first 25 sessions, other people never get another space''s sessions, a student sees their own group''s');
select pg_temp.ok(pg_temp.f(pg_temp.u(2),'groups',0,'',true)=pg_temp.f(pg_temp.u(2),'groups') and pg_temp.f(pg_temp.u(5),'upcoming',0,'',true)=pg_temp.f(pg_temp.u(5),'upcoming') and pg_temp.f(pg_temp.u(1),'offerings',0,'',true)=pg_temp.f(pg_temp.u(1),'offerings'),'a Firebase sign-in gets the same answer as a Supabase sign-in, and nothing raises 22P02');
select pg_temp.ok(not exists(select 1 from (select pg_temp.vcall('private.group_view',p.who,s,0,'',true) r from lp_people p cross join (values ('groups'),('upcoming'),('offerings'),('offering:60000000-0000-0000-0000-000000000001')) v(s)) z where r like 'ERR 22%'),'no Firebase listing call raised an invalid-uuid error');
create function pg_temp.a(who uuid,action text,data jsonb default '{}',fb boolean default false) returns jsonb language sql as $$select case when t like 'ERR%' then jsonb_build_object('err',t,'rows','[]'::jsonb) else t::jsonb end from (select pg_temp.acall('private.student_administration',who,action,data,fb) t) z$$;
select pg_temp.ok(jsonb_array_length(pg_temp.a(pg_temp.u(1),'offerings')->'rows')=current_setting('lp.owner_offerings')::int and (pg_temp.a(pg_temp.u(5),'offerings')->'rows')='[]'::jsonb and jsonb_array_length(pg_temp.a(pg_temp.u(2),'offerings')->'rows')>=2,'student administration offerings: all of the owner''s, a student none, the teacher their own spaces');
select pg_temp.ok((pg_temp.a(pg_temp.u(2),'metrics')->>'totalStudents')::int>=1 and (pg_temp.a(pg_temp.u(5),'metrics')->>'totalStudents')::int=0,'metrics: the teacher counts their students, a student counts none');
select pg_temp.ok((pg_temp.a(pg_temp.u(1),'metrics')->>'activeGroupsCount')::int>=55 and (pg_temp.a(pg_temp.u(2),'metrics')->>'activeGroupsCount')::int<=4 and (pg_temp.a(pg_temp.u(5),'metrics')->>'activeGroupsCount')::int=0,'metrics: active groups are counted only in the caller''s own spaces (55 for the owner of the extra spaces, never theirs for anyone else)');
select pg_temp.ok(pg_temp.a(pg_temp.u(2),'metrics',jsonb_build_object('organizationId','c0000000-0000-0000-0000-000000000001'))::text is not null and pg_temp.acall('private.student_administration',pg_temp.u(2),'metrics',jsonb_build_object('organizationId','c0000000-0000-0000-0000-000000000001'))='ERR 42501','asking for the metrics of a space the caller does not belong to is still refused');
select pg_temp.ok(pg_temp.a(pg_temp.u(2),'offerings','{"page":0}',true)=pg_temp.a(pg_temp.u(2),'offerings') and pg_temp.a(pg_temp.u(2),'metrics','{}',true)=pg_temp.a(pg_temp.u(2),'metrics'),'Firebase and Supabase sign-ins get the same offerings and metrics');

-- ---------------------------------------------------------------- the same functions, the same grants
reset role;
select pg_temp.ok((select p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_function_identity_arguments(p.oid)='p_group uuid, p_section text, p_page integer, p_search text' and l.lanname='plpgsql' from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.group_view(uuid,text,integer,text)'::regprocedure),'group_view keeps its signature, language, SECURITY DEFINER and empty search_path');
select pg_temp.ok((select p.prosecdef and p.proconfig=array['search_path=""'] and l.lanname='plpgsql' from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.student_administration(text,uuid,uuid,bigint,uuid,jsonb)'::regprocedure),'student_administration keeps its language, SECURITY DEFINER and empty search_path');
select pg_temp.ok(has_function_privilege('authenticated','private.group_view(uuid,text,integer,text)','execute') and not has_function_privilege('anon','private.group_view(uuid,text,integer,text)','execute') and has_function_privilege('authenticated','private.student_administration(text,uuid,uuid,bigint,uuid,jsonb)','execute') and not has_function_privilege('anon','private.student_administration(text,uuid,uuid,bigint,uuid,jsonb)','execute'),'execute is still granted to signed-in users only');
select pg_temp.ok((select pg_get_functiondef('private.group_view(uuid,text,integer,text)'::regprocedure) not like '%auth.uid()%'),'group_view never calls auth.uid()');
select pg_temp.ok((select pg_get_functiondef('private.student_administration(text,uuid,uuid,bigint,uuid,jsonb)'::regprocedure) not like '%auth.uid()%'),'student_administration never calls auth.uid()');

select count(*)||' checks passed' as listing_performance_tests from lp_results;
rollback;
