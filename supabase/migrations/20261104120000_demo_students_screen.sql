-- Demo Clear for the teacher Students screen. Migration 20261030120000_demo_students.sql is unchanged. Its Clear refused a space that had any
-- student access link, join request or student-administration audit row, so a teacher who tried Invite students, Approve or Suspend in a demo
-- space made Clear impossible.
--
-- This replaces private.demo_clear_core only (same signature, same grants, no new objects, no table or allowed-list change; the seed does
-- not change, so the seed version stays 3). Everything else it does is as before. What changes:
--   * the blocker "student access" is split in two and only names what a REAL person created or is the subject of:
--       - "join requests or invitations from real people": a join request whose student is not a recorded demo student, or an invitation
--         whose recipient or claimant is not;
--       - "student administration records of real people": an audit row whose subject is not a recorded demo student.
--     A demo student has no sign-in, so these exist only when a real person used a link of this space. Clear still touches none of it.
--   * what the teacher's own use leaves is removed, found only through the space's recorded offerings: join links (request links have no
--     student; invitation links for demo students), join requests of demo students, and the audit rows (link, revoke, suspend and reactivate
--     of demo students). The audit rows are not append-only in the database (no trigger or grant says so; the table is private and only the
--     student-administration function and this one write it). Removing them is the least invasive way to let Clear finish, and it leaves a trace:
--     the platform audit row Clear writes records the number of removed rows per table (removedByTable.student_access_links,
--     .enrollment_requests, .student_admin_audit).
--   * private.student_admin_commands (the idempotency record of the teacher's commands) is left alone: it is keyed by the teacher and the request,
--     holds no student data beyond ids in a small result, and no foreign key points from it to anything Clear removes.
-- Real students never reach any of this: a space with an enrolled real student is refused first ("enrolled students"), as before.
begin;

create or replace function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 courses_ uuid[]; offerings_ uuid[]; groups_ uuid[]; sessions_ uuid[]; events_ uuid[]; lessons_ uuid[]; profiles_ uuid[]; enrollments_ uuid[]; blockers_ text[] := '{}';
 n_tracked integer := 0; n_added integer := 0; n_support integer := 0; cnt integer;
 added jsonb := '{}'::jsonb;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;

 select coalesce(array_agg(row_id) filter (where table_name='courses'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='profiles'),'{}'),
        coalesce(array_agg(row_id) filter (where table_name='enrollments'),'{}')
  into courses_,profiles_,enrollments_ from private.demo_seed_rows where organization_id=p_org;
 if exists(select 1 from public.courses where id=any(courses_) and organization_id<>p_org) then
  raise exception 'Demo records do not match this space' using errcode='PT409'; end if;
 select coalesce(array_agg(distinct o.id),'{}') into offerings_ from public.course_offerings o
  where o.course_id=any(courses_)
     or o.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='course_offerings');
 select coalesce(array_agg(distinct g.id),'{}') into groups_ from public.study_groups g
  where g.offering_id=any(offerings_)
     or g.id in (select row_id from private.demo_seed_rows where organization_id=p_org and table_name='study_groups');
 select coalesce(array_agg(s.id),'{}') into sessions_ from public.group_sessions s where s.group_id=any(groups_);
 select coalesce(array_agg(l.id),'{}') into lessons_ from public.lessons l join public.course_modules m on m.id=l.module_id where m.course_id=any(courses_);

 -- A real student (any enrollment that is not recorded as a demo enrollment), and content this function does not remove. Refuse, naming it.
 if private.space_has_real_students(p_org) then blockers_ := array_append(blockers_,'enrolled students'::text); end if;
 if exists(select 1 from public.homework_assignments where course_id=any(courses_) or offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'homework'::text); end if;
 if exists(select 1 from public.assessments where course_id=any(courses_)) or exists(select 1 from public.offering_assessments where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'exams'::text); end if;
 if exists(select 1 from public.media_assets where offering_id=any(offerings_)) or exists(select 1 from private.lesson_upload_scopes where course_id=any(courses_)) then blockers_ := array_append(blockers_,'media'::text); end if;
 if exists(select 1 from public.lesson_segments where lesson_id=any(lessons_)) then blockers_ := array_append(blockers_,'lesson segments'::text); end if;
 if exists(select 1 from public.lesson_progress where offering_id=any(offerings_)) then blockers_ := array_append(blockers_,'student progress'::text); end if;
 if exists(select 1 from public.website_catalog_entries where course_id=any(courses_)) or exists(select 1 from private.website_publication_courses where course_id=any(courses_)) then blockers_ := array_append(blockers_,'website courses'::text); end if;
 -- The Students screen: a teacher's own use (a join link, a suspension) is removed below. What a REAL person did is never touched: Clear stops and says so.
 if exists(select 1 from public.enrollment_requests where offering_id=any(offerings_) and not (user_id=any(profiles_)))
   or exists(select 1 from private.student_access_links where offering_id=any(offerings_)
     and ((recipient_id is not null and not (recipient_id=any(profiles_))) or (claimed_by is not null and not (claimed_by=any(profiles_))))) then
  blockers_ := array_append(blockers_,'join requests or invitations from real people'::text); end if;
 if exists(select 1 from private.student_admin_audit where offering_id=any(offerings_) and subject_id is not null and not (subject_id=any(profiles_))) then
  blockers_ := array_append(blockers_,'student administration records of real people'::text); end if;
 if cardinality(blockers_)>0 then
  raise exception 'This demo space holds content that Clear does not remove: %. Remove it first.',array_to_string(blockers_,', ') using errcode='PT409'; end if;

 -- Notifications that belong to the Groups, Sessions and demo students (by event key prefix, session, group, enrollment or recipient).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id=any(sessions_) or resource_id=any(groups_) or resource_id=any(sessions_) or resource_id=any(enrollments_)
     or id in (select event_id from public.notifications where recipient_id=any(profiles_));
 delete from private.notification_deliveries where notification_id in (select id from public.notifications where event_id=any(events_) or recipient_id=any(profiles_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.notifications where event_id=any(events_) or recipient_id=any(profiles_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.notification_events where id=any(events_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_notification_state where group_id=any(groups_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_audit where group_id=any(groups_) or session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.session_attendance where session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;

 -- What the teacher's own use of the Students screen left behind in this space, found by the space's recorded offerings only:
 -- join links (the teacher's, or for a demo student), requests of demo students, and the student-administration audit rows about demo students
 -- or about no student at all (links). Real people's rows were refused above, so none of these is a real person's. The audit table is not
 -- append-only in the database; removing these rows is recorded in the platform audit row written at the end (removedByTable).
 delete from private.student_access_links where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('student_access_links',cnt);
 delete from public.enrollment_requests where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollment_requests',cnt);
 delete from private.student_admin_audit where offering_id=any(offerings_);
 get diagnostics cnt = row_count; n_support := n_support+cnt; added := added||jsonb_build_object('student_admin_audit',cnt);

 -- Everything that hangs off the Groups, recorded or added by the teacher.
 delete from public.group_sessions where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_sessions',cnt);
 delete from public.group_schedules where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_schedules',cnt);
 delete from public.group_memberships where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_memberships',cnt);
 delete from public.group_staff where group_id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('group_staff',cnt);
 delete from public.study_groups where id=any(groups_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('study_groups',cnt);
 -- The demo students: enrollments (the per-enrollment administration version goes by ON DELETE CASCADE), then the fake profiles.
 delete from public.enrollments where id=any(enrollments_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('enrollments',cnt);
 delete from public.profiles where id=any(profiles_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('profiles',cnt);
 -- Course-level rows that block the course itself.
 delete from public.course_stage_assignments where course_id=any(courses_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_stage_assignments',cnt);
 delete from private.course_stage_versions where course_id=any(courses_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.course_offerings where id=any(offerings_);
 get diagnostics cnt = row_count; n_added := n_added+cnt; added := added||jsonb_build_object('course_offerings',cnt);
 -- The recorded courses. Chapters, lessons and lesson blocks (recorded or added by the teacher), course staff and offering staff are removed
 -- by the existing ON DELETE CASCADE chain (courses -> course_modules -> lessons -> lesson_blocks). Chapters and lessons are counted first; lesson blocks and
 -- course/offering staff rows (a trigger adds the course owner) cascade and are not counted.
 select count(*) into cnt from public.course_modules where course_id=any(courses_);
 n_tracked := cnt+cardinality(lessons_); added := added||jsonb_build_object('course_modules',cnt,'lessons',cardinality(lessons_));
 delete from public.courses where id=any(courses_);
 get diagnostics cnt = row_count; n_tracked := n_tracked+cnt; added := added||jsonb_build_object('courses',cnt);
 delete from private.demo_seed_rows where organization_id=p_org;
 update private.demo_spaces set seed_version=null,filled_at=null where organization_id=p_org;
 perform private.write_platform_audit(p_actor,'demo.clear','organization',p_org,p_org,
  jsonb_build_object('rows',n_tracked+n_added,'removedRows',n_tracked+n_added,'removedSupportRows',n_support,'removedByTable',added,
   'removedCourseTree',n_tracked));
 return jsonb_build_object('removedRows',n_tracked+n_added,'removedSupportRows',n_support);
end $$;

commit;
