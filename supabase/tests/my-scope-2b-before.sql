-- Fix track 2b proof only (scripts/my-scope-2b-proof.cjs): the five read policies and the eight functions EXACTLY as they were before
-- 20261128120000_my_scope_groups_work.sql (pg_get_functiondef of the database before it). Applied to a clone only; never a migration.
begin;
alter policy course_offerings_select on public.course_offerings using ((private.can_support_offering(id) OR private.is_enrolled(id)));
alter policy enrollment_requests_read on public.enrollment_requests using ((private.is_active_user() AND ((user_id = ( SELECT private.current_app_user_id() AS current_app_user_id)) OR private.can_support_offering(offering_id))));
alter policy enrollments_select on public.enrollments using ((((user_id = ( SELECT private.current_app_user_id() AS uid)) AND private.is_active_user()) OR private.can_support_offering(offering_id)));
alter policy homework_read on public.homework_assignments using (private.homework_visible(id));
alter policy offering_staff_select on public.offering_staff using (private.can_support_offering(offering_id));
CREATE OR REPLACE FUNCTION private.can_manage_group(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.study_groups g where g.id=p_group and
 (private.can_manage_offering(g.offering_id) or (private.can_support_offering(g.offering_id) and exists(
 select 1 from public.group_staff s where s.group_id=g.id and s.user_id=(select private.current_app_user_id())))))
$function$;
CREATE OR REPLACE FUNCTION private.can_view_group(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.can_manage_group(p_group) or exists(select 1 from public.study_groups g join public.group_memberships m on m.group_id=g.id
 where g.id=p_group and g.status='active' and m.user_id=(select private.current_app_user_id()) and m.starts_at<=clock_timestamp() and m.ends_at is null and private.is_enrolled(g.offering_id)
 and exists(select 1 from public.enrollments e where e.id=m.enrollment_id and e.status='active' and (e.expires_at is null or e.expires_at>clock_timestamp()) and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp())))
$function$;
CREATE OR REPLACE FUNCTION private.homework_staff(p_assignment uuid, p_capability text DEFAULT 'view'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.homework_assignments a where a.id=p_assignment and case p_capability
 when 'author' then private.can_edit_course(a.course_id)
 when 'grade' then private.can_support_offering(a.offering_id)
 when 'manage' then private.can_manage_offering(a.offering_id)
 when 'correct' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_correct from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 when 'release' then private.can_manage_offering(a.offering_id) or (private.can_support_offering(a.offering_id) and coalesce((select p.can_release from private.homework_assistant_permissions p where p.course_id=a.course_id and p.user_id=(select private.current_app_user_id())),true))
 else private.can_edit_course(a.course_id) or private.can_support_offering(a.offering_id) end)
$function$;
CREATE OR REPLACE FUNCTION private.homework_enrolled(p_assignment uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.homework_assignments a join public.course_offerings o on o.id=a.offering_id join public.courses c on c.id=a.course_id
 join public.lessons l on l.id=a.lesson_id left join public.lesson_segments s on s.id=a.segment_id
 where a.id=p_assignment and a.status='published' and o.status='active' and c.status='published' and l.status='published'
 and (a.segment_id is null or s.status='published') and private.is_enrolled(a.offering_id)
 and exists(select 1 from public.enrollments e where e.offering_id=a.offering_id and e.user_id=(select private.current_app_user_id()) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or clock_timestamp()<e.expires_at)))
$function$;
CREATE OR REPLACE FUNCTION private.group_view(p_group uuid, p_section text, p_page integer, p_search text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.study_groups; staff boolean; u uuid:=(select private.current_app_user_id()); result jsonb; session_uuid uuid; group_row record; managed uuid[]; offs uuid[]; vis uuid[];
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
  -- Which groups of this one offering the caller may view is decided once (it was decided up to three times per group). The offering itself was just
  -- checked with private.can_manage_offering, so "instructor" is true for every row, exactly as the per-row call answered.
  with vis as materialized (select listed.id from public.study_groups listed where listed.offering_id=session_uuid and private.can_view_group(listed.id))
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(
   select count(*)>25 from (select 1 from public.study_groups listed where listed.id in (select id from vis) and listed.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z))
   into result from (select listed.*,private.can_manage_group(listed.id) as staff,true as instructor,o.name as offering_name
    from public.study_groups listed join public.course_offerings o on o.id=listed.offering_id
    where listed.id in (select id from vis) and listed.name ilike '%'||p_search||'%' order by listed.created_at,listed.id limit 25 offset p_page*25) x;
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
   -- The groups the caller can view, decided ONCE over the caller's own candidates (groups of the spaces the caller belongs to, and groups the caller is a
   -- current member of): private.can_view_group needs one of those two things, and still decides each candidate.
   vis:=array(select listed.id from public.study_groups listed where listed.id in (select g2.id from public.study_groups g2 join public.course_offerings o2 on o2.id=g2.offering_id join public.courses c2 on c2.id=o2.course_id where c2.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') union select gm.group_id from public.group_memberships gm where gm.user_id=u and gm.ends_at is null) and private.can_view_group(listed.id));
   if (select count(*) from public.study_groups listed where listed.id=any(vis) and listed.status='active')>100 then raise exception 'Open an individual group to view its sessions' using errcode='23514'; end if;
   for group_row in select id from public.study_groups where status='active' and id=any(vis) order by id limit 100 loop perform private.materialize_group(group_row.id); end loop;
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'serverNow',clock_timestamp(),'page',0,'catchingUp',exists(select 1 from public.group_schedules r join public.study_groups listed on listed.id=r.group_id where r.active and listed.id=any(vis) and r.materialized_through<(clock_timestamp() at time zone 'Africa/Cairo')::date)) into result from (
    select s.*,listed.name as group_name from public.group_sessions s join public.study_groups listed on listed.id=s.group_id where listed.id=any(vis) and not s.cancelled and s.ends_at>clock_timestamp() order by s.starts_at,s.id limit 25) x;
   return result;
  end if;
  if p_section='offerings' then
   -- Managing an offering needs an active membership of its space, so only offerings of the caller's own spaces are asked; each one is still decided by
   -- private.can_manage_offering, once.
   with vis as materialized (select o.id from public.course_offerings o join public.courses c on c.id=o.course_id where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and private.can_manage_offering(o.id))
   select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.course_offerings o where o.id in (select id from vis) and o.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z)) into result from (select o.id,o.name from public.course_offerings o where o.id in (select id from vis) and o.name ilike '%'||p_search||'%' order by o.id limit 25 offset p_page*25) x;
   return result;
  end if;
  -- The caller can view a group only through a space they belong to or a current membership of it, so only those candidates are asked, each once
  -- (it was every group of the database, and up to three times per group).
  with cand as materialized (select g2.id from public.study_groups g2 join public.course_offerings o2 on o2.id=g2.offering_id join public.courses c2 on c2.id=o2.course_id where c2.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') union select gm.group_id from public.group_memberships gm where gm.user_id=u and gm.ends_at is null),
   vis as materialized (select listed.id from public.study_groups listed where listed.id in (select id from cand) and private.can_view_group(listed.id))
  select jsonb_build_object('rows',coalesce(jsonb_agg(x),'[]'::jsonb),'page',p_page,'hasMore',(select count(*)>25 from (select 1 from public.study_groups listed where listed.id in (select id from vis) and listed.name ilike '%'||p_search||'%' limit 26 offset p_page*25) z),'serverNow',clock_timestamp()) into result
  from (select listed.*,private.can_manage_group(listed.id) as staff,private.can_manage_offering(listed.offering_id) as instructor,o.name as offering_name from public.study_groups listed join public.course_offerings o on o.id=listed.offering_id where listed.id in (select id from vis) and listed.name ilike '%'||p_search||'%' order by listed.created_at,listed.id limit 25 offset p_page*25) x;
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
end$function$;
CREATE OR REPLACE FUNCTION private.homework_portal(p_course uuid DEFAULT NULL::uuid, p_tab text DEFAULT 'open'::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());at_ timestamptz:=clock_timestamp();wk timestamptz;wk_end timestamptz;courses_ uuid[];eds uuid[];sups uuid[];hws uuid[];result jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('open','closed','drafts') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 wk:=private.homework_week_start(at_);wk_end:=((wk at time zone 'Africa/Cairo')+interval '7 days') at time zone 'Africa/Cairo';
 courses_:=array(select c.id from public.courses c where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and (p_course is null or c.id=p_course));
 eds:=array(select x from unnest(courses_) x where private.can_edit_course(x));
 sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));
 if p_course is not null and cardinality(eds)=0 and cardinality(sups)=0 then raise exception 'Homework unavailable' using errcode='42501';end if;
 hws:=array(select h.id from public.homework_assignments h where h.course_id=any(courses_) and (h.offering_id=any(sups) or h.course_id=any(eds))
  and (not exists(select 1 from public.homework_assignments n where n.family_id=h.family_id and n.version>h.version) or exists(select 1 from public.homework_submissions s where s.assignment_id=h.id and s.status='submitted')));
 with h as materialized (select a.*,a.offering_id=any(sups) as counted,case when a.status='draft' then 'drafts' when a.deadline_at is not null and a.deadline_at<=at_ then 'closed' else 'open' end as tab
   from public.homework_assignments a where a.id=any(hws)),
  qs as materialized (select q.assignment_id,count(*) n,coalesce(sum(q.points),0) m from public.homework_questions q where q.assignment_id in (select id from h) group by q.assignment_id),
  roster as materialized (select e.offering_id,count(distinct e.user_id) n from public.enrollments e where e.offering_id=any(sups) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=at_) and (e.expires_at is null or e.expires_at>at_) group by e.offering_id),
  subs as materialized (select s.id,s.assignment_id,s.user_id,s.number,s.submitted_at,s.missed_deadline from public.homework_submissions s where s.assignment_id in (select id from h where counted) and s.status='submitted'),
  latest as materialized (select distinct on (s.assignment_id,s.user_id) s.id,s.assignment_id,s.user_id from subs s order by s.assignment_id,s.user_id,s.number desc),
  empties as materialized (select m.submission_id,count(*) n from private.homework_marks m join public.homework_questions q on q.id=m.question_id where m.submission_id in (select id from latest) and m.points is null and q.type='essay' group by m.submission_id),
  files_waiting as materialized (select c.submission_id from private.homework_corrections c join latest l on l.id=c.submission_id join h on h.id=l.assignment_id where h.mode='FILE_UPLOAD' and c.status='under_correction'),
  waiting as materialized (select l.assignment_id,sum(coalesce(e.n,0)+case when w.submission_id is null then 0 else 1 end) n from latest l left join empties e on e.submission_id=l.id left join files_waiting w on w.submission_id=l.id group by l.assignment_id),
  handed as materialized (select assignment_id,count(*) n from latest group by assignment_id),
  marked as materialized (select l.assignment_id,round(avg(c.score),2) n from latest l join private.homework_corrections c on c.submission_id=l.id where c.released_at is not null and c.score is not null group by l.assignment_id),
  late as materialized (select assignment_id,count(distinct user_id) n from subs where missed_deadline group by assignment_id),
  bytes as materialized (select x.assignment_id,sum(x.size_bytes) n from private.homework_uploads x where x.assignment_id in (select id from h where counted and tab='closed') and x.purpose='submission' and x.status='ready' group by x.assignment_id),
  listed as materialized (select h.id,h.tab,h.deadline_at,h.updated_at,h.title,(coalesce(w.n,0)) waiting_n,h.counted,
   jsonb_build_object('id',h.id,'title',h.title,'courseId',h.course_id,'courseTitle',c.title,'offeringId',h.offering_id,'lessonId',h.lesson_id,'lessonTitle',l.title,'version',h.version,
    'workflow',h.workflow,'mode',h.mode,'status',h.status,'deadline',h.deadline_at,'lateAllowed',h.late_allowed,'tries',h.tries_mode,'maxTries',h.max_tries,'solutionsOpen',h.solutions_open,'photosAllowed',h.photos_allowed,'updatedAt',h.updated_at,
    'questionCount',coalesce(qs.n,0),'totalMarks',case when h.mode='FILE_UPLOAD' then h.file_points else coalesce(qs.m,0) end,
    'handedIn',case when h.counted then coalesce(hd.n,0) end,'total',case when h.counted then coalesce(r.n,0) end,'late',case when h.counted then coalesce(lt.n,0) end,'averageScore',case when h.counted and h.uses_marks then mk.n end,
    'waiting',case when h.counted then coalesce(w.n,0) end,'imageBytes',case when h.counted and h.tab='closed' then coalesce(b.n,0) end) j
   from h join public.courses c on c.id=h.course_id join public.lessons l on l.id=h.lesson_id left join qs on qs.assignment_id=h.id
   left join roster r on r.offering_id=h.offering_id left join handed hd on hd.assignment_id=h.id left join late lt on lt.assignment_id=h.id left join marked mk on mk.assignment_id=h.id left join waiting w on w.assignment_id=h.id left join bytes b on b.assignment_id=h.id)
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',25,'serverNow',at_,
  'stats',jsonb_build_object('weekStart',wk,'weekEnd',wk_end,
   'essaysWaiting',(select coalesce(sum(n),0) from waiting),
   'correctedThisWeek',(select count(*) from private.homework_corrections c join subs s on s.id=c.submission_id where c.corrected_at>=wk and c.corrected_at<wk_end),
   'handedInThisWeek',(select count(*) from subs where submitted_at>=wk and submitted_at<wk_end),
   'onTimePercent',(select case when count(*)=0 then null else round(100.0*count(*) filter(where not missed_deadline)/count(*)) end from subs where number=1 and submitted_at>=wk and submitted_at<wk_end)),
  'counts',jsonb_build_object('open',(select count(*) from listed where tab='open'),'closed',(select count(*) from listed where tab='closed'),'drafts',(select count(*) from listed where tab='drafts')),
  'toCorrect',coalesce((select jsonb_agg(x.j order by x.deadline_at nulls last,x.id) from (select * from listed where counted and waiting_n>0 order by deadline_at nulls last,id limit 50) x),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x.j order by x.o) from (select j,row_number() over(order by
     case when p_tab='open' then deadline_at end asc nulls last,case when p_tab='closed' then deadline_at end desc,case when p_tab='drafts' then updated_at end desc,id) o
    from listed where tab=p_tab order by o limit 25 offset p_page*25) x),'[]'::jsonb)) into result;
 return result;
end $function$;
CREATE OR REPLACE FUNCTION private.exam_portal(p_course uuid DEFAULT NULL::uuid, p_tab text DEFAULT 'open'::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());courses_ uuid[];eds uuid[];sups uuid[];at_ timestamptz:=clock_timestamp();
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_tab is null or p_tab not in ('open','closed','drafts','archived') or p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid tab or page' using errcode='23514';end if;
 courses_:=array(select c.id from public.courses c where c.organization_id in (select m.organization_id from public.organization_memberships m where m.user_id=u and m.status='active') and (p_course is null or c.id=p_course));
 eds:=array(select y from unnest(courses_) y where private.can_edit_course(y));
 sups:=array(select o.id from public.course_offerings o where o.course_id=any(courses_) and private.can_support_offering(o.id));
 if p_course is not null and cardinality(eds)=0 and cardinality(sups)=0 then raise exception 'Exams unavailable' using errcode='42501';end if;
 return (with ex as materialized (select e.*,e.offering_id=any(sups) counted,
    case when e.status='draft' then 'drafts' when e.status='archived' then 'archived' when e.kind='paper' then 'closed' when private.exam_closed(e.id) then 'closed' else 'open' end tab
   from private.exams e where e.course_id=any(courses_) and (e.offering_id=any(sups) or e.course_id=any(eds))),
  listed as materialized (select * from ex where tab=p_tab order by case when p_tab='drafts' then updated_at end desc,coalesce(opens_at,published_at,updated_at) desc,id limit 25 offset p_page*25),
  qs as materialized (select q.exam_id,count(*) n,coalesce(sum(q.points),0) m,bool_or(q.type='essay') essays from private.exam_questions q where q.exam_id in (select id from listed) group by q.exam_id),
  roster as materialized (select x.offering_id,count(distinct x.user_id) n from public.enrollments x where x.offering_id in (select offering_id from listed where counted) and x.status='active' and (x.enrolled_at is null or x.enrolled_at<=at_) and (x.expires_at is null or x.expires_at>at_) group by x.offering_id),
  res as materialized (select r.exam_id,count(*) filter(where r.final_attempt_id is not null or r.paper_mark is not null or r.absent) handed,count(*) filter(where r.status='waiting') waiting,
    count(*) filter(where r.status='corrected' and r.released_at is null) unreleased,count(*) filter(where r.released_at is not null) released from private.exam_results r where r.exam_id in (select id from listed where counted) group by r.exam_id),
  -- Open online exams the caller counts for: every active Group's window with started / total and the time left (server clock), and the
  -- students in no Group (their window spans the Groups'). A student in two Groups counts in both.
  live as materialized (select l.id,l.offering_id,l.timing,l.opens_at,l.closes_at from listed l where l.tab='open' and l.counted and l.kind='online'),
  gw as materialized (select v.id exam_id,w.group_id,w.group_name,w.opens_at,w.closes_at,w.state from live v cross join lateral private.exam_windows(v.id) w where v.timing='per_group'
   union all select v.id,g.id,g.name,v.opens_at,v.closes_at,'ok' from live v join public.study_groups g on g.offering_id=v.offering_id and g.status='active' where v.timing='same_time'),
  enr as materialized (select x.offering_id,x.user_id from public.enrollments x where x.offering_id in (select offering_id from live) and x.status='active'
   and (x.enrolled_at is null or x.enrolled_at<=at_) and (x.expires_at is null or x.expires_at>at_) group by x.offering_id,x.user_id),
  mem as materialized (select m.group_id,m.offering_id,m.user_id from public.group_memberships m join enr on enr.offering_id=m.offering_id and enr.user_id=m.user_id
   join public.study_groups g on g.id=m.group_id and g.status='active' where m.starts_at<=at_ and (m.ends_at is null or m.ends_at>at_) group by m.group_id,m.offering_id,m.user_id),
  took as materialized (select a.exam_id,a.user_id from private.exam_attempts a where a.exam_id in (select id from live) group by a.exam_id,a.user_id),
  per_group as materialized (select gw.exam_id,jsonb_agg(jsonb_build_object('groupId',gw.group_id,'name',gw.group_name,'state',gw.state,'opensAt',gw.opens_at,'closesAt',gw.closes_at,
    'window',case when gw.state<>'ok' then gw.state when at_<gw.opens_at then 'upcoming' when at_<gw.closes_at then 'open' else 'closed' end,
    'secondsLeft',case when gw.state='ok' and gw.opens_at<=at_ and at_<gw.closes_at then floor(extract(epoch from gw.closes_at-at_))::bigint end,
    'total',(select count(*) from mem where mem.group_id=gw.group_id),
    'started',(select count(*) from mem join took on took.user_id=mem.user_id and took.exam_id=gw.exam_id where mem.group_id=gw.group_id))
    order by gw.group_name,gw.group_id) groups from gw group by gw.exam_id),
  no_group as materialized (select v.id exam_id,count(*) total,count(*) filter(where exists(select 1 from took where took.exam_id=v.id and took.user_id=enr.user_id)) started
   from live v join enr on enr.offering_id=v.offering_id where not exists(select 1 from mem where mem.offering_id=v.offering_id and mem.user_id=enr.user_id) group by v.id)
 select jsonb_build_object('tab',p_tab,'page',p_page,'pageSize',25,'serverNow',at_,
  'counts',(select jsonb_build_object('open',count(*) filter(where tab='open'),'closed',count(*) filter(where tab='closed'),'drafts',count(*) filter(where tab='drafts'),'archived',count(*) filter(where tab='archived')) from ex),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'kind',l.kind,'status',l.status,'courseId',l.course_id,'courseTitle',c.title,'offeringId',l.offering_id,'version',l.version,
    'timing',l.timing,'startingFrom',l.starting_from,'opensAt',l.opens_at,'closesAt',l.closes_at,'heldOn',l.held_on,'timeLimitMinutes',l.time_limit_minutes,'updatedAt',l.updated_at,
    'lastClose',case when l.kind='online' and l.status<>'draft' then private.exam_last_close(l.id) end,
    'held',l.kind='online' and l.timing='per_group' and l.status='published' and exists(select 1 from private.exam_windows(l.id) w where w.state<>'ok'),
    'questionCount',coalesce(qs.n,0),'totalMarks',case when l.kind='paper' then l.max_marks else coalesce(qs.m,0) end,'hasEssays',coalesce(qs.essays,false),
    'total',case when l.counted then coalesce(ro.n,0) end,'handedIn',case when l.counted then coalesce(rs.handed,0) end,'waiting',case when l.counted then coalesce(rs.waiting,0) end,
    'toRelease',case when l.counted then coalesce(rs.unreleased,0) end,'released',case when l.counted then coalesce(rs.released,0) end,
    'groups',case when lv.id is not null then coalesce(pg.groups,'[]'::jsonb) end,
    'noGroup',case when lv.id is not null then jsonb_build_object('total',coalesce(ng.total,0),'started',coalesce(ng.started,0)) end)
    order by case when p_tab='drafts' then l.updated_at end desc,coalesce(l.opens_at,l.published_at,l.updated_at) desc,l.id)
   from listed l join public.courses c on c.id=l.course_id left join qs on qs.exam_id=l.id left join roster ro on ro.offering_id=l.offering_id left join res rs on rs.exam_id=l.id
   left join live lv on lv.id=l.id left join per_group pg on pg.exam_id=l.id left join no_group ng on ng.exam_id=l.id),'[]'::jsonb)));
end $function$;
CREATE OR REPLACE FUNCTION private.exam_student_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=(select private.current_app_user_id());ids uuid[];x uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 ids:=array(select e.id from private.exams e join public.enrollments n on n.offering_id=e.offering_id and n.user_id=u and n.status='active' and (n.enrolled_at is null or n.enrolled_at<=clock_timestamp()) and (n.expires_at is null or n.expires_at>clock_timestamp())
  join public.course_offerings o on o.id=e.offering_id and o.status='active' join public.courses c on c.id=e.course_id and c.status='published'
  where e.status in ('published','archived') and e.published_at is not null order by e.published_at desc,e.id limit 200);
 foreach x in array ids loop perform private.exam_settle(x,u);end loop;
 return jsonb_build_object('serverNow',clock_timestamp(),'rows',coalesce((select jsonb_agg(j order by sort_at nulls last,id) from (
  select e.id,coalesce(w.opens_at,e.published_at) sort_at,jsonb_build_object('id',e.id,'title',e.title,'kind',e.kind,'status',e.status,'courseId',e.course_id,'courseTitle',c.title,'offeringId',e.offering_id,
   'heldOn',e.held_on,'timeLimitMinutes',e.time_limit_minutes,'tries',e.tries_mode,
   'window',case when e.kind='online' then jsonb_build_object('opensAt',w.opens_at,'closesAt',w.closes_at,'state',w.state) end,
   'tryState',case when exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=u and a.status='in_progress') then 'in_progress'
    when exists(select 1 from private.exam_attempts a where a.exam_id=e.id and a.user_id=u) then 'submitted' else 'not_started' end,
   'result',case when r.id is not null and private.exam_released(r.id) then jsonb_build_object('score',r.score,'maxScore',r.max_score,'absent',r.absent) end) j
  from private.exams e join public.courses c on c.id=e.course_id left join lateral private.exam_student_window(e.id,u) w on true
  left join private.exam_results r on r.exam_id=e.id and r.user_id=u where e.id=any(ids)) z),'[]'::jsonb));
end $function$;
commit;
