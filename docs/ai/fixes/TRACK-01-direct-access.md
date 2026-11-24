# Fix track 1: direct table access closed

Branch `claude/fix-01-direct-access` (from `claude/backend-audit`). Status: **done in the branch (code commit `8c39c83`), awaiting the dev check.** Nothing was applied to
any hosted project, merged or deployed. The migration is applied by the owner's chat to dev after review.

Migration: `supabase/migrations/20261124120000_close_direct_table_access.sql`
SHA-256: `c5c70b6cc0c1ffd887d7014e5b4cfb5bfe3f84fac315600a474e130788acc6a7` (one new line in `scripts/migrations.sha256`, `-text` in `.gitattributes`).

## The rule this track makes true

The browser role (`authenticated`) may only READ tables the app reads, and WRITES nothing directly. Every write goes through a private
security-definer function (`search_path=''`, caller from `private.current_app_user_id()`) behind a public security-invoker wrapper, with EXECUTE
for `authenticated` only. The restrictive `trusted_identity` policies and every read policy stay. A9-11 is the guard that keeps the rule true in code.

## What changed

| Finding | What was done |
| --- | --- |
| A0-02 (High) | The course save is `public.course_update(course, revision, fields)`. INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revoked from `anon` and `authenticated` on `courses`, `course_modules`, `course_staff`, `lessons`, `lesson_blocks`, `lesson_progress`, `media_assets`. 28 write-only policies dropped. |
| A2a-05 | Inside `course_update`: a status change (publish, unpublish, archive) needs the course owner or instructor, or the space owner or admin. Leaving `archived` needs the space owner or admin. An editor can still edit the text fields. |
| A2a-02, A2a-04 | The `lesson_blocks` trigger now requires the asset to be `ready` and, for a signed-in caller, in the course's upload scope or viewable by the caller. A trusted path with no caller keeps working. Direct block writes are closed anyway. |
| A2a-03 | Direct `lesson_progress` writes closed (progress already has its own function). |
| A1-02 | **Revoke only.** Writes on `organization_memberships` and `organizations` closed. The staff add/remove function is NOT built (it waits for the staff screen). Renaming a space still works through `rename_my_teaching_space` and the platform admin. |
| A1-04 | `profiles` writes closed. A trigger refuses (23514) a display name that is empty, over 128 characters, or holds control or bidirectional characters, and cleans new profile names. `account_profile` goes through it; the shared `plainName` rule rejects the same characters. |
| A3-01, A0-10 | Writes on `enrollments`, `course_offerings`, `offering_staff` closed. |
| A3-06 | `public.course_run(course)`: returns the current active run, or creates one under a `FOR NO KEY UPDATE` course lock. Six parallel calls make one run. Create a Group uses it. |
| A4-02, A5-01 | `SELECT` revoked from `anon` and `authenticated` on the 11 unused group and homework tables (`study_groups`, `group_staff`, `group_memberships`, `group_schedules`, `group_sessions`, `session_attendance`, `homework_questions`, `homework_options`, `homework_submissions`, `homework_responses`, `homework_submission_files`); their read policies dropped. No app code reads them (they are read through functions). |
| A6a-14 (media_assets part), A6b-01 | `media_assets` INSERT revoked. The `lms-submissions` bucket takes no uploads. `storage.objects` insert/select policies are restricted to `lms-course-media`. |
| A6b-03, A6b-04, A6b-05, A6b-02 (code), A6b-06 | Legacy exams locked down, **not deleted**: the 6 legacy tables are revoked from `anon`, `authenticated` and `service_role`; the 24 legacy RPCs from `public`, `anon`, `authenticated` and `service_role`. Code: the exam list gate is a plain staff check (`loadExamAccess`, reads no exam table); the Home Assessments section and the `scheduled`/`assessments` reads are gone; `contentLimited` no longer depends on them; a teacher is never shown the student view (a failed check shows an error). `/api/secure-exams/*` answers 410 and is out of both allow-lists (middleware and `frontend/lib/api.ts`). |
| A9-11 | `scripts/direct-access.test.cjs`: no file under `server/`, `app/`, `shared/` or `frontend/` may call `.from('<table>')` with `.insert/.update/.upsert/.delete`. The allow-list is EMPTY. It found three offenders, all fixed. |

### Not closed, and why

- **A1-02** staff add/remove function: parked by the owner until the staff screen exists. Only the revoke is done.
- **Legacy code deletion** (`server/http/exam-runner.ts`, `server/services/exam-*.ts`, `server/repositories/exam-security.ts`, the legacy repository code and the two race scripts `exam-concurrency` and `exam-deadline`): Track 10. The code is unreachable (route 410, functions refused). The two legacy race scripts are removed from the runner, not deleted.
- No database object was dropped except policies; no `CASCADE`.

## Grants before and after (table level, `authenticated`; `anon` and `service_role` had none on these)

D = delete, I = insert, S = select. 28 of 50 tables changed, 22 did not.

| table | before | after | policies before → after |
| --- | --- | --- | --- |
| assessment_options | DI | - | 5 → 5 |
| assessment_questions | DIS | - | 5 → 5 |
| assessments | DIS | - | 5 → 5 |
| offering_assessments | IS | - | 4 → 4 |
| course_modules | S | S | 5 → 2 |
| course_offerings | IS | S | 4 → 2 |
| course_staff | DIS | S | 5 → 2 |
| courses | DIS | S | 5 → 2 |
| enrollments | IS | S | 4 → 2 |
| lesson_blocks | DIS | S | 5 → 2 |
| lesson_progress | IS | S | 4 → 2 |
| lessons | IS | S | 5 → 2 |
| media_assets | S | S | 3 → 2 |
| offering_staff | DIS | S | 5 → 2 |
| organization_memberships | DIS | S | 5 → 2 |
| organizations | S | S | 3 → 2 |
| profiles | S | S | 3 → 2 |
| study_groups, group_staff, group_memberships, group_schedules, group_sessions, session_attendance, homework_questions, homework_options, homework_submissions, homework_responses, homework_submission_files | S | - | 1 → 0 each |

Column-level grants (a table-level revoke also removes them). Columns `authenticated` could write, before → after 0:
courses INSERT 11 / UPDATE 5; course_modules UPDATE 3; course_staff INSERT 6 / UPDATE 1; lessons INSERT 10 / UPDATE 4; lesson_blocks INSERT 8 / UPDATE 4;
lesson_progress INSERT 11 / UPDATE 5; media_assets INSERT 9; organization_memberships INSERT 8 / UPDATE 3; organizations UPDATE 2; profiles UPDATE 3;
enrollments INSERT 11 / UPDATE 5; course_offerings INSERT 13 / UPDATE 9; offering_staff INSERT 6 / UPDATE 1; plus the legacy tables.

## Safety checks before the revokes

Run against the catalog of the database before the migration. Result of each:

1. RLS policies of other tables that name a revoked read table: **0**.
2. RLS policies that call a non-definer function reading one: **0**.
3. Views naming one: **1**, `private.expired_media_uploads` (a `security_invoker` view reading `assessment_responses`). Fixed: it now calls the definer helper `private.assessment_response_uses_media()`; `scripts/lms-storage-maintenance.cjs` uses the same helper. The clean-up view is tested after the migration.
4. Non-definer functions (public/private) reading a revoked read table: **0**.
5. Non-definer functions writing a revoked write table: **0**.
6. Non-definer trigger functions touching a closed table: **0**.
7. Storage policies naming a closed table: **0**; the 8 helper functions the storage policies call are all definers, so the revokes do not reach them.
8. Foreign keys into the read-closed tables: 25, all from `private.*` tables. Referential checks run as the table owner, so they are unaffected.
9. Realtime publications including a closed table: **0**. No code subscribes to a channel.
10. Code that reads the 11 select-revoked tables: **none** (searched `app`, `server`, `shared`, `frontend`, `scripts`).
11. Code that calls the 24 legacy RPCs: only the legacy services and repositories, now unreachable. `registerMedia` and `updateProgress` were removed from the `lms` repository.

## Every upload path, and the proof it still works

| Path | How | Proof |
| --- | --- | --- |
| Lesson media, covers, thumbnails | `register_lesson_upload` → storage insert (`lms_objects_insert`, `lms-course-media`) → `complete_media_upload` | `lessons`, `lesson-covers`, `direct-access-closed` |
| Homework photos | `homework_upload` RPC + `homework_objects_insert` (`lms-homework`) | `homework*` suites |
| Exam photos (new exams) | `exam_objects_insert` (`lms-exams`) | `exams`, `exams-student` |
| Avatars | `account_profile` begin/commit + `avatar_attested_insert` (`lms-avatars`) | `account-profiles` |
| Website images | no upload code or storage policy exists | none needed |
| Legacy `lms-submissions` | closed | `direct-access-closed`, `authorization` |

## Proofs

- New suite `supabase/tests/direct-access-closed.sql`: **149 checks**: grants matrix, definer/invoker flags, editor/owner/student direct writes refused (42501), `course_update` role matrix (editor, instructor, course owner, space owner/admin, student, other space), text rules, PT409 stale revision, 23505 duplicate slug, block-media trigger, name checks (1,000,000-character and RTL names refused), enrollment/run/staff writes refused, `course_run`, upload paths, 11 tables unreadable (also for `anon`), legacy tables and RPCs refused.
- New race `scripts/course-run-concurrency.cjs`: a second call truly blocks and then returns the same run; six parallel calls make one run; a direct insert is refused.
- The migration applies on a full replay of the 52 existing migrations, and on top of them with a demo fill present (`demo_fill_core`: 5 exams, 2 groups, 2 courses, 6 lessons, 5 homework, 10 sessions, 28 students). Row counts before and after are identical (courses 4, enrollments 31, runs 4, profiles 37, groups 2, blocks 1, media 0, submissions 72). It applies twice without error, and demo clear still works.
- Suites rewritten to assert the refusal instead of using the closed access: `teacher-editor`, `organization-provisioning`, `authorization`, `hardening`, `exam-attempts-results`, `exam-authoring`, `exam-completion`, `notifications-support`, `reports-scale`; adapted: `student-administration`, `group-course-run`, `groups-attendance`, `homework*`, `group-notifications`, `group-presentation-summary`, `live-class`, `reports-demo`, `lesson-publish`, `course-content-tree`.
- `scripts/teacher-foundation.test.cjs`: baseline files changed by this track are pinned by the SHA-256 of their new content (the `track01` table). Files that earlier tracks pinned by substitution pairs are pinned here instead.
- Full SQL run, once at the end: 48 suites and 20 race/screen scripts. All pass except `reports`, which also fails on the database before the migration (`last month exams: the paper of day 10`, a date-dependent check in a file this track did not touch).

## What the owner's chat must check on dev after applying

1. A teacher saves a course (title, publish, unpublish) from the course page; an editor cannot publish.
2. Create a Group on a course with and without a run.
3. Lesson upload (image, PDF, video) and the cover still work end to end.
4. Student: lesson progress, homework photo, new exam photo, avatar upload.
5. Home, Exams list and Exam pages for a teacher and a student; `/api/secure-exams/anything` answers 410.
6. Nobody relies on a removed direct write: staff add/remove has no function yet (A1-02).
7. The grant listing per table matches the table above.
