-- Benchmark, not part of the default suite (run: node scripts/exam-sql-local.cjs --postgres --bench-listing). Disposable local PostgreSQL only; rolls back; synthetic people only.
-- Builds 60 other spaces of 25 Groups each (1,500 Groups, 4,500 sessions, about 1,200 memberships) and two spaces of the caller's own (40 Groups each) next to the development
-- seed, then times every listing section (EXPLAIN ANALYZE) before and after migration 20261106120000 for a teacher and a student, and checks that the answers are equal.
begin;
create temp table lpb_results(name text primary key);
grant select,insert on lpb_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.lpb_results values(label);end$$;
create function pg_temp.claim(u uuid) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated','sub',u::text)::text,true)::void$$;
create function pg_temp.u(n integer) returns uuid language sql as $$select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
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

-- Spaces 1-60 belong to the owner of space 2 (person 3) and are decoys for the teacher (person 2) and the student (person 5); spaces 61 and 62 are the teacher's own.
insert into auth.users(id,aud,role,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','lpb-bulk-'||n||'@example.invalid','','infinity','{"provider":"email"}'::jsonb,jsonb_build_object('display_name','LPB bulk '||n),now(),now() from generate_series(1,20) n;
insert into public.organizations(id,name,slug,created_by) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LPB space '||n,'lpb-space-'||n,pg_temp.u(3) from generate_series(1,62) n;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select ('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,case when n<=60 then pg_temp.u(3) else pg_temp.u(2) end,'owner','active',now() from generate_series(1,62) n on conflict(organization_id,user_id) do nothing;
insert into public.courses(id,organization_id,title,slug,status,created_by) select ('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('c0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LPB course '||n,'lpb-course-'||n,'published',case when n<=60 then pg_temp.u(3) else pg_temp.u(2) end from generate_series(1,62) n;
insert into public.course_offerings(id,course_id,name,delivery_mode,status,capacity) select ('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('d0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'LPB offering '||n,'blended','active',100 from generate_series(1,62) n;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select ('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,('b0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '300 days' from generate_series(1,62) o cross join generate_series(1,20) n;
insert into public.study_groups(id,offering_id,name,mode,location,created_by)
 select ('a2000000-0000-0000-0000-'||lpad((o*100+k)::text,12,'0'))::uuid,('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,'LPB group '||o||'-'||k,'center','Room',case when o<=60 then pg_temp.u(3) else pg_temp.u(2) end
 from generate_series(1,62) o cross join generate_series(1,40) k where k<=case when o<=60 then 25 else 40 end;
-- Learner n of each space is a member of that space's Group n (one active Group per learner per offering).
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select sg.id,e.offering_id,e.user_id,e.id,now()-interval '200 days',sg.created_by
 from public.study_groups sg join public.enrollments e on e.offering_id=sg.offering_id and e.user_id::text like 'b0000000%'
 where sg.name like 'LPB group %' and right(e.user_id::text,3)::int=split_part(sg.name,'-',2)::int;
insert into public.group_sessions(group_id,title,starts_at,ends_at,original_starts_at,original_ends_at,mode,cancelled,attendance_state,created_by,updated_by)
 select sg.id,'Bulk '||k,now()+((k-2)||' days')::interval,now()+((k-2)||' days')::interval+interval '1 hour',now()+((k-2)||' days')::interval,now()+((k-2)||' days')::interval+interval '1 hour','center',false,case when k<=2 then 'finalized' else 'draft' end,sg.created_by,sg.created_by
 from public.study_groups sg cross join generate_series(1,3) k where sg.name like 'LPB group %';
-- Student 5 learns in the teacher's two added spaces and is a member of one Group in each.
insert into public.enrollments(offering_id,user_id,status,enrolled_at) select ('f0000000-0000-0000-0000-'||lpad(o::text,12,'0'))::uuid,pg_temp.u(5),'active',now()-interval '100 days' from generate_series(61,62) o on conflict(offering_id,user_id) do nothing;
insert into public.group_memberships(group_id,offering_id,user_id,enrollment_id,starts_at,created_by)
 select sg.id,e.offering_id,e.user_id,e.id,now()-interval '90 days',sg.created_by from public.study_groups sg join public.enrollments e on e.offering_id=sg.offering_id and e.user_id=pg_temp.u(5) where sg.name in ('LPB group 61-1','LPB group 62-1');
analyze public.study_groups; analyze public.group_memberships; analyze public.group_sessions; analyze public.enrollments; analyze public.course_offerings; analyze public.organization_memberships; analyze public.courses;
select pg_temp.ok((select count(*) from public.study_groups)>=1580 and (select count(*) from public.group_sessions)>=4700,'the dataset has '||(select count(*) from public.study_groups)||' Groups, '||(select count(*) from public.group_memberships)||' memberships and '||(select count(*) from public.group_sessions)||' sessions');

create temp table lpb_timing(person text,section text,version text,ms numeric);
grant select,insert on lpb_timing to authenticated;
create function pg_temp.explain_ms(stmt text,who uuid) returns numeric language plpgsql as $$declare line text;ms numeric;begin
 perform pg_temp.claim(who);
 for line in execute 'explain (analyze, costs off, timing off) '||stmt loop
  if line like 'Execution Time:%' then ms:=substring(line from 'Execution Time: ([0-9.]+)')::numeric; end if;
 end loop;
 return ms;end$$;
create function pg_temp.result_of(stmt text,who uuid) returns text language plpgsql as $$declare r jsonb;begin
 perform pg_temp.claim(who);
 begin execute 'select ('||stmt||')' into r; return (r-'serverNow')::text; exception when others then return 'ERR '||sqlstate; end;end$$;
set local role authenticated;
do $$declare who uuid;label text;sec text;a text;b text;
 sections text[]:=array['groups','upcoming','offerings','offering:60000000-0000-0000-0000-000000000001','offering:f0000000-0000-0000-0000-000000000061'];
 actions text[]:=array['offerings','metrics'];
begin
 for who,label in select pg_temp.u(2),'teacher' union all select pg_temp.u(5),'student' loop
  foreach sec in array sections loop
   a:=format('private.group_view_before(null,%L,0,%L)',sec,''); b:=format('private.group_view(null,%L,0,%L)',sec,'');
   if pg_temp.result_of(a,who) is distinct from pg_temp.result_of(b,who) then raise exception 'FAILED answers differ at scale for % %',label,sec; end if;
   continue when pg_temp.result_of(a,who) like 'ERR%';
   insert into lpb_timing values(label,sec,'before',pg_temp.explain_ms('select '||a,who));
   insert into lpb_timing values(label,sec,'after',pg_temp.explain_ms('select '||b,who));
  end loop;
  foreach sec in array actions loop
   a:=format('private.student_administration_before(%L,null,null,null,null,%L::jsonb)',sec,'{}'); b:=format('private.student_administration(%L,null,null,null,null,%L::jsonb)',sec,'{}');
   if pg_temp.result_of(a,who) is distinct from pg_temp.result_of(b,who) then raise exception 'FAILED administration answers differ at scale for % %',label,sec; end if;
   continue when pg_temp.result_of(a,who) like 'ERR%';
   insert into lpb_timing values(label,'admin:'||sec,'before',pg_temp.explain_ms('select '||a,who));
   insert into lpb_timing values(label,'admin:'||sec,'after',pg_temp.explain_ms('select '||b,who));
  end loop;
 end loop;
end$$;
reset role;
select pg_temp.ok((select count(*)>=12 from lpb_timing where version='after'),'every section was timed before and after');
select pg_temp.ok((select bool_and(a.ms<=b.ms*1.25+5) from lpb_timing a join lpb_timing b on a.person=b.person and a.section=b.section and a.version='after' and b.version='before'),'no section got slower');
select pg_temp.ok((select sum(case when version='before' then ms end)/sum(case when version='after' then ms end)>=3 from lpb_timing),'all sections together are at least 3 times faster ('||(select round(sum(case when version='before' then ms end)/sum(case when version='after' then ms end),1) from lpb_timing)||'x)');
select jsonb_agg(jsonb_build_object('person',a.person,'section',a.section,'beforeMs',b.ms,'afterMs',a.ms) order by a.person,a.section) as lpb_bench_results from lpb_timing a join lpb_timing b on a.person=b.person and a.section=b.section and a.version='after' and b.version='before';
select count(*)||' checks passed' as lpb_bench_tests from lpb_results;
rollback;
