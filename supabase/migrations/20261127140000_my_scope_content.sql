-- "My scope" for the page context and lesson content (fix track 2a: A0-01, A0-07, A1-01, A2a-01). Draft; not applied.
--
-- Before: the read policies of courses, organizations, profiles, course_modules, lessons, lesson_blocks, lesson_segments and
-- lesson_resources called a per-row helper (can_view_course, can_view_lesson, can_view_segment, can_view_profile). Those are security
-- definer SQL functions, never inlined, each one re-resolving the caller and re-running its nested helpers, for EVERY row the statement
-- looks at. A student opening one lesson of a 60-lesson course cost 11.5 s; an unfiltered courses read on a 200-space platform 7.4 s.
--
-- After: the same policies read `... in (select private.my_...())`. Each my_* function is a security definer set-returning function
-- with no argument, so PostgreSQL runs it ONCE per statement (an uncorrelated hashed subplan) and checks each row against the set.
-- Each set is the exact set of rows the old per-row helper accepts, written out from the helpers' own rules (20261001230357 and
-- 20261013141230, read with their current private.current_app_user_id() bodies):
--   has_org_role(org,roles)  = an active caller with an ACTIVE membership in an ACTIVE space whose role is in roles
--   is_org_member(org)       = has_org_role(org, owner/admin/teacher/assistant)
--   can_edit_course(c)       = owner/admin of c's space, or member of it with course_staff owner/instructor/editor on c
--   is_course_staff(c)       = any course_staff row on c and member of c's space
--   can_manage_offering(o)   = owner/admin, or member with course_staff owner/instructor on o's course or offering_staff instructor on o
--   can_support_offering(o)  = can_manage_offering(o), or member with ANY offering_staff row on o
--   is_enrolled(o)           = active caller, active enrollment started and not expired (now()), active run, published course, active space
--   can_view_course(c)       = can_edit_course or is_course_staff, or an offering of c the caller supports or is enrolled in
--   can_view_lesson(l)       = edit/staff of the course, or a published lesson of a viewable course
--   can_view_segment(s)      = edit/staff of the course, or a published part of a published lesson of a viewable course
--   can_view_profile(p)      = active caller and (p is the caller, or p has a membership row (any status) in a space the caller owns or
--                              administers, or p has an enrollment row (any status) in a run the caller supports)
-- Every true branch of these helpers names a row that points at the caller (a membership, a course_staff, an offering_staff or an
-- enrollment row), so the sets start from those rows. supabase/tests/my-scope.sql and scripts/my-scope-proof.cjs compare the old
-- helpers with these sets, row for row, for every role.
--
-- The caller is NOT cached across statements (no set_config). A transaction-local cache would keep answering with a profile that the
-- same transaction has just suspended or whose token it has just revoked, and a statement-local key does not exist in PostgreSQL. Each
-- my_* call resolves the caller once (a CTE), which is what the per-row helpers could not do; see docs/ai/fixes/TRACK-02a-my-scope.md.
--
-- The existing helpers are unchanged: every function that calls them keeps its meaning. Only these eight read policies, and the one
-- check inside save_segment_progress (A0-07), change. No table, row or grant of an existing object changes; nothing is dropped.
begin;

-- The caller's active spaces with the role in each: has_org_role's rule. current_app_user_id() already requires an active profile, so
-- is_active_user() holds whenever it is not null.
create or replace function private.my_space_roles() returns table(organization_id uuid, role text)
language sql stable security definer set search_path='' rows 4 as $$
 select m.organization_id, m.role from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.user_id=(select private.current_app_user_id()) and m.status='active' and o.status='active'
  and m.role in ('owner','admin','teacher','assistant')
$$;

-- Every course the caller may view (can_view_course), with staff = can_edit_course or is_course_staff.
create or replace function private.my_course_access() returns table(course_id uuid, staff boolean)
language sql stable security definer set search_path='' rows 20 as $$
 with me as materialized (select private.current_app_user_id() id),
 spaces as materialized (
  select m.organization_id, m.role from public.organization_memberships m join public.organizations o on o.id=m.organization_id
  where m.user_id=(select id from me) and m.status='active' and o.status='active' and m.role in ('owner','admin','teacher','assistant')),
 found as (
  -- can_edit_course: owner or admin of the space.
  select c.id course_id, true staff from public.courses c where c.organization_id in (select organization_id from spaces where role in ('owner','admin'))
  union all
  -- can_edit_course (owner/instructor/editor) and is_course_staff (any role): a course_staff row, member of the space.
  select s.course_id, true from public.course_staff s join public.courses c on c.id=s.course_id
  where s.user_id=(select id from me) and c.organization_id in (select organization_id from spaces)
  union all
  -- can_support_offering through offering_staff (any role), member of the space. (Its can_manage_offering branches are covered above.)
  select o.course_id, false from public.offering_staff s join public.course_offerings o on o.id=s.offering_id join public.courses c on c.id=o.course_id
  where s.user_id=(select id from me) and c.organization_id in (select organization_id from spaces)
  union all
  -- is_enrolled.
  select o.course_id, false from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id
   join public.organizations g on g.id=c.organization_id
  where e.user_id=(select id from me) and e.status='active' and (e.expires_at is null or e.expires_at>now()) and (e.enrolled_at is null or e.enrolled_at<=now())
   and o.status='active' and c.status='published' and g.status='active')
 select course_id, bool_or(staff) from found where (select id from me) is not null group by course_id
$$;

create or replace function private.my_viewable_courses() returns setof uuid
language sql stable security definer set search_path='' rows 20 as $$ select course_id from private.my_course_access() $$;

create or replace function private.my_staff_courses() returns setof uuid
language sql stable security definer set search_path='' rows 20 as $$ select course_id from private.my_course_access() where staff $$;

-- can_view_lesson: every lesson of a staff course, the published lessons of a viewable one.
create or replace function private.my_visible_lessons() returns setof uuid
language sql stable security definer set search_path='' rows 200 as $$
 select l.id from private.my_course_access() a join public.course_modules m on m.course_id=a.course_id join public.lessons l on l.module_id=m.id
 where a.staff or l.status='published'
$$;

-- can_view_segment: every part of a staff course, the published parts of published lessons of a viewable one.
create or replace function private.my_visible_segments() returns setof uuid
language sql stable security definer set search_path='' rows 200 as $$
 select s.id from private.my_course_access() a join public.course_modules m on m.course_id=a.course_id join public.lessons l on l.module_id=m.id
  join public.lesson_segments s on s.lesson_id=l.id
 where a.staff or (s.status='published' and l.status='published')
$$;

-- organizations_select: is_org_member(id), or a course of the space the caller may view.
create or replace function private.my_viewable_organizations() returns setof uuid
language sql stable security definer set search_path='' rows 4 as $$
 select organization_id from private.my_space_roles()
 union
 select c.organization_id from private.my_course_access() a join public.courses c on c.id=a.course_id
$$;

-- can_support_offering: the runs the caller manages or supports.
create or replace function private.my_supported_offerings() returns setof uuid
language sql stable security definer set search_path='' rows 20 as $$
 with me as materialized (select private.current_app_user_id() id),
 spaces as materialized (select organization_id, role from private.my_space_roles())
 select o.id from public.course_offerings o join public.courses c on c.id=o.course_id
 where c.organization_id in (select organization_id from spaces where role in ('owner','admin'))
 union
 select o.id from public.course_offerings o join public.courses c on c.id=o.course_id join public.course_staff s on s.course_id=c.id
 where s.user_id=(select id from me) and s.role in ('owner','instructor') and c.organization_id in (select organization_id from spaces)
 union
 select s.offering_id from public.offering_staff s join public.course_offerings o on o.id=s.offering_id join public.courses c on c.id=o.course_id
 where s.user_id=(select id from me) and c.organization_id in (select organization_id from spaces)
$$;

-- can_view_profile: the caller; anyone with a membership row in a space the caller owns or administers; anyone with an enrollment row in
-- a run the caller supports.
create or replace function private.my_visible_profiles() returns setof uuid
language sql stable security definer set search_path='' rows 50 as $$
 with me as materialized (select private.current_app_user_id() id)
 select id from me where id is not null
 union
 select m.user_id from public.organization_memberships m
 where m.organization_id in (select organization_id from private.my_space_roles() where role in ('owner','admin'))
 union
 select e.user_id from public.enrollments e where e.offering_id in (select private.my_supported_offerings())
$$;

-- The every-page context (A1-01): the caller's spaces and courses with the fields the context reads, the first 101 of each by id (what
-- the old unfiltered `order by id limit 101` reads returned under RLS). The caller is resolved once per set; nobody is resolved for a
-- caller with no trusted identity (both lists are empty, as the restrictive trusted_identity policies made them).
create or replace function private.my_scope() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'organizations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status) order by o.id)
   from (select o.id,o.name,o.status from public.organizations o where o.id in (select private.my_viewable_organizations()) order by o.id limit 101) o),'[]'::jsonb),
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'organization_id',c.organization_id,'title',c.title,'description',c.description,'status',c.status) order by c.id)
   from (select c.id,c.organization_id,c.title,c.description,c.status from public.courses c where c.id in (select private.my_viewable_courses()) order by c.id limit 101) c),'[]'::jsonb))
$$;

create or replace function public.my_scope() returns jsonb language sql stable set search_path='' as $$ select private.my_scope() $$;

do $$ declare f text; begin
 foreach f in array array['private.my_space_roles()','private.my_course_access()','private.my_viewable_courses()','private.my_staff_courses()',
  'private.my_visible_lessons()','private.my_visible_segments()','private.my_viewable_organizations()','private.my_supported_offerings()',
  'private.my_visible_profiles()','private.my_scope()','public.my_scope()'] loop
  execute format('revoke all on function %s from public, anon, service_role', f);
  execute format('grant execute on function %s to authenticated', f);
 end loop;
end $$;

-- The read policies: same name, same command, same role, same meaning; the per-row helper becomes one set per statement.
alter policy courses_select on public.courses using (id in (select private.my_viewable_courses()));
alter policy organizations_select on public.organizations using (id in (select private.my_viewable_organizations()));
alter policy profiles_select on public.profiles using (id in (select private.my_visible_profiles()));
alter policy course_modules_select on public.course_modules using (course_id in (select private.my_viewable_courses()));
alter policy lessons_select on public.lessons using (id in (select private.my_visible_lessons()));
alter policy lesson_blocks_select on public.lesson_blocks using (lesson_id in (select private.my_visible_lessons()));
alter policy segments_read on public.lesson_segments using (id in (select private.my_visible_segments()));
alter policy resources_read on public.lesson_resources using (segment_id in (select private.my_visible_segments()));

-- A0-07: the progress save. It already refuses an unpublished part, a caller not enrolled in an active run of a published course
-- (is_enrolled) and a run of another course. Given those, can_view_segment(part) is "the lesson is published, or the caller is staff of
-- the course" (a teacher enrolled in their own course could save a published part of a draft lesson, and still can). The staff helpers
-- run only for a draft lesson. Everything else is unchanged.
create or replace function private.save_segment_progress(p_offering_id uuid, p_segment_id uuid, p_position integer, p_complete boolean, p_revision bigint)
 returns jsonb language plpgsql security definer set search_path='' as $function$
declare s public.lesson_segments; p public.lesson_segment_progress; c uuid; lesson_status text; total integer; done integer;
begin
 select x.* into s from public.lesson_segments x where x.id=p_segment_id for share;
 select m.course_id, l.status into c, lesson_status from public.lessons l join public.course_modules m on m.id=l.module_id where l.id=s.lesson_id;
 -- Enrollment lock serializes saves for this student/offering, including different parts.
 perform 1 from public.enrollments e where e.offering_id=p_offering_id and e.user_id=(select private.current_app_user_id()) for share;
 if s.id is null or s.status<>'published'
 or not (case when lesson_status='published' then true else private.can_edit_course(c) or private.is_course_staff(c) end)
 or not private.is_enrolled(p_offering_id)
 or not exists(select 1 from public.course_offerings o where o.id=p_offering_id and o.course_id=c) then raise exception 'Lesson access denied' using errcode='42501'; end if;
 if p_position is null or p_position not between 0 and 604800 or p_complete is null or p_revision is null then raise exception 'Invalid progress' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_offering_id::text||':'||(select private.current_app_user_id())::text,0));
 select * into p from public.lesson_segment_progress x where x.offering_id=p_offering_id and x.segment_id=s.id and x.user_id=(select private.current_app_user_id()) for update;
 if coalesce(p.revision,0)<>p_revision then raise exception 'Progress changed. Reload.' using errcode='PT409'; end if;
 insert into public.lesson_segment_progress(offering_id,user_id,segment_id,lesson_id,status,video_position_seconds,completed_at,revision)
 values(p_offering_id,(select private.current_app_user_id()),s.id,s.lesson_id,case when p_complete then 'completed' else 'in_progress' end,p_position,case when p_complete then now() end,1)
 on conflict(offering_id,user_id,segment_id) do update set video_position_seconds=excluded.video_position_seconds,
 status=case when lesson_segment_progress.status='completed' or p_complete then 'completed' else 'in_progress' end,
 completed_at=coalesce(lesson_segment_progress.completed_at,excluded.completed_at),revision=lesson_segment_progress.revision+1 returning * into p;
 select count(*),count(*) filter(where x.status='completed') into total,done from public.lesson_segments sg left join public.lesson_segment_progress x on x.segment_id=sg.id and x.offering_id=p_offering_id and x.user_id=(select private.current_app_user_id()) where sg.lesson_id=s.lesson_id and sg.status='published';
 insert into public.lesson_progress(offering_id,lesson_id,user_id,status,started_at,completed_at,last_accessed_at,video_position_seconds)
 values(p_offering_id,s.lesson_id,(select private.current_app_user_id()),case when total>0 and total=done then 'completed' else 'in_progress' end,now(),case when total>0 and total=done then now() end,now(),p_position)
 on conflict(offering_id,lesson_id,user_id) do update set status=excluded.status,completed_at=excluded.completed_at,last_accessed_at=now(),video_position_seconds=excluded.video_position_seconds;
 return jsonb_build_object('revision',p.revision,'status',p.status,'position',p.video_position_seconds);
end $function$;

commit;
