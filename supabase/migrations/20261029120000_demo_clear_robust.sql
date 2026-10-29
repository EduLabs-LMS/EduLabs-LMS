-- Demo clear, made robust. Migration 34 (20261027120000_demo_spaces.sql) is unchanged. Its Clear removed only the rows the fill had
-- recorded, but a teacher can add things inside a demo Group or course (a Session, a weekly time, another Group, another offering, a
-- stage assignment). Those rows are not recorded, and every foreign key into study_groups, group_sessions, course_offerings and
-- courses is ON DELETE RESTRICT, so the whole Clear failed and rolled back.
--
-- This replaces private.demo_clear_core (same signature, same grants, no new objects). It works from the recorded COURSES of the one space:
--   * every offering of a recorded course (recorded or teacher-added) and every Group of those offerings, plus every recorded Group;
--   * for those Groups: Session attendance, notifications and their events, notification state, audit, Sessions, weekly times,
--     memberships and staff;
--   * for those courses: stage assignments and versions, then offerings and courses (chapters, lessons, lesson blocks, course and
--     offering staff are removed by the existing ON DELETE CASCADE).
-- It still refuses when the space has any enrollment, and it refuses (naming what it found) when the space holds content it does not
-- remove: homework, exams, media, lesson segments, website publications, access links, enrollment requests. It never touches a course,
-- offering or Group that does not belong to a recorded course/Group of this space, and it never matches by name.
begin;

create or replace function private.demo_clear_core(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 courses_ uuid[]; offerings_ uuid[]; groups_ uuid[]; sessions_ uuid[]; events_ uuid[]; lessons_ uuid[]; blockers_ text[] := '{}';
 n_tracked integer := 0; n_added integer := 0; n_support integer := 0; cnt integer;
 added jsonb := '{}'::jsonb;
begin
 perform 1 from private.demo_spaces where organization_id=p_org for update;
 if not found then raise exception 'This space is not marked as a demo space' using errcode='PT409'; end if;
 -- Same rule as marking and filling: a space with students is never cleared by this function.
 if exists(select 1 from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id
   where c.organization_id=p_org) then
  raise exception 'A space with enrolled students cannot be cleared as a demo space' using errcode='PT409'; end if;

 select coalesce(array_agg(row_id) filter (where table_name='courses'),'{}') into courses_ from private.demo_seed_rows where organization_id=p_org;
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

 -- Content this function does not remove. Refuse with a clear message instead of failing on a foreign key.
 if exists(select 1 from public.homework_assignments where course_id=any(courses_) or offering_id=any(offerings_)) then blockers_ := blockers_||'homework'; end if;
 if exists(select 1 from public.assessments where course_id=any(courses_)) or exists(select 1 from public.offering_assessments where offering_id=any(offerings_)) then blockers_ := blockers_||'exams'; end if;
 if exists(select 1 from public.media_assets where offering_id=any(offerings_)) or exists(select 1 from private.lesson_upload_scopes where course_id=any(courses_)) then blockers_ := blockers_||'media'; end if;
 if exists(select 1 from public.lesson_segments where lesson_id=any(lessons_)) then blockers_ := blockers_||'lesson segments'; end if;
 if exists(select 1 from public.website_catalog_entries where course_id=any(courses_)) or exists(select 1 from private.website_publication_courses where course_id=any(courses_)) then blockers_ := blockers_||'website courses'; end if;
 if exists(select 1 from private.student_access_links where offering_id=any(offerings_)) or exists(select 1 from public.enrollment_requests where offering_id=any(offerings_))
   or exists(select 1 from private.student_admin_audit where offering_id=any(offerings_)) then blockers_ := blockers_||'student access'; end if;
 if cardinality(blockers_)>0 then
  raise exception 'This demo space holds content that Clear does not remove: %. Remove it first.',array_to_string(blockers_,', ') using errcode='PT409'; end if;

 -- Notifications that belong to the Groups and Sessions (by event key prefix, session or group).
 select coalesce(array_agg(id),'{}') into events_ from private.notification_events
  where event_key like 'demo:'||p_org::text||':%' or session_id=any(sessions_) or resource_id=any(groups_) or resource_id=any(sessions_);
 delete from private.notification_deliveries where notification_id in (select id from public.notifications where event_id=any(events_));
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.notifications where event_id=any(events_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.notification_events where id=any(events_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_notification_state where group_id=any(groups_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from private.group_audit where group_id=any(groups_) or session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;
 delete from public.session_attendance where session_id=any(sessions_);
 get diagnostics cnt = row_count; n_support := n_support+cnt;

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

revoke all on function private.demo_clear_core(uuid,uuid) from public,anon,authenticated;

commit;
