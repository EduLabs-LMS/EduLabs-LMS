# Backend audit: map, part list and global lock inventory

Read-only audit of the EduLabs database and the server code that calls it. Branch `claude/backend-audit`, cut from
`claude/online-class` at `6e747bcb9b6fbdf6ec70f31547de6f48c96b811d` (2026-11-16). No code, migration, test or config was changed.
Nothing ran against the VPS or any Supabase project. All evidence comes from a disposable local PostgreSQL 17.10 on loopback,
built from the 52 migrations in this tree, then dropped.

| Part | Scope | Report |
| --- | --- | --- |
| 0 | Map, lock scan across the whole database, shared security helpers | done: [PART-0-map-and-locks.md](PART-0-map-and-locks.md) |
| 1 | Accounts, organizations (spaces), members, invitations, platform admin | done: [PART-1-accounts-spaces.md](PART-1-accounts-spaces.md) |
| 2a | Courses, content, lesson progress, media and lesson storage (RLS read cost included) | done: [PART-2a-content.md](PART-2a-content.md) |
| 2b | Academic programs and stages, the student stage pick, teacher websites and public catalogs | done: [PART-2b-programs-websites.md](PART-2b-programs-websites.md) |
| 3 | Enrollment: runs, invites, join requests, run staff (`offering_staff`) | done: [PART-3-enrollment.md](PART-3-enrollment.md) |
| 4 | Groups, sessions, attendance, live class | not started |
| 5 | Homework | not started |
| 6a | New exams (`private.exams`, `exam_*`) | not started |
| 6b | Legacy exams (`assessments` family): every caller, so it can be retired | not started |
| 7 | Notifications, push, email, background jobs | not started |
| 8 | Reports, demo data | not started |
| 9 | Server routes and services that call the database (auth boundary, service-role key use), the server's direct table writes, and the service-role scripts | not started |

## How the "live" version was found

`create or replace` in a later migration wins. All 52 migrations were replayed into an empty database in file order, exactly as
`scripts/exam-sql-local.cjs` does: the local bootstrap, then `seed.sql` before `complete_lesson_workflows`, then the rest. The
catalog (`pg_proc`, `pg_policy`, `pg_trigger`, `pg_constraint`, grants) was then read. A function's "live file" is the last migration
with a `create [or replace] function <schema>.<name>(` statement. Two kinds were placed by hand:

- The six `private.*_v17` functions are the original exam functions, renamed by `alter function ... rename to` in
  `20261012044748_secure_exam_attempts_and_results.sql:74-79`. Their bodies are the last versions before that rename
  (`20261010100544` and `20261001230606`).
- `private.onboard_firebase_profile` and `private.revoke_my_firebase_identity` are copies of the `public` versions
  (`20261010123515:61`), made by the `do` block in `20261010124048_private_firebase_provisioning.sql:3`.

Totals: 111 tables and views (`public` 50, `private` 61), 382 functions (`private` 272, `public` 110), 108 triggers and 240 foreign keys.
No function name is overloaded, so no older signature is still callable next to a newer one.

## Suggested changes to the part list

1. **Split Part 2.** It holds 28 tables and 58 functions in three unrelated areas. Suggest 2a: courses, content, lesson progress,
   media and lesson storage. Suggest 2b: academic programs and stages, plus teacher websites and public catalogs. 2b is the only
   surface `anon` can call (`public_teacher_catalog`, `resolve_teacher_website`, `public_teacher_asset`). It also holds two of
   the space-row locks (`academic_command`, `website_command`) and the student stage pick.
2. **Split Part 6.** It holds 133 functions in two exam systems that are both live and both called by the server. The legacy one
   is `assessments`, `offering_assessments`, `assessment_*`, `save_exam_definition` v1 and v2, `*_v17`. The new one is
   `private.exams` and `exam_*`. Suggest 6a for the new system and 6b for the legacy one: what still calls it, and whether it can be
   retired.
3. **Part 2a must include RLS read cost, not only writes.** The worst finding of Part 0 is a read: per-row policy helpers on
   `lesson_blocks`, `lessons` and `lesson_segments` (PART-0, finding 1).
4. **Part 9 should also cover the two service-role scripts** outside the Next app: `scripts/notification-dispatch.cjs`, which calls
   `notification_worker` (granted to `service_role` only), and `scripts/lms-storage-maintenance.cjs`. Part 9 should also cover the
   direct table writes the server makes through PostgREST: `courses` update, `course_offerings` insert, `media_assets` insert and
   `lesson_progress` upsert.
5. **Part 3 should include `offering_staff`** (run staff). The map puts it there.

## Global lock inventory

Every lock-taking statement in the live code: 174 rows in 75 functions, located in the migration that holds the live version. The
search covered `LOCK TABLE`, `FOR UPDATE / NO KEY UPDATE / SHARE / KEY SHARE` (with `NOWAIT` / `SKIP LOCKED`), advisory locks,
runtime DDL, `TRUNCATE` and `REFRESH MATERIALIZED VIEW`.

- **No `LOCK TABLE`, no runtime DDL, no `TRUNCATE`, no `REFRESH MATERIALIZED VIEW`, no session-level advisory lock** anywhere in the
  live functions. The only dynamic SQL is `edit_learning_content` (`20261110120000:17`). It runs `format('... public.%I ...')` with the table name chosen
  from fixed literals (`course_modules`, `lessons`, `lesson_segments`, `lesson_blocks`), never from input.
- **No `statement_timeout` or `lock_timeout`** is set in any migration, function config, role config, `supabase/config.toml` or
  server file. A lock wait therefore lasts until the platform's role timeout, if one exists. The local server has 0 (unlimited).
- **20 advisory locks**, all `pg_advisory_xact_lock` (released at commit). The keys are per person, per person and item, or per item
  (exam settle, paper marks, homework family, invitation e-mail). None is per space or global.
- **2 deferred constraint triggers**: `exam_link_new_session` on `group_sessions` and `exam_link_new_group` on `study_groups`
  (`private.exam_link_group`). At commit they take the exam row `FOR KEY SHARE`; for sessions they add `SKIP LOCKED`.
- **No trigger serializes child writes on a parent row.** The only trigger that writes a parent row is
  `group_enrollment_interval`, and it does so only when an enrollment's status or dates change (a teacher action). It locks the run
  row and bumps `study_groups.version`. No counter or `updated_at` cascade exists from children to parents.

### Locks on rows shared by many people

These are the locks that can make one person's action wait on another's. "Holds" times were measured on the local server with the
real functions, as real signed-in users (PART-0 has the proofs).

| Shared row | Taken `FOR UPDATE` by (live file:line) | Who waits | Measured hold |
| --- | --- | --- | --- |
| **Space** (`organizations`) | `set_student_stage_preference` (student, 20261018203119:227); `academic_command` (20261018203119:130); `website_command` (20261019004546:150); `review_website_resource` (20261019004546:233); `accept_teacher_invitation` (20261024120000:352); `platform_reissue/revoke_teacher_invitation` (20261024120000:300, :326); `platform_rename_teaching_space` (20261105130000:203); `rename_my_teaching_space` (20261105130000:220); `platform_set_demo_space` (20261030120000:44); trigger `protect_last_owner` (20261010144028:9) | Every other `FOR UPDATE` taker in the space, and every insert of a row that references the space by foreign key: courses, media uploads, notification events (every notification in the space), memberships, support tickets, academic programs | stage pick 4.8 ms |
| **Run** (`course_offerings`) | `group_command` for every action, including each attendance save (20261018100132:26); trigger `enforce_capacity` on every enrollment insert/update (20261001230358:117); trigger `group_enrollment_interval` (20261014054726:392); `student_administration` (20261106120000:219) | Every other Group of the run, plus inserts that reference the run: homework, exams, enrollments, Groups, join requests, access links, media | attendance save 21 ms; 14-slot schedule edit (182 sessions) 25 ms; archive 25 ms |
| **Course** (`courses`) | `edit_learning_content` for every lesson/part/block save (20261110120000:21); `edit_course_structure` (20261110120000:118); `academic_command` course.assign; trigger `close_chapter_gaps` | Every other editor of the course, plus inserts that reference the course (runs, chapters, exams, homework, staff). It also makes a student's stage pick fail at once (`NOWAIT`) | block save 3–19 ms |
| **Exam** (`private.exams`) | `exam_save` (20261115120000:48), `exam_lifecycle`, `exam_set_window` | Every student answer save in that exam (`exam_work` takes it `FOR SHARE`, 20261114120000:912) | live-exam rename 14 ms |
| **Homework** (`homework_assignments`) | `save_homework`, `homework_lifecycle`, `homework_delete_images` | Every student start/save/submit/upload on it (`FOR SHARE`) | not measured (draft autosave only) |
| **Group / Session** | `group_command`, `materialize_group`, `snapshot_group_roster` | `live_class_open` (`FOR SHARE`), notices (`emit_group_joining_notice` `FOR SHARE`) | inside the run lock above |
| **Demo space** (`private.demo_spaces`) | `demo_fill_core`, `demo_clear_core` | Only that demo space's own fill/clear | fill 308–377 ms (about 1,000 rows), clear 23–185 ms |

`FOR SHARE` on shared rows taken by frequent student actions (exam row per answer save, homework row per save, lesson part per
progress save) was load-tested: 40 students saving answers in one exam at the same moment gave p50 7.6 ms, p95 10.8 ms (alone:
1.6 ms). This is not a problem.

### Lock order

Each function's order was read from its live body. The orders are consistent: space → person → membership; run → Group →
membership → session; homework → enrollment → advisory → submission; exam → advisory → try → result. Two places reverse an
order, and both handle it:

- `protect_last_owner` locks membership → space, the reverse of `academic_command`, `website_command` and
  `set_student_stage_preference` (space → membership). Those three take the membership with `NOWAIT`, so they fail at once with
  55P03 instead of deadlocking (comment at 20261018203119:131).
- A trigger on an enrollment `UPDATE` locks the enrollment row, then the run (`enforce_capacity`, `group_enrollment_interval`).
  `student_administration` locks run → enrollment. The app never updates `enrollments` directly; only a hand-made Data API call
  could, so a deadlock is possible only that way (PART-0, finding 10).

### Full table


Scope words: SPACE, RUN, COURSE, EXAM, HOMEWORK, GROUP and SESSION rows are parent rows shared by many people. Everything else is one person's or one item's row. Location = live migration timestamp:line.

| Part | Function | Live location | Lock | On | Scope |
| --- | --- | --- | --- | --- | --- |
| 1 | `accept_teacher_invitation` | 20261024120000:352 | for update | public.organizations (`id=org`) | SPACE row (shared by the whole space) |
| 1 | `accept_teacher_invitation` | 20261024120000:353 | for share | public.profiles (`id=u`) | one person |
| 1 | `accept_teacher_invitation` | 20261024120000:354 | for update | private.teacher_invitations (`token_hash=v_hash`) | one invitation |
| 1 | `account_profile` | 20261018104040:56 | for update | public.account_profiles (`user_id=u`) | one child row |
| 1 | `account_profile` | 20261018104040:72 | for update | private.account_avatar_assets (`id=asset and user_id=u`) | one child row |
| 1 | `onboard_firebase_profile` | 20261010123515:61 (copied to private by the do-block in 20261010124048:3) | advisory xact lock | hash(iss\|\|':'\|\|sub) | key below |
| 1 | `onboard_firebase_profile` | same | for update | private.external_identities (`issuer, subject`) | one child row |
| 1 | `platform_provision_teacher` | 20261105130000:55 | advisory xact lock | hash('teacher-invitation:'\|\|v_email,0) | key below |
| 1 | `platform_record_invitation_delivery` | 20261025100000:35 | for update | private.teacher_invitations (`id=p_invitation_id`) | one invitation |
| 1 | `platform_reissue_teacher_invitation` | 20261024120000:300 | for update | public.organizations (`id=p_organization_id`) | SPACE row (shared by the whole space) |
| 1 | `platform_reissue_teacher_invitation` | 20261024120000:308 | advisory xact lock | hash('teacher-invitation:'\|\|v_email,0) | key below |
| 1 | `platform_rename_teaching_space` | 20261105130000:203 | for update | public.organizations (`id=p_organization_id`) | SPACE row (shared by the whole space) |
| 1 | `platform_revoke_teacher_invitation` | 20261024120000:326 | for update | public.organizations (`id=p_organization_id`) | SPACE row (shared by the whole space) |
| 1 | `platform_revoke_teacher_invitation` | 20261024120000:328 | for update | private.teacher_invitations (`organization_id=p_organization_id and status='pending'`) | one invitation |
| 1 | `platform_set_demo_space` | 20261030120000:44 | for update | public.organizations (`id=p_org`) | SPACE row (shared by the whole space) |
| 1 | `platform_store_invitation_salt` | 20261025100000:74 | for update | private.teacher_invitations (`id=p_invitation_id`) | one invitation |
| 1 | `protect_last_owner` | 20261010144028:9 | for update | public.organizations (`o.id = old.organization_id`) | SPACE row (shared by the whole space) |
| 1 | `rename_my_teaching_space` | 20261105130000:220 | for update of o | public.organizations (`the caller owns it (join to organization_memberships)`) | SPACE row (shared by the whole space) |
| 2 | `abandon_media_upload` | 20261010100544:51 | for update | public.media_assets (`id=p_asset_id`) | one media row |
| 2 | `academic_command` | 20261018203119:130 | for update | public.organizations (`id=p_organization_id`) | SPACE row (shared by the whole space) |
| 2 | `academic_command` | 20261018203119:131 | for share | public.profiles (`id=u`) | one person |
| 2 | `academic_command` | 20261018203119:134 | for share nowait | public.organization_memberships (`organization_id=p_organization_id and user_id=u`) | one membership |
| 2 | `academic_command` | 20261018203119:138 | for update | public.courses (`id=p_entity_id and organization_id=p_organization_id`) | COURSE row (shared by every run of the course) |
| 2 | `academic_command` | 20261018203119:139 | for share nowait | public.course_staff (`course_id=p_entity_id and user_id=u`) | one child row |
| 2 | `academic_command` | 20261018203119:170 | for update | public.academic_programs (`id=p_entity_id and organization_id=p_organization_id`) | one child row |
| 2 | `academic_command` | 20261018203119:174 | for update | public.academic_stages (`id=p_entity_id and organization_id=p_organization_id`) | one child row |
| 2 | `archive_unused_lesson_upload` | 20261018091735:113 | for update | public.media_assets (`id=p_asset_id`) | one media row |
| 2 | `check_lesson_cover` | 20261018091735:10 | for share | public.media_assets (`a.id=new.cover_asset_id`) | one media row |
| 2 | `check_segment_media` | 20261013141230:74 | for share | public.media_assets (`a.id=asset`) | one media row |
| 2 | `close_chapter_gaps` | 20261106130000:70 | for update | public.courses (`c.id=p_course`) | COURSE row (shared by every run of the course) |
| 2 | `complete_media_upload` | 20261013141230:302 | for update | public.media_assets (`id=p_asset_id`) | one media row |
| 2 | `edit_course_structure` | 20261110120000:118 | for update | public.courses (`c.id=p_course_id`) | COURSE row (shared by every run of the course) |
| 2 | `edit_course_structure` | 20261110120000:139 | for update | public.course_modules (`m.id=p_id and m.course_id=p_course_id`) | one child row |
| 2 | `edit_course_structure` | 20261110120000:142 | for update of l | public.lessons (`l.id=p_id and m.course_id=p_course_id`) | one child row |
| 2 | `edit_course_structure` | 20261110120000:169 | for update | public.lessons (`l.id=(item->>'id')::uuid and l.module_id=p_parent_id`) | one child row |
| 2 | `edit_course_structure` | 20261110120000:201 | for update | public.lessons (`l.id=(item->>'id')::uuid and l.module_id=p_id`) | one child row |
| 2 | `edit_learning_content` | 20261110120000:21 | for update | public.courses (`c.id=p_course_id`) | COURSE row (shared by every run of the course) |
| 2 | `edit_learning_content` | 20261110120000:26 | for update | public.course_modules (`m.id=p_id and m.course_id=p_course_id`) | one child row |
| 2 | `edit_learning_content` | 20261110120000:43 | for update of l | public.lessons (`l.id=p_id and m.course_id=p_course_id`) | one child row |
| 2 | `refuse_archived_structure` | 20261106130000:113 | for share | public.courses (`c.id=course`) | COURSE row (shared by every run of the course) |
| 2 | `register_lesson_upload` | 20261013141230:249 | for share | public.courses (`c.id=p_course_id`) | COURSE row (shared by every run of the course) |
| 2 | `require_ready_lesson_media` | 20261010101249:8 | for share | public.media_assets (`m.id=new.media_asset_id`) | one media row |
| 2 | `review_website_resource` | 20261019004546:233 | for update | public.organizations (`id=org`) | SPACE row (shared by the whole space) |
| 2 | `review_website_resource` | 20261019004546:234 | for update | public.organization_websites (`id=site`) | space website row |
| 2 | `review_website_resource` | 20261019004546:237 | for update | public.organization_website_domains (`id=p_id`) | one child row |
| 2 | `review_website_resource` | 20261019004546:246 | for update | public.public_website_assets (`id=p_id`) | one child row |
| 2 | `save_segment_progress` | 20261013141230:177 | for share | public.lesson_segments (`x.id=p_segment_id`) | lesson part row (shared by its viewers) |
| 2 | `save_segment_progress` | 20261013141230:180 | for share | public.enrollments (`e.offering_id=p_offering_id and e.user_id=(select private.current_app_`) | one student enrollment |
| 2 | `save_segment_progress` | 20261013141230:184 | advisory xact lock | hash(p_offering_id::text\|\|':'\|\|(select private.current_app_user_id())::text,0) | key below |
| 2 | `save_segment_progress` | 20261013141230:185 | for update | public.lesson_segment_progress (`x.offering_id=p_offering_id and x.segment_id=s.id and x.user_id=(selec`) | one child row |
| 2 | `set_student_stage_preference` | 20261018203119:227 | for update | public.organizations (`id=org`) | SPACE row (shared by the whole space) |
| 2 | `set_student_stage_preference` | 20261018203119:228 | for share | public.profiles (`id=u`) | one person |
| 2 | `set_student_stage_preference` | 20261018203119:229 | for share nowait | public.organization_memberships (`organization_id=org and user_id=u`) | one membership |
| 2 | `set_student_stage_preference` | 20261018203119:233 | for share nowait | public.enrollments, public.course_offerings, public.courses (`every enrollment of the student in the space, with its run and course`) | RUN and COURSE rows of the student (fails at once if locked) |
| 2 | `set_student_stage_preference` | 20261018203119:241 | for update | public.student_stage_preferences (`user_id=u and program_id=p.id`) | one child row |
| 2 | `website_command` | 20261019004546:150 | for update | public.organizations (`id=p_org`) | SPACE row (shared by the whole space) |
| 2 | `website_command` | 20261019004546:151 | for share | public.profiles (`id=u`) | one person |
| 2 | `website_command` | 20261019004546:152 | for share nowait | public.organization_memberships (`organization_id=p_org and user_id=u`) | one membership |
| 2 | `website_command` | 20261019004546:154 | for update | public.organization_websites (`organization_id=p_org`) | space website row |
| 2 | `website_command` | 20261019004546:201 | for update | public.organization_website_domains (`id=(p_data->>'id')::uuid and website_id=w.id`) | one child row |
| 3 | `enforce_capacity` | 20261001230358:117 | for update | public.course_offerings (`o.id=new.offering_id`) | RUN row (shared by every Group and student of the run) |
| 3 | `student_administration` | 20261106120000:213 | advisory xact lock | hash('student-admin:'\|\|u,0) | key below |
| 3 | `student_administration` | 20261106120000:219 | for update | public.course_offerings (`id=f.id`) | RUN row (shared by every Group and student of the run) |
| 3 | `student_administration` | 20261106120000:220 | for share | public.courses (`id=f.course_id`) | COURSE row (shared by every run of the course) |
| 3 | `student_administration` | 20261106120000:221 | for share | public.profiles (`p.id in(u,target,case when p_action in ('request','accept') then link.`) | one person |
| 3 | `student_administration` | 20261106120000:224 | for share | public.organization_memberships (`m.organization_id=course_row.organization_id and m.user_id=case when p`) | one membership |
| 3 | `student_administration` | 20261106120000:225 | for share | public.course_staff (`s.course_id=course_row.id and s.user_id=case when p_action in ('reques`) | one child row |
| 3 | `student_administration` | 20261106120000:226 | for share | public.offering_staff (`s.offering_id=f.id and s.user_id=case when p_action in ('request','acc`) | one child row |
| 3 | `student_administration` | 20261106120000:228 | for share | public.organizations (`id=course_row.organization_id`) | SPACE row (shared by the whole space) |
| 3 | `student_administration` | 20261106120000:230 | for update | private.student_access_links (`id=link.id`) | one child row |
| 3 | `student_administration` | 20261106120000:256 | for update | public.enrollment_requests (`offering_id=f.id and user_id=target`) | one child row |
| 3 | `student_administration` | 20261106120000:273 | for update | public.enrollments (`offering_id=f.id and user_id=target`) | one student enrollment |
| 3 | `student_administration` | 20261106120000:284 | for update | public.enrollments (`offering_id=f.id and user_id=target`) | one student enrollment |
| 4 | `group_command` | 20261018100132:26 | for update | public.course_offerings (`id=target`) | RUN row (shared by every Group and student of the run) |
| 4 | `group_command` | 20261018100132:27 | for update | public.study_groups (`id=p_group`) | GROUP row |
| 4 | `group_command` | 20261018100132:89 | for update | public.group_memberships (`offering_id=g.offering_id and user_id=target and ends_at is null`) | one child row |
| 4 | `group_command` | 20261018100132:97 | for update | public.study_groups (`id=sid`) | GROUP row |
| 4 | `group_command` | 20261018100132:117 | for update | public.group_sessions (`id=(p_data->>'sessionId')::uuid and group_id=g.id`) | SESSION row |
| 4 | `group_enrollment_interval` | 20261014054726:392 | for update | public.course_offerings (`id=new.offering_id`) | RUN row (shared by every Group and student of the run) |
| 4 | `group_enrollment_interval` | 20261014054726:393 | for update | public.group_memberships (`enrollment_id=new.id and ends_at is null`) | one child row |
| 4 | `live_class_open` | 20261119120000:91 | for share | public.group_sessions (`id=p_session`) | SESSION row |
| 4 | `materialize_group` | 20261014054726:136 | for update | public.study_groups (`id=p_group`) | GROUP row |
| 4 | `snapshot_group_roster` | 20261014054726:158 | for update | public.group_sessions (`id=p_session`) | SESSION row |
| 5 | `homework_asset` | 20261013184915:222 | for share | private.homework_uploads (`id=p_asset`) | one child row |
| 5 | `homework_delete_images` | 20261109120000:665 | for update | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `homework_lifecycle` | 20261112120000:246 | for update | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `homework_lifecycle` | 20261112120000:279 | advisory xact lock | hash(a.family_id::text\|\|'homework-version',0) | key below |
| 5 | `homework_release_many` | 20261109120000:823 | for share | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `homework_release_many` | 20261109120000:825 | for update | public.homework_submissions (`s.id=any(ids)`) | one child row |
| 5 | `homework_release_many` | 20261109120000:827 | for update | private.homework_corrections (`x.submission_id=any(ids)`) | one child row |
| 5 | `homework_storage` | 20261109120000:152 | for share | private.homework_uploads (`path=p_path`) | one child row |
| 5 | `homework_upload` | 20261112120000:321 | for share | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `homework_upload` | 20261112120000:327 | for share | public.enrollments (`e.offering_id=a.offering_id and e.user_id=u`) | one student enrollment |
| 5 | `homework_upload` | 20261112120000:328 | for share | public.homework_submissions (`s.id=p_submission and s.assignment_id=a.id and s.user_id=u and s.statu`) | one child row |
| 5 | `homework_upload` | 20261112120000:338 | advisory xact lock | hash(a.id::text\|\|u::text\|\|'uploads',0) | key below |
| 5 | `homework_upload` | 20261112120000:348 | for update | private.homework_uploads (`id=p_id`) | one child row |
| 5 | `homework_work` | 20261109120000:299 | for share | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `homework_work` | 20261109120000:301 | for share | public.enrollments (`e.offering_id=a.offering_id and e.user_id=u`) | one student enrollment |
| 5 | `homework_work` | 20261109120000:304 | advisory xact lock | hash(a.id::text\|\|u::text,0) | key below |
| 5 | `homework_work` | 20261109120000:305 | for update | public.homework_submissions (`assignment_id=a.id and user_id=u`) | one child row |
| 5 | `homework_work` | 20261109120000:324 | advisory xact lock | hash(a.id::text\|\|u::text,0) | key below |
| 5 | `homework_work` | 20261109120000:325 | for update | public.homework_submissions (`assignment_id=a.id and user_id=u`) | one child row |
| 5 | `homework_work` | 20261109120000:356 | for update | public.homework_submissions (`id=p_submission and assignment_id=a.id`) | one child row |
| 5 | `homework_work` | 20261109120000:431 | for update | private.homework_corrections (`submission_id=s.id`) | one child row |
| 5 | `homework_work` | 20261109120000:451 | for update | private.homework_annotations (`id=(p_data->>'id')::uuid and submission_id=s.id`) | one child row |
| 5 | `save_homework` | 20261112120000:91 | for share | public.course_offerings (`id=p_offering`) | RUN row (shared by every Group and student of the run) |
| 5 | `save_homework` | 20261112120000:96 | for share | public.course_offerings (`x.id in (v_from,p_offering)`) | RUN row (shared by every Group and student of the run) |
| 5 | `save_homework` | 20261112120000:105 | for update | public.homework_assignments (`id=p_assignment`) | HOMEWORK row (shared by every student of it) |
| 5 | `set_homework_assistant` | 20261109120000:706 | advisory xact lock | hash(p_course::text\|\|'homework-assistants',0) | key below |
| 5 | `set_homework_assistant` | 20261109120000:710 | for update | private.homework_assistant_permissions (`course_id=p_course and user_id=p_user`) | one child row |
| 6 | `auto_grade_attempt_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for update | public.assessment_attempts (`one attempt (start: shared exam rows FOR SHARE)`) | one child row |
| 6 | `clone_assessment` | 20261001230606:135 | for share | public.assessments (`id=p_assessment_id`) | legacy exam row (shared) |
| 6 | `clone_exam_schedule` | 20261012063114:128 | for share of x | public.assessments (`y.id=p_schedule_id`) | legacy exam row (shared) |
| 6 | `clone_exam_schedule` | 20261012063114:129 | for share | public.offering_assessments (`id=p_schedule_id`) | legacy exam schedule row (shared) |
| 6 | `exam_finish` | 20261114120000:512 | for update | private.exam_attempts (`id=p_attempt`) | one child row |
| 6 | `exam_lifecycle` | 20261114120000:790 | for update | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_link_group` | 20261114120000:326 | for key share | private.exams (`id=ex and status='published'`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_link_group` | 20261114120000:327 | for key share skip locked | private.exams (`id=ex and status='published'`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_mark_try` | 20261114120000:498 | for update | private.exam_results (`exam_id=a.exam_id and user_id=a.user_id`) | one child row |
| 6 | `exam_paper_mark` | 20261114120000:1111 | for share | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_paper_mark` | 20261114120000:1115 | advisory xact lock | hash(e.id::text\|\|':exam-paper',0) | key below |
| 6 | `exam_paper_mark` | 20261114120000:1116 | for update | private.exam_results (`x.exam_id=e.id and x.user_id=any(users_)`) | one child row |
| 6 | `exam_release_many` | 20261114120000:1078 | for share | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_release_many` | 20261114120000:1081 | for update | private.exam_results (`x.id=any(ids)`) | one child row |
| 6 | `exam_save` | 20261115120000:48 | for update | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_set_window` | 20261114120000:849 | for update | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_settle` | 20261114120000:529 | advisory xact lock | hash(e.id::text\|\|':exam-settle',0) | key below |
| 6 | `exam_settle` | 20261114120000:535 | for update | private.exam_results (`r.exam_id=e.id and r.status='corrected' and r.released_at is null`) | one child row |
| 6 | `exam_storage` | 20261114120000:577 | for share | private.exam_uploads (`path=p_path`) | one child row |
| 6 | `exam_upload` | 20261114120000:1154 | for share | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_upload` | 20261114120000:1162 | for share | private.exam_attempts (`id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u`) | one child row |
| 6 | `exam_upload` | 20261114120000:1170 | advisory xact lock | hash(e.id::text\|\|':'\|\|u::text\|\|':exam-uploads',0) | key below |
| 6 | `exam_upload` | 20261114120000:1175 | for update | private.exam_uploads (`id=p_id`) | one child row |
| 6 | `exam_work` | 20261114120000:912 | for share | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_work` | 20261114120000:916 | advisory xact lock | hash(e.id::text\|\|':'\|\|u::text\|\|':exam-student',0) | key below |
| 6 | `exam_work` | 20261114120000:937 | for share | public.group_sessions (`s.id=sess`) | SESSION row |
| 6 | `exam_work` | 20261114120000:961 | for update | private.exam_attempts (`id=(d->>'attemptId')::uuid and exam_id=e.id and user_id=u`) | one child row |
| 6 | `exam_work` | 20261114120000:1004 | for share | private.exams (`id=p_exam`) | EXAM row (shared by every student of the exam) |
| 6 | `exam_work` | 20261114120000:1011 | for update | private.exam_attempts (`id=(d->>'attemptId')::uuid and exam_id=e.id`) | one child row |
| 6 | `exam_work` | 20261114120000:1014 | for update | private.exam_results (`exam_id=e.id and user_id=a.user_id`) | one child row |
| 6 | `exam_work` | 20261114120000:1037 | for update | private.exam_results (`id=(d->>'resultId')::uuid and exam_id=e.id`) | one child row |
| 6 | `finalize_assessment_grade_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for update | public.assessment_attempts (`one attempt (start: shared exam rows FOR SHARE)`) | one child row |
| 6 | `grade_assessment_response_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for update | public.assessment_attempts (`one attempt (start: shared exam rows FOR SHARE)`) | one child row |
| 6 | `lock_exam` | 20261012044748:100 | for share of a | public.assessments (`s.id=p_schedule`) | legacy exam row (shared) |
| 6 | `lock_exam` | 20261012044748:101 | for share | public.offering_assessments (`id=p_schedule`) | legacy exam schedule row (shared) |
| 6 | `lock_exam` | 20261012044748:102 | advisory xact lock | hash(p_schedule::text\|\|coalesce(p_user::text,'anonymous'),0) | key below |
| 6 | `lock_exam` | 20261012044748:103 | for share | public.enrollments (`offering_id=(select offering_id from public.offering_assessments where`) | one student enrollment |
| 6 | `lock_exam` | 20261012044748:104 | for update | private.assessment_participations (`schedule_id=p_schedule and user_id=p_user`) | one child row |
| 6 | `lock_exam` | 20261012044748:105 | for update | public.assessment_attempts (`offering_assessment_id=p_schedule and user_id=p_user`) | one child row |
| 6 | `preserve_assessment_history` | 20261001230358:88 | for update | public.assessments (`a.id=aid`) | legacy exam row (shared) |
| 6 | `save_assessment_response` | 20261012044748:297 | for share | public.media_assets (`id=p_media_asset_id`) | one media row |
| 6 | `save_assessment_response_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for update | public.assessment_attempts (`one attempt (start: shared exam rows FOR SHARE)`) | one child row |
| 6 | `save_exam_definition` | 20261012053751:8 | for share | public.course_offerings (`id=p_offering_id`) | RUN row (shared by every Group and student of the run) |
| 6 | `save_exam_definition` | 20261012053751:10 | for share | public.courses (`id=o.course_id`) | COURSE row (shared by every run of the course) |
| 6 | `save_exam_definition` | 20261012053751:24 | for update of x | public.assessments (`y.id=p_schedule_id`) | legacy exam row (shared) |
| 6 | `save_exam_definition` | 20261012053751:25 | for update | public.offering_assessments (`id=p_schedule_id`) | legacy exam schedule row (shared) |
| 6 | `save_exam_definition_v2` | 20261012063114:8 | for share | public.course_offerings (`id=p_offering_id`) | RUN row (shared by every Group and student of the run) |
| 6 | `save_exam_definition_v2` | 20261012063114:10 | for share | public.courses (`id=o.course_id`) | COURSE row (shared by every run of the course) |
| 6 | `save_exam_definition_v2` | 20261012063114:26 | for update of x | public.assessments (`y.id=p_schedule_id`) | legacy exam row (shared) |
| 6 | `save_exam_definition_v2` | 20261012063114:27 | for update | public.offering_assessments (`id=p_schedule_id`) | legacy exam schedule row (shared) |
| 6 | `start_assessment_attempt_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for share + advisory + for update | public.assessments, public.offering_assessments, enrollments; advisory schedule\|\|user | key below |
| 6 | `submit_assessment_attempt_v17` | renamed in 20261012044748:74-79 (body: 20261010100544 / 20261001230606) | for update | public.assessment_attempts (`one attempt (start: shared exam rows FOR SHARE)`) | one child row |
| 7 | `emit_group_joining_notice` | 20261015185510:226 | for share | public.study_groups (`id=p_group`) | GROUP row |
| 7 | `notification_command` | 20261015185510:328 | advisory xact lock | hash('push:'\|\|u,0) | key below |
| 7 | `notification_command` | 20261015185510:330 | for update | private.push_subscriptions (`endpoint=p_data->>'endpoint'`) | one child row |
| 7 | `notification_worker` | 20261119120000:271 | for update skip locked | private.notification_deliveries (`(status='pending' or status='leased' and lease_until<clock_timestamp()`) | one child row |
| 7 | `notification_worker` | 20261119120000:274 | for update | private.notification_deliveries (`id=(p_data->>'id')::uuid`) | one child row |
| 7 | `notification_worker` | 20261119120000:284 | for update | private.notification_deliveries (`id=(p_data->>'id')::uuid`) | one child row |
| 7 | `support_command` | 20261015185510:353 | advisory xact lock | hash('support-actor:'\|\|u,0) | key below |
| 7 | `support_command` | 20261015185510:354 | advisory xact lock | hash(u\|\|':'\|\|p_request,0) | key below |
| 7 | `support_command` | 20261015185510:359 | advisory xact lock | hash('support:'\|\|u,0) | key below |
| 7 | `support_command` | 20261015185510:367 | for update | public.support_tickets (`id=p_ticket`) | one child row |
| 8 | `demo_clear_core` | 20261114120000:1461 | for update | private.demo_spaces (`organization_id=p_org`) | demo space row |
| 8 | `demo_fill_core` | 20261119120000:348 | for update | private.demo_spaces (`organization_id=p_org`) | demo space row |

## Map: every table and function, by part

Grouped by name; a later part may pull in a helper from another. Table grants to `authenticated` are in brackets (S select, I insert, U update, D delete); no table has a grant to `anon`. Every table not marked has no API grant. `(invoker)` marks the few non-definer functions; every other private function is `security definer` with `search_path=''`.

### Part 0: Shared security helpers (Part 0)

**Tables (0).** 

**Functions (22: 21 private, 1 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`can_edit_course` 20261001230357 · `can_manage_course_staff` 20261001230357 · `can_manage_offering` 20261001230357 · `can_support_offering` 20261001230357 · `can_view_course` 20261001230357 · `can_view_profile` 20261001230357 · `check_lms_integrity` 20261001230955 ×2 · `clean_text` 20261024120000 (invoker) · `current_app_user_id` 20261010123515 ×2 · `has_org_role` 20261001230357 · `is_active_user` 20261001230357 · `is_course_staff` 20261001230357 · `is_enrolled` 20261001230357 · `is_org_member` 20261001230357 · `is_platform_admin` 20261024120000 · `is_trusted_identity_token` 20261010123515 (invoker) · `next_free_slug` 20261024120000 (invoker) · `reject_reparenting` 20261001230358 (invoker) · `slugify` 20261024120000 (invoker) · `token_hash_bytes` 20261024120000 (invoker) · `touch_updated_at` 20261001230352 (invoker)

Public API wrappers: `is_platform_admin`

### Part 1: Accounts, organizations, members, platform admin

**Tables (9).** `private.account_avatar_assets`, `private.external_identities`, `private.platform_admins`, `private.platform_audit`, `private.teacher_invitations`, `account_profiles` (S), `organization_memberships` (DIS), `organizations` (S), `profiles` (S)

**Functions (45: 26 private, 19 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`accept_teacher_invitation` 20261024120000 · `account_avatar_access` 20261018104040 · `account_profile` 20261018104040 · `avatar_capability` 20261018104040 · `create_organization` 20261001230606 · `create_profile` 20261010123515 ×2 · `disable_native_identity` 20261010123515 · `onboard_firebase_profile` ? · `platform_audit_append_only` 20261024120000 (invoker) · `platform_invitation_delivery` 20261025100000 · `platform_invitation_link` 20261025100000 · `platform_portal_detail` 20261105130000 ×2 · `platform_portal_overview` 20261105130000 ×2 · `platform_provision_teacher` 20261105130000 ×2 · `platform_record_invitation_delivery` 20261025100000 · `platform_reissue_teacher_invitation` 20261024120000 · `platform_rename_teaching_space` 20261105130000 · `platform_revoke_teacher_invitation` 20261024120000 · `platform_set_demo_space` 20261030120000 ×2 · `platform_store_invitation_salt` 20261025100000 · `protect_last_owner` 20261010144028 ×2 · `rename_my_teaching_space` 20261105130000 · `revoke_my_firebase_identity` ? · `teacher_invitation_guard` 20261024120000 (invoker) · `teacher_invitation_preview` 20261025100000 · `write_platform_audit` 20261024120000 (invoker)

Public API wrappers: `accept_teacher_invitation`, `account_profile`, `create_organization`, `current_profile_id`, `onboard_firebase_profile`, `platform_invitation_delivery`, `platform_invitation_link`, `platform_portal_detail`, `platform_portal_overview`, `platform_provision_teacher`, `platform_record_invitation_delivery`, `platform_reissue_teacher_invitation`, `platform_rename_teaching_space`, `platform_revoke_teacher_invitation`, `platform_set_demo_space`, `platform_store_invitation_salt`, `rename_my_teaching_space`, `revoke_my_firebase_identity`, `teacher_invitation_preview`

### Part 2: Courses, content, media, storage (also academic programs/stages and teacher websites, see the part-list notes)

**Tables (28).** `private.course_stage_versions`, `private.lesson_upload_scopes`, `private.website_audit`, `private.website_publication_course_stages`, `private.website_publication_courses`, `private.website_publication_stages`, `private.website_publications`, `private.website_reserved_domains`, `academic_programs` (S), `academic_stages` (S), `academic_subjects` (S), `course_modules` (S), `course_staff` (DIS), `course_stage_assignments` (S), `courses` (DIS), `lesson_blocks` (DIS), `lesson_progress` (IS), `lesson_resources` (S), `lesson_segment_progress` (S), `lesson_segments` (S), `lessons` (IS), `media_assets` (S), `organization_website_domains` (S), `organization_websites` (S), `public_website_assets` (S), `student_stage_preferences` (S), `website_catalog_entries` (S), `website_stage_selections` (S)

**Functions (58: 40 private, 18 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`abandon_media_upload` 20261010100544 · `academic_command` 20261018203119 · `archive_unused_lesson_upload` 20261018091735 ×2 · `assign_course_owner` 20261001230358 · `can_download_media` 20261010100544 ×2 · `can_remove_lesson_upload` 20261018091735 ×2 · `can_review_lesson_upload` 20261013141230 · `can_upload_media` 20261013141230 ×3 · `can_view_academic_organization` 20261018203119 · `can_view_academic_stage` 20261018203119 · `can_view_lesson` 20261001230357 · `can_view_media` 20261018091735 ×3 · `can_view_segment` 20261013141230 · `check_lesson_cover` 20261018091735 · `check_segment_media` 20261013141230 · `close_chapter_gaps` 20261106130000 · `close_chapter_gaps_after_delete` 20261106130000 · `complete_media_upload` 20261013141230 ×3 · `course_assistant_right` 20261114120000 · `course_stage_classification` 20261018203119 · `course_structure` 20261106130000 · `create_teacher_course` 20261010181140 ×2 · `edit_course_structure` 20261110120000 ×2 · `edit_learning_content` 20261110120000 ×4 · `get_lesson_upload` 20261013141230 · `keep_lesson_in_course` 20261106130000 · `lesson_delete_blockers` 20261106130000 · `lesson_delete_counts` 20261106130000 · `pin_chapter_label` 20261106130000 · `refuse_archived_structure` 20261106130000 · `register_lesson_upload` 20261013141230 · `require_ready_lesson_media` 20261010101249 · `review_website_resource` 20261019004546 · `save_segment_progress` 20261013141230 · `set_student_stage_preference` 20261018203119 · `website_command` 20261019004546 · `website_config_valid` 20261019004546 (invoker) · `website_hostname_allowed` 20261019004546 · `website_hostname_valid` 20261019004546 (invoker) · `website_text` 20261019004546 (invoker)

Public API wrappers: `abandon_media_upload`, `academic_command`, `archive_unused_lesson_upload`, `complete_media_upload`, `course_stage_classification`, `course_structure`, `create_teacher_course`, `edit_course_structure`, `edit_learning_content`, `get_lesson_upload`, `public_teacher_asset`, `public_teacher_catalog`, `register_lesson_upload`, `resolve_teacher_website`, `review_website_resource`, `save_segment_progress`, `set_student_stage_preference`, `teacher_website_command`

### Part 3: Enrollment: runs, invites, join requests

**Tables (8).** `private.enrollment_admin_versions`, `private.student_access_links`, `private.student_admin_audit`, `private.student_admin_commands`, `course_offerings` (IS), `enrollment_requests` (S), `enrollments` (IS), `offering_staff` (DIS)

**Functions (5: 4 private, 1 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`bump_enrollment_admin_version` 20261016053117 · `enforce_capacity` 20261001230358 · `student_administration` 20261106120000 ×2 · `student_link_issuer` 20261016053117

Public API wrappers: `student_administration`

### Part 4: Groups, sessions, attendance, live class

**Tables (9).** `private.group_audit`, `private.live_class_joins`, `private.live_class_rooms`, `group_memberships` (S), `group_schedules` (S), `group_sessions` (S), `group_staff` (S), `session_attendance` (S), `study_groups` (S)

**Functions (14: 10 private, 4 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`can_manage_group` 20261014054726 · `can_view_group` 20261014054726 · `group_command` 20261018100132 ×2 · `group_enrollment_interval` 20261014054726 · `group_view` 20261106120000 ×4 · `live_class_joined` 20261119120000 · `live_class_open` 20261119120000 · `materialize_group` 20261014054726 · `snapshot_group_roster` 20261014054726 · `valid_group_meeting_url` 20261014054726 (invoker)

Public API wrappers: `group_command`, `group_view`, `live_class_joined`, `live_class_open`

### Part 5: Homework

**Tables (18).** `private.homework_annotations`, `private.homework_assistant_permissions`, `private.homework_audit`, `private.homework_carried`, `private.homework_clone_sources`, `private.homework_corrections`, `private.homework_keys`, `private.homework_marks`, `private.homework_materials`, `private.homework_solutions`, `private.homework_solutions_seen`, `private.homework_uploads`, `homework_assignments` (S), `homework_options` (S), `homework_questions` (S), `homework_responses` (S), `homework_submission_files` (S), `homework_submissions` (S)

**Functions (46: 31 private, 15 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`get_homework` 20261112120000 ×3 · `homework_asset` 20261013184915 · `homework_assistants` 20261109120000 · `homework_course_manager` 20261109120000 · `homework_delete_images` 20261109120000 · `homework_enrolled` 20261013184915 · `homework_history` 20261013184915 · `homework_inbox` 20261013184915 · `homework_integrity` 20261112120000 ×2 · `homework_is_late` 20261109120000 · `homework_lifecycle` 20261112120000 ×3 · `homework_portal` 20261112120000 ×2 · `homework_queue` 20261109120000 · `homework_release_many` 20261109120000 · `homework_revisions` 20261013184915 · `homework_solutions_rule` 20261109120000 · `homework_staff` 20261109120000 ×2 · `homework_storage` 20261109120000 ×2 · `homework_storage_usage` 20261109120000 · `homework_submission_json` 20261109120000 ×2 · `homework_submission_visible` 20261013184915 · `homework_unlocked` 20261109120000 ×2 · `homework_upload` 20261112120000 ×3 · `homework_upload_referenced` 20261112120000 ×2 · `homework_upload_visible` 20261112120000 ×2 · `homework_visible` 20261013184915 · `homework_week_start` 20261109120000 · `homework_work` 20261109120000 ×2 · `homework_workflow_guard` 20261109120000 · `save_homework` 20261112120000 ×3 · `set_homework_assistant` 20261109120000

Public API wrappers: `get_homework`, `homework_assistants`, `homework_delete_images`, `homework_history`, `homework_inbox`, `homework_lifecycle`, `homework_portal`, `homework_queue`, `homework_release_many`, `homework_revisions`, `homework_storage_usage`, `homework_upload`, `homework_work`, `save_homework`, `set_homework_assistant`

### Part 6: Exams (new private.exams and the legacy assessments family)

**Tables (23).** `private.assessment_answer_keys`, `private.assessment_participations`, `private.assessment_question_outcomes`, `private.exam_attempt_items`, `private.exam_attempts`, `private.exam_audit`, `private.exam_chapters`, `private.exam_grade_changes`, `private.exam_group_windows`, `private.exam_keys`, `private.exam_marks`, `private.exam_options`, `private.exam_questions`, `private.exam_responses`, `private.exam_results`, `private.exam_uploads`, `private.exams`, `assessment_attempts`, `assessment_options` (DI), `assessment_questions` (DIS), `assessment_responses`, `assessments` (DIS), `offering_assessments` (IS)

**Functions (133: 93 private, 40 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`auto_grade_attempt` 20261012044748 ×2 · `auto_grade_attempt_v17` ? · `can_grade_assessment` 20261001230357 · `can_view_assessment` 20261001230357 · `clone_assessment` 20261001230606 · `clone_exam_schedule` 20261012063114 · `decide_exam_retry` 20261012044748 · `exam_apply_timing` 20261114120000 · `exam_attempt_json` 20261114120000 · `exam_audit_write` 20261114120000 · `exam_check` 20261115120000 ×2 · `exam_closed` 20261114120000 · `exam_day_start` 20261114120000 · `exam_enrolled` 20261012044748 · `exam_enrolled_user` 20261114120000 · `exam_finish` 20261114120000 · `exam_get` 20261115120000 ×2 · `exam_integrity` 20261012044748 · `exam_iso` 20261114120000 · `exam_items` 20261114120000 · `exam_last_close` 20261114120000 · `exam_lifecycle` 20261114120000 · `exam_link` 20261114120000 · `exam_link_group` 20261114120000 · `exam_mark_try` 20261114120000 · `exam_materialize` 20261114120000 · `exam_paper_mark` 20261114120000 · `exam_paper_sheet` 20261114120000 · `exam_portal` 20261114120000 · `exam_question_json` 20261114120000 · `exam_queue` 20261114120000 · `exam_release_check` 20261114120000 · `exam_release_many` 20261114120000 · `exam_released` 20261114120000 · `exam_result_notice` 20261114120000 · `exam_review_open` 20261114120000 · `exam_row_integrity` 20261114120000 · `exam_save` 20261115120000 ×2 · `exam_set_window` 20261114120000 · `exam_settings_json` 20261114120000 · `exam_settle` 20261114120000 · `exam_staff` 20261114120000 · `exam_state` 20261012044748 · `exam_storage` 20261114120000 · `exam_storage_usage` 20261114120000 · `exam_student_list` 20261114120000 · `exam_student_window` 20261114120000 · `exam_taker` 20261114120000 · `exam_upload` 20261114120000 · `exam_upload_visible` 20261114120000 · `exam_user_windows` 20261114120000 · `exam_window_freeze` 20261114120000 · `exam_windows` 20261114120000 · `exam_work` 20261114120000 · `finalize_assessment_grade` 20261012044748 ×2 · `finalize_assessment_grade_v17` ? · `finish_exam_attempt` 20261012044748 · `get_assessment_answer_keys` 20261001230606 · `get_assessment_results` 20261012044748 ×2 · `get_exam_attempt_content` 20261012044748 · `get_exam_definition` 20261012053751 · `get_exam_definition_v2` 20261012063114 · `get_exam_grade_changes` 20261012063114 · `get_exam_grading_detail` 20261012044748 · `get_exam_review` 20261012044748 · `get_exam_submission_page` 20261012063114 · `get_exam_summaries` 20261012044748 · `grade_assessment_response` 20261012044748 ×2 · `grade_assessment_response_v17` ? · `grade_exam_paper` 20261012063114 · `grade_on_submission` 20261012044748 ×2 · `immutable_grade_change` 20261012063114 · `lock_exam` 20261012044748 · `preserve_assessment_history` 20261001230358 · `reconcile_exam` 20261012044748 · `refresh_exam_grade` 20261012044748 · `release_exam_result` 20261012044748 · `release_exam_review` 20261012044748 · `require_completed_response_file` 20261010100544 · `save_assessment_response` 20261012044748 ×2 · `save_assessment_response_v17` ? · `save_exam_answers` 20261012063114 · `save_exam_definition` 20261012053751 · `save_exam_definition_v2` 20261012063114 · `save_exam_response` 20261012044748 · `set_assessment_answer_key` 20261010100547 ×2 · `start_assessment_attempt` 20261012044748 ×3 · `start_assessment_attempt_v17` ? · `submit_assessment_attempt` 20261012044748 ×3 · `submit_assessment_attempt_v17` ? · `sync_exam_participation` 20261012044748 · `valid_objective_key` 20261012044748 · `validate_exam_settings` 20261012044748

Public API wrappers: `clone_assessment`, `clone_exam_schedule`, `decide_exam_retry`, `exam_get`, `exam_lifecycle`, `exam_paper_mark`, `exam_paper_sheet`, `exam_portal`, `exam_queue`, `exam_release_many`, `exam_save`, `exam_set_window`, `exam_storage_usage`, `exam_student_list`, `exam_upload`, `exam_work`, `finalize_assessment_grade`, `get_assessment_answer_keys`, `get_assessment_results`, `get_exam_attempt_content`, `get_exam_definition`, `get_exam_definition_v2`, `get_exam_grade_changes`, `get_exam_grading_detail`, `get_exam_review`, `get_exam_submission_page`, `get_exam_summaries`, `grade_assessment_response`, `grade_exam_paper`, `release_exam_result`, `release_exam_review`, `save_assessment_response`, `save_exam_answers`, `save_exam_definition`, `save_exam_definition_v2`, `save_exam_response`, `set_assessment_answer_key`, `start_assessment_attempt`, `submit_assessment_attempt`, `sync_exam_participation`

### Part 7: Notifications, push, support, background jobs

**Tables (12).** `private.group_notification_state`, `private.notification_deliveries`, `private.notification_events`, `private.organization_support_staff`, `private.push_subscriptions`, `private.support_audit`, `private.support_operators`, `private.support_requests`, `notification_preferences` (S), `notifications` (S), `support_messages` (S), `support_tickets` (S)

**Functions (22: 19 private, 3 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`emit_class_started` 20261119120000 · `emit_group_joining_notice` 20261015185510 · `emit_notification` 20261015185510 · `emit_session_notice` 20261119120000 ×2 · `group_notice_hash` 20261015185510 · `group_notice_recipient` 20261015185510 · `group_notice_upcoming` 20261015185510 · `notification_business_event` 20261119120000 ×3 · `notification_command` 20261015185510 · `notification_current` 20261119120000 ×2 · `notification_link` 20261119120000 ×4 · `notification_visible` 20261015185510 · `notification_worker` 20261119120000 ×2 · `revoke_session_notices` 20261015185510 · `session_notice_hash` 20261015185510 · `support_access` 20261015185510 · `support_command` 20261015185510 · `support_contact_org` 20261015185510 · `support_staff_for` 20261015185510

Public API wrappers: `notification_command`, `notification_worker`, `support_command`

### Part 8: Reports and demo data

**Tables (4).** `private.demo_seed_rows`, `private.demo_spaces`, `private.expired_homework_uploads`, `private.expired_media_uploads`

**Functions (37: 28 private, 9 public).** Live definition in the migration named by its timestamp; `×n` = number of create statements across all migrations (the last wins).

`demo_clear_core` 20261114120000 ×6 · `demo_exam_correct` 20261115120000 · `demo_exam_make` 20261115120000 · `demo_exam_try` 20261115120000 · `demo_fill_core` 20261119120000 ×9 · `demo_homework_make` 20261109120000 · `demo_homework_try` 20261109120000 · `demo_track` 20261027120000 (invoker) · `platform_demo_clear` 20261027120000 · `platform_demo_fill` 20261027120000 · `platform_demo_status` 20261119120000 ×9 · `report_attention` 20261117120000 · `report_bounds` 20261118120000 ×2 · `report_caller` 20261117120000 · `report_course` 20261117120000 · `report_exams` 20261117120000 · `report_facts` 20261117120000 · `report_group` 20261117120000 · `report_groups` 20261117120000 · `report_homework` 20261117120000 · `report_pct` 20261117120000 (invoker) · `report_reason_count` 20261118120000 ×2 (invoker) · `report_reasons` 20261118120000 ×2 (invoker) · `report_sessions` 20261117120000 · `report_stats` 20261117120000 · `report_student` 20261117120000 · `space_has_real_students` 20261030120000 · `space_is_demo` 20261027120000

Public API wrappers: `platform_demo_clear`, `platform_demo_fill`, `platform_demo_status`, `report_attention`, `report_course`, `report_group`, `report_groups`, `report_student`, `space_is_demo`

### Part 9: server routes and services

92 route files under `app/**/api/**/route.ts` (teacher 32, courses 18, auth 6, admin 6, exams 4, platform-admin 3, learning 3, and 20 smaller families). 52 services in `server/services`, handlers in `server/http`, the Supabase client in `server/integrations/supabase.ts` (publishable key plus the caller's token), and the two service-role scripts `scripts/notification-dispatch.cjs` and `scripts/lms-storage-maintenance.cjs`.
