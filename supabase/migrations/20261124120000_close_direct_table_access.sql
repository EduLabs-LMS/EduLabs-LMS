-- Track 1 of the fixing phase: direct table access closed (audit findings A0-02, A2a-02..A2a-05, A1-02 (revoke only), A1-04, A3-01,
-- A3-06, A0-10, A4-02, A5-01, A6a-14, A6b-01, A6b-03, A6b-04, A6b-05).
--
-- Principle: the browser's role (authenticated) may only READ tables the app reads directly and may WRITE nothing directly. Every write
-- goes through a private security-definer function (search_path='', caller from private.current_app_user_id(), wrapped by a public
-- security-invoker function, EXECUTE granted to authenticated only).
--
--   1. private.course_update / public.course_update: the one live direct content write (the course PATCH) as a function, with the
--      A2a-05 rule (publish, unpublish and archive: course owner/instructor and space owner/admin only; un-archive: space owner/admin only).
--   2. private.course_run / public.course_run: the course's current run, created under a course lock so two calls make ONE run (A3-06).
--   3. The block trigger now requires that a block's file belongs to this course's upload scope or that the caller can already view it (A2a-02).
--   4. profiles: display names are checked wherever they are written (A1-04).
--   5. Revoked direct writes and unused direct reads, with the policies that only served them dropped. No CASCADE, nothing dropped but policies.
--   6. Legacy exams locked down (not removed; that is Track 10): table grants, the 24 client RPCs and the lms-submissions upload path.
--
-- An applied migration is never edited; a fix is a new migration. Idempotent where practical.
begin;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Display names (A1-04). One rule, enforced in the database wherever a profile name is written.
--    A new profile (sign-in provisioning, demo, tests) gets a cleaned name, so a odd name from an identity provider never blocks sign-in.
--    A changed name is refused unless it is 1..128 characters after trimming, with no control character and no bidirectional override.
--    128 is the length the Firebase sign-in already cuts to; the account screen allows at most 60 + 1 + 60.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.display_name_valid(p_name text) returns boolean
language sql immutable set search_path='' as $$
 select p_name is not null and length(btrim(p_name)) between 1 and 128
  and p_name !~ '[[:cntrl:]]' and p_name !~ '[\u202a-\u202e\u2066-\u2069]'
$$;

create or replace function private.clean_display_name(p_name text) returns text
language sql immutable set search_path='' as $$
 select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_name,''),'[[:cntrl:]]',' ','g'),'[\u202a-\u202e\u2066-\u2069]','','g')),128),'')
$$;

create or replace function private.guard_profile_display_name() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.display_name := private.clean_display_name(new.display_name);
 elsif new.display_name is distinct from old.display_name and new.display_name is not null and not private.display_name_valid(new.display_name) then
  raise exception 'Display name is invalid' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.display_name_valid(text),private.clean_display_name(text),private.guard_profile_display_name() from public,anon,authenticated;

drop trigger if exists guard_display_name on public.profiles;
create trigger guard_display_name before insert or update of display_name on public.profiles
 for each row execute function private.guard_profile_display_name();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. The block's file must belong to this course (A2a-02). Same rule as check_segment_media (the caller must be able to view the file)
--    and check_lesson_cover (the file was uploaded for this course). A trusted path with no signed-in caller (migrations, seeds) is unchanged.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.require_ready_lesson_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare asset_status text; v_course uuid;
begin
 if new.media_asset_id is not null then
  select m.status into asset_status from public.media_assets m where m.id=new.media_asset_id for share;
  if asset_status is distinct from 'ready' then raise exception 'Lesson media must be ready' using errcode='23514'; end if;
  if private.current_app_user_id() is not null then
   select md.course_id into v_course from public.lessons l join public.course_modules md on md.id=l.module_id where l.id=new.lesson_id;
   if not exists(select 1 from private.lesson_upload_scopes s where s.asset_id=new.media_asset_id and s.course_id=v_course)
    and not private.can_view_media(new.media_asset_id) then
    raise exception 'Invalid lesson media' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. The course save as a function (A0-02, A2a-05). Replaces the direct update of the course PATCH.
--    p_fields holds only the fields being changed: title, slug, description, visibility, status.
--    The caller may edit the course (owner, admin, course owner/instructor/editor). Changing the status is narrower:
--    publish, unpublish and archive need the course owner/instructor or the space owner/admin; leaving "archived" needs the space owner/admin.
--    The permission is checked before the course row is locked, and again after. A stale revision is PT409.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.course_update(p_course_id uuid,p_revision timestamptz,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); c public.courses; k text; v_admin boolean; v_lead boolean;
 v_title text; v_slug text; v_desc text; v_vis text; v_status text; v_updated timestamptz;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_course_id is null or p_revision is null or p_fields is null or jsonb_typeof(p_fields)<>'object' or p_fields='{}'::jsonb then
  raise exception 'Invalid course details' using errcode='22023'; end if;
 for k in select jsonb_object_keys(p_fields) loop
  if k not in ('title','slug','description','visibility','status') then raise exception 'Invalid course details' using errcode='22023'; end if;
 end loop;
 if not private.can_edit_course(p_course_id) then raise exception 'Course not found or editing not permitted' using errcode='42501'; end if;
 select * into c from public.courses where id=p_course_id for no key update;
 if not found or not private.can_edit_course(p_course_id) then raise exception 'Course not found or editing not permitted' using errcode='42501'; end if;
 if c.updated_at is distinct from p_revision then raise exception 'Course changed; reload' using errcode='PT409'; end if;

 v_title := c.title; v_slug := c.slug; v_desc := c.description; v_vis := c.visibility; v_status := c.status;
 if p_fields ? 'title' then v_title := private.clean_text(p_fields->'title',200,'Course title'); end if;
 if p_fields ? 'slug' then
  if jsonb_typeof(p_fields->'slug')<>'string' then raise exception 'Course slug is invalid' using errcode='22023'; end if;
  v_slug := p_fields->>'slug';
  if length(v_slug) not between 1 and 100 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Course slug is invalid' using errcode='22023'; end if;
 end if;
 if p_fields ? 'description' then
  if jsonb_typeof(p_fields->'description') not in ('string','null') then raise exception 'Course description is invalid' using errcode='22023'; end if;
  v_desc := p_fields->>'description';
  if v_desc is not null and (length(v_desc)>20000 or v_desc ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then raise exception 'Course description is invalid' using errcode='22023'; end if;
 end if;
 if p_fields ? 'visibility' then
  v_vis := p_fields->>'visibility';
  if jsonb_typeof(p_fields->'visibility')<>'string' or v_vis not in ('private','unlisted','public') then raise exception 'Course visibility is invalid' using errcode='22023'; end if;
 end if;
 if p_fields ? 'status' then
  v_status := p_fields->>'status';
  if jsonb_typeof(p_fields->'status')<>'string' or v_status not in ('draft','published','archived') then raise exception 'Course status is invalid' using errcode='22023'; end if;
 end if;

 if v_status is distinct from c.status then
  v_admin := private.has_org_role(c.organization_id,array['owner','admin']);
  v_lead := v_admin or (private.is_org_member(c.organization_id) and exists(select 1 from public.course_staff s where s.course_id=c.id and s.user_id=u and s.role in ('owner','instructor')));
  if not v_lead then raise exception 'Only the course owner, its instructor or the space owner or admin can publish, unpublish or archive a course' using errcode='42501'; end if;
  if c.status='archived' and not v_admin then raise exception 'Only the space owner or admin can restore an archived course' using errcode='42501'; end if;
 end if;

 update public.courses set title=v_title,slug=v_slug,description=v_desc,visibility=v_vis,status=v_status where id=c.id returning updated_at into v_updated;
 return jsonb_build_object('id',c.id,'updatedAt',v_updated);
end $$;
revoke all on function private.course_update(uuid,timestamptz,jsonb) from public,anon;
grant execute on function private.course_update(uuid,timestamptz,jsonb) to authenticated;
create or replace function public.course_update(p_course_id uuid,p_revision timestamptz,p_fields jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.course_update(p_course_id,p_revision,p_fields) $$;
revoke all on function public.course_update(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.course_update(uuid,timestamptz,jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. The course's current run (A3-06, A3-01). The current run is the active run that has not ended; with several, the one that started
--    last, then the lowest id (the rule shared/teacher-groups.ts currentRun always used). A course with none gets one, made under a
--    lock on the course row, so two calls at once make ONE run. Who may make it is the old course_offerings insert rule: the space
--    owner or admin, or a course owner or instructor who is staff of the space. Anyone else with access to the run just receives its id.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.course_run(p_course_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); c public.courses; v_run uuid; v_may boolean;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into c from public.courses where id=p_course_id;
 if not found or not private.can_view_course(p_course_id) then raise exception 'Group unavailable or permission denied' using errcode='42501'; end if;
 v_may := private.has_org_role(c.organization_id,array['owner','admin'])
  or (private.is_org_member(c.organization_id) and exists(select 1 from public.course_staff s where s.course_id=c.id and s.user_id=u and s.role in ('owner','instructor')));
 select o.id into v_run from public.course_offerings o where o.course_id=p_course_id and o.status='active' and (o.ends_at is null or o.ends_at>clock_timestamp())
  order by coalesce(o.starts_at,'epoch'::timestamptz) desc,o.id limit 1;
 if v_run is not null then
  if not private.can_support_offering(v_run) then raise exception 'Group unavailable or permission denied' using errcode='42501'; end if;
  return v_run;
 end if;
 if not v_may then raise exception 'Group unavailable or permission denied' using errcode='42501'; end if;
 select * into c from public.courses where id=p_course_id for no key update;
 if c.status='archived' then raise exception 'An archived course cannot get a new run' using errcode='23514'; end if;
 select o.id into v_run from public.course_offerings o where o.course_id=p_course_id and o.status='active' and (o.ends_at is null or o.ends_at>clock_timestamp())
  order by coalesce(o.starts_at,'epoch'::timestamptz) desc,o.id limit 1;
 if v_run is not null then return v_run; end if;
 insert into public.course_offerings(course_id,name,delivery_mode,status) values(p_course_id,c.title,'scheduled','active') returning id into v_run;
 return v_run;
end $$;
revoke all on function private.course_run(uuid) from public,anon;
grant execute on function private.course_run(uuid) to authenticated;
create or replace function public.course_run(p_course_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select private.course_run(p_course_id) $$;
revoke all on function public.course_run(uuid) from public,anon;
grant execute on function public.course_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Safety checks before the revokes (listed in docs/ai/fixes/TRACK-01-direct-access.md).
--    private.expired_media_uploads is a security_invoker view that read assessment_responses as the caller; that table is closed below.
--    The check moves into a definer helper so the view and the storage-maintenance script keep working for any maintenance role.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.assessment_response_uses_media(p_asset_id uuid) returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.assessment_responses r where r.media_asset_id=p_asset_id) $$;
revoke all on function private.assessment_response_uses_media(uuid) from public,anon,authenticated;
grant execute on function private.assessment_response_uses_media(uuid) to service_role;

create or replace view private.expired_media_uploads with (security_invoker=true) as
 select m.id,m.organization_id,m.uploaded_by,m.storage_provider,m.bucket,m.object_path,m.upload_expires_at
 from public.media_assets m
 where ((m.status='pending' and m.upload_expires_at<now()) or m.status='archived')
  and not exists(select 1 from public.lessons l where l.cover_asset_id=m.id)
  and not exists(select 1 from public.lesson_blocks b where b.media_asset_id=m.id)
  and not private.assessment_response_uses_media(m.id)
  and not exists(select 1 from public.lesson_segments s where s.video_asset_id=m.id or s.thumbnail_asset_id=m.id)
  and not exists(select 1 from public.lesson_resources r where r.media_asset_id=m.id);
revoke all on private.expired_media_uploads from public,anon,authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Direct writes closed (A0-02, A2a-02..04, A1-02 revoke, A1-04, A3-01, A0-10). The browser role keeps SELECT where the app reads.
--    A table-level REVOKE also removes the column-level grants. Permissive write policies are dropped; the restrictive
--    trusted_identity policies and every read policy stay.
-- ---------------------------------------------------------------------------------------------------------------------------------
revoke insert,update,delete,truncate,references,trigger on
 public.courses,public.course_modules,public.course_staff,public.lessons,public.lesson_blocks,public.lesson_progress,public.media_assets,
 public.organization_memberships,public.organizations,public.profiles,
 public.enrollments,public.course_offerings,public.offering_staff
 from anon,authenticated;

drop policy if exists courses_delete on public.courses;
drop policy if exists courses_insert on public.courses;
drop policy if exists courses_update on public.courses;
drop policy if exists course_modules_delete on public.course_modules;
drop policy if exists course_modules_insert on public.course_modules;
drop policy if exists course_modules_update on public.course_modules;
drop policy if exists course_staff_delete on public.course_staff;
drop policy if exists course_staff_insert on public.course_staff;
drop policy if exists course_staff_update on public.course_staff;
drop policy if exists lessons_delete on public.lessons;
drop policy if exists lessons_insert on public.lessons;
drop policy if exists lessons_update on public.lessons;
drop policy if exists lesson_blocks_delete on public.lesson_blocks;
drop policy if exists lesson_blocks_insert on public.lesson_blocks;
drop policy if exists lesson_blocks_update on public.lesson_blocks;
drop policy if exists lesson_progress_insert on public.lesson_progress;
drop policy if exists lesson_progress_update on public.lesson_progress;
drop policy if exists media_assets_insert on public.media_assets;
drop policy if exists organization_memberships_delete on public.organization_memberships;
drop policy if exists organization_memberships_insert on public.organization_memberships;
drop policy if exists organization_memberships_update on public.organization_memberships;
drop policy if exists organizations_update on public.organizations;
drop policy if exists profiles_update on public.profiles;
drop policy if exists enrollments_insert on public.enrollments;
drop policy if exists enrollments_update on public.enrollments;
drop policy if exists course_offerings_insert on public.course_offerings;
drop policy if exists course_offerings_update on public.course_offerings;
drop policy if exists offering_staff_delete on public.offering_staff;
drop policy if exists offering_staff_insert on public.offering_staff;
drop policy if exists offering_staff_update on public.offering_staff;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Unused direct reads closed (A4-02, A5-01). No code, script or realtime channel reads these tables; every read goes through a function.
-- ---------------------------------------------------------------------------------------------------------------------------------
revoke all on
 public.study_groups,public.group_staff,public.group_memberships,public.group_schedules,public.group_sessions,public.session_attendance,
 public.homework_questions,public.homework_options,public.homework_submissions,public.homework_responses,public.homework_submission_files
 from anon,authenticated;

drop policy if exists groups_read on public.study_groups;
drop policy if exists group_staff_read on public.group_staff;
drop policy if exists group_memberships_read on public.group_memberships;
drop policy if exists group_schedules_read on public.group_schedules;
drop policy if exists group_sessions_read on public.group_sessions;
drop policy if exists session_attendance_read on public.session_attendance;
drop policy if exists homework_questions_read on public.homework_questions;
drop policy if exists homework_options_read on public.homework_options;
drop policy if exists homework_submissions_read on public.homework_submissions;
drop policy if exists homework_responses_read on public.homework_responses;
drop policy if exists homework_files_read on public.homework_submission_files;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Legacy exams locked down (A6b-01, A6b-03, A6b-04, A6b-05, A6a-14). Nothing is dropped here; the removal is Track 10.
--    - the six legacy tables lose every privilege for the browser, anonymous and service roles
--    - the 24 client RPCs lose EXECUTE (save_exam_definition(_v2) and clone_exam_schedule were already closed to clients)
--    - the lms-submissions bucket takes no more uploads and serves no more downloads to clients; course media is unchanged
-- ---------------------------------------------------------------------------------------------------------------------------------
revoke all on public.assessments,public.offering_assessments,public.assessment_questions,public.assessment_options,public.assessment_attempts,public.assessment_responses
 from anon,authenticated,service_role;

revoke all on function
 public.clone_assessment(uuid,text),public.decide_exam_retry(uuid,text,bigint),public.finalize_assessment_grade(uuid),
 public.get_assessment_answer_keys(uuid),public.get_assessment_results(uuid),public.get_exam_attempt_content(uuid),
 public.get_exam_definition(uuid),public.get_exam_definition_v2(uuid),public.get_exam_grade_changes(uuid),public.get_exam_grading_detail(uuid),
 public.get_exam_review(uuid),public.get_exam_submission_page(uuid,uuid,integer),public.get_exam_summaries(uuid[]),
 public.grade_assessment_response(uuid,numeric,text),public.grade_exam_paper(uuid,bigint,jsonb,text,text,uuid),
 public.release_exam_result(uuid,uuid,bigint),public.release_exam_review(uuid,uuid,bigint),
 public.save_assessment_response(uuid,uuid,jsonb,uuid),public.save_exam_answers(uuid,bigint,jsonb),public.save_exam_response(uuid,uuid,jsonb,uuid,bigint),
 public.set_assessment_answer_key(uuid,jsonb),public.start_assessment_attempt(uuid),public.submit_assessment_attempt(uuid),public.sync_exam_participation(uuid)
 from public,anon,authenticated,service_role;

alter policy lms_objects_insert on storage.objects
 with check (bucket_id='lms-course-media' and owner_id=(select auth.jwt()->>'sub') and private.can_upload_media(bucket_id,name));
alter policy lms_objects_select on storage.objects
 using (bucket_id='lms-course-media' and private.can_download_media(bucket_id,name));

commit;
