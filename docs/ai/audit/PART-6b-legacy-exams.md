# Part 6b: the legacy exam system (what still calls it, and how to remove it safely)

Audit only. Branch `claude/backend-audit`, started at `3b30779f8558eb381458b35715480f170e7763ef` (2026-11-17). No code, migration, test or
config was changed. No connected Supabase project, VPS or deploy was touched. Every proof ran on a local disposable PostgreSQL
(`timezone=UTC`, the repo's own migrations replayed), which was stopped and deleted at the end.

The owner decided (A0-13) to retire the legacy system. This part answers: what is it, who still calls it, what shared code must be
edited (not deleted), what is unsafe while it stays, and the order that removes it without breaking anything live.

Legacy system = `public.assessments`, `offering_assessments`, `assessment_questions`, `assessment_options`, `assessment_attempts`,
`assessment_responses`; `private.assessment_answer_keys`, `assessment_participations`, `assessment_question_outcomes`,
`private.exam_grade_changes`; 76 functions (public wrappers, `private.*` definers, the `*_v17` copies); the `lms-submissions` bucket; the
`/api/secure-exams/*` route and the pages behind it.

## Summary

- 9 findings: 0 High, 3 Medium, 3 Low, 3 Note.
- **Nothing live needs the legacy tables to work**, except two live student/teacher screens that still read them (A6b-02). Those must be edited
  first, or removal breaks the Exams pages and student Home.
- The new exams (`private.exams` family, 57 `exam_*` functions) do not call any legacy object. Proved by scanning the live body of every
  function in `public` and `private`.
- A removal migration written and applied to a clone of the local database dropped 10 tables and 76 functions with no `CASCADE`, and 35 of
  47 SQL suites still passed untouched. The other 12 failed only because they test or build legacy objects (listed in the plan).
- Until removal, one student can fill storage (A6b-01) and any signed-in person can burn database time (A6b-03). A stop-gap migration
  (step 1 below) closes both without waiting for the code work.

## Inventory

"Firebase mode" = the hosted/staging path (`isFirebaseStaging()` and `LMS_DATA_BACKEND==='supabase-staging'`). "Reachable" = a signed-in
person can trigger it today.

### Database

| Object | What it is | Who calls it today | Reachable in Firebase mode |
| --- | --- | --- | --- |
| 6 `public` tables above | legacy quiz/exam content, schedules, tries, answers | `/api/secure-exams`, `loadExamList`, `loadWebsiteScope`, `get_exam_summaries`; direct table access by any teacher or enrolled student | yes (direct grants) |
| `private.assessment_answer_keys`, `assessment_participations`, `assessment_question_outcomes`, `exam_grade_changes` | keys, per-student status, per-question outcome, grade-change history | legacy functions only; notification trigger on participations | only through the functions |
| 76 functions: 24 public RPCs executable by `authenticated` (clone_assessment, decide_exam_retry, finalize_assessment_grade, get_assessment_answer_keys, get_assessment_results, get_exam_attempt_content, get_exam_definition(_v2), get_exam_grade_changes, get_exam_grading_detail, get_exam_review, get_exam_submission_page, get_exam_summaries, grade_assessment_response, grade_exam_paper, release_exam_result, release_exam_review, save_assessment_response, save_exam_answers, save_exam_response, set_assessment_answer_key, start_assessment_attempt, submit_assessment_attempt, sync_exam_participation); `save_exam_definition(_v2)` and `clone_exam_schedule` are `service_role` only (closed to clients by 20261114120000_exams.sql:1444); the rest are private definers and the six `*_v17` copies | the route and the Exams page | yes for the 24 (no `anon`) |
| Triggers on legacy tables: touch_updated_at, check_integrity, prevent_reparenting, preserve_history, require_completed_file, grade_on_submission, validate_exam_settings, exam_integrity, immutable_grade_change, notification_exam | integrity and grading | fire on any write | yes |
| Policies on the six tables (select/insert/update/delete per table) and column grants (20261001230357_lms_authorization.sql:207-255) | per-row access | every query by a teacher or student | yes |
| Storage bucket `lms-submissions` (private, 20,971,520 bytes, jpeg/png/webp/pdf/text) and the `media_assets` branches for it | answer files | the route (`server/services/exam-runner.ts:94`) and direct upload by an enrolled student | yes (A6b-01) |

### Server, frontend, contracts

| Item | Caller | Reachable in Firebase mode |
| --- | --- | --- |
| `app/api/secure-exams/[examId]/[action]/route.ts` + `server/http/exam-runner.ts` (state, start, answers, submit, decision, result, photo, grading, grade, release, release-review, definition); services `exam-runner.ts`, `exam-grading.ts`, `exam-authoring.ts`, `exam-security.ts`; `server/repositories/exam-security.ts` | no screen passes `secure`; the route itself is callable | yes (A6b-06) |
| `server/repositories/exams.ts` legacy `list()`, `server/services/exams.ts` `loadExamList` | **live**: `app/(dashboard)/_components/website-exams.tsx` (`WebsiteExams`, `WebsiteExam`) | yes, on every Exams page load (A6b-02) |
| `server/services/exams.ts` `loadExam` | nothing | dead |
| `server/repositories/website.ts:54-55` (`scheduledAssessments`, `assessments`), `server/services/website.ts:49-80` (`loadWebsiteScope`), `server/http/learning-overview.ts` | **live**: student Home, Courses and learning overview; `contentLimited` depends on them | yes (A6b-02) |
| `app/(dashboard)/_components/website-pages.tsx` `Assessments` | **live**: student Home lists legacy upcoming exams, links `/exams/<legacy schedule id>` that the new exam page cannot open | yes (A6b-02) |
| `server/repositories/lms.ts`, `server/services/lms-staging.ts` | nothing imports them; `/lms-staging` is redirected | dead |
| `frontend/features/exams/{exam-result,exam-runner,exams-list,exams-retry,exams-view}.tsx` | only the non-Firebase (Clerk) branch of `exams/page.tsx` and `exams/[examId]/page.tsx` | no |
| `frontend/lib/api.ts:7` and `middleware.ts:73` allow-lists for `/api/secure-exams/...` | the route | yes |
| `shared/contracts/{exams,exam-security,exam-authoring,exam-listing,lms}.ts`, `shared/exams.ts` | legacy code only (`homework.test.cjs:9` also loads `exam-authoring.ts`) | n/a |
| About 58 locale keys (`exams.*`, `exam.*` in `en.ts`, `ar.ts`) used only by the legacy UI | legacy UI | n/a |
| `shared/contracts/database.types.ts` | generated; regenerate after the drop | n/a |
| New student routes `/api/exams*`, `shared/exams-student.ts`, `shared/contracts/exams-student.ts` | **new system, keep** | yes |

### Tests, scripts, seed, docs

| Item | Plan |
| --- | --- |
| SQL suites `exam-attempts-results.sql`, `exam-authoring.sql`, `exam-completion.sql` (legacy only) | delete |
| Scripts `exam-concurrency.cjs`, `exam-deadline.cjs`, `exam-runner.test.cjs`, `exam-security.test.cjs` | delete |
| `exams-foundation.test.cjs` | keep the page tests, drop the legacy ones |
| `exams.sql` section 11 (lines 538-543: legacy builder refused) | delete the section (proved: the other 183 checks pass) |
| `authorization.sql` (45 legacy lines), `hardening.sql` (60), `firebase-identity.sql`, `notifications-support.sql`, `student-administration.sql`, `teacher-websites.sql`, `demo-clear-robust.sql`, `demo-students.sql`, `lessons.sql:92`, `concurrency.md` | rewrite: remove the legacy checks |
| `scripts/teacher-foundation.test.cjs:36-46` (`legacyClosed` pins the two legacy SQL suites and the route edit against the base commit) | edit, or the unit tests fail after deleting the suites |
| `scripts/homework-rules-migration.test.cjs:63-64` (pins the `demo_clear_core` legacy check) | edit with the shared function |
| `scripts/exam-sql-local.cjs` lines 27, 34 (SUITES, RACE_SUITES) and lines 86, 91 (counts `public.assessment_attempts` as the rollback baseline) | edit: count `private.exam_attempts`. **Without this edit every suite fails** (proved) |
| `scripts/firebase-tenant-http.cjs:44` (table list includes `assessment_attempts`), `scripts/lms-load-test.cjs`, `continue-learning(.test\|-next).cjs`, `student-portal.test.cjs`, `student-academics.test.cjs`, `teacher-foundation.test.cjs`, `website-acceptance.cjs`, `appearance-browser.cjs`, `lms.test.cjs` | rewrite the legacy parts |
| `scripts/lms-storage-maintenance.cjs` runs an UPDATE on `assessment_responses` | edit (breaks after the drop) |
| `supabase/seed.sql:52-62` (legacy quiz `70000000-…01`, schedules `a0000000-…01/02`) used by many suites | remove; the new exams have their own fixtures |
| `package.json` `test:files` (69 entries; 4 legacy files) | remove the deleted files |
| Docs: 14 docs mention the legacy system (DECISIONS.md, TESTING.md, EXAMS_DB_AUDIT.md, database-architecture.md, milestone-6-checkpoint-6e.md, step03a-*, step04, step05, supabase-completion-report.md, plus audit docs) | update DECISIONS/TESTING; mark the older ones historical; do not rewrite history |

## Shared pieces: edit, do not delete

Live bodies were read from the local database after all migrations. Each is edited by `create or replace` in the removal migration.

| Object | What exactly to change |
| --- | --- |
| `private.check_lms_integrity` | remove the `offering_assessments` branch and the `assessment_responses` branch. Keep every other branch. Triggers `check_integrity` on `offering_assessments` and `assessment_responses` go with their tables |
| `private.can_upload_media`, `private.complete_media_upload` | remove the `lms-submissions` / `is_enrolled` branch; course media stays |
| `private.can_remove_lesson_upload`, `private.archive_unused_lesson_upload` | remove the `assessment_responses` "is referenced" check (it would fail to compile at run time once the table is gone) |
| `private.notification_business_event` | remove the `assessment_participations` branch (trigger `notification_exam` goes with the table) |
| `private.notification_link` | remove the legacy `exam_released` link line; the new-exam result branch must stay |
| `private.demo_clear_core(uuid,uuid)` | remove the `'exams'` blocker that reads `assessments`/`offering_assessments`; the new-exam deletes stay |
| view `private.expired_media_uploads` | drop the `assessment_responses` condition (same columns) |
| policy `media_assets_insert`; storage policies `lms_objects_insert`, `lms_objects_select` | limit to bucket `lms-course-media` (edit; do not drop). `lms_trusted_identity` and `lms_unused_course_object_*` need no change |
| `private.can_download_media`, `can_view_media` | an `offering_id` support branch exists; harmless after the drop, remove with the cleanup if the owner wants a tidy list |
| Reports, student exam list, notifications of new exams, `exam_*` | **no change**: none references a legacy object (scan of all public/private function bodies) |

Not in the shared list but linked: legacy tables reference `profiles`, `courses`, `course_offerings`, `media_assets` with RESTRICT foreign keys
(A6b-07).

## Findings (worst first)

### A6b-01 Medium, abuse: one student can store unlimited files in `lms-submissions`

**Where:** `20261001230357_lms_authorization.sql:259` (`media_assets_insert`), storage policies `lms_objects_insert/select`, `private.can_upload_media`
and `complete_media_upload` (the `lms-submissions` / `is_enrolled` branch).

**Scenario / proof:** one enrolled student inserted 45 `media_assets` rows (bucket `lms-submissions`, kind `submission`), uploaded 45 objects of
20 MB and completed them: 45 `ready`, 943,718,400 bytes, with no exam, no try and no schedule. `private.expired_media_uploads` listed 0
of them, so nothing cleans them up. It is the same class as A5-03 and A6a-04, and it is not tied to any exam: removing the exam code does
not close it, only the policy edit does.

**Fix:** stop-gap and removal both: limit `media_assets_insert` and the two storage policies to `lms-course-media` (see shared pieces). Any
existing `lms-submissions` object is counted by the owner's chat first (see "What the owner's chat must count").

### A6b-02 Medium, correctness and removal blocker: two live screens still read the legacy tables

**Where:** `server/services/exams.ts` `loadExamList`, used by `app/(dashboard)/_components/website-exams.tsx` (`WebsiteExams`, `WebsiteExam`);
`server/repositories/website.ts:54-55`, `server/services/website.ts:49-80` (`loadWebsiteScope`); `app/(dashboard)/_components/website-pages.tsx`
(`Assessments`).

**Scenario:** every Exams page load runs the legacy list (`offering_assessments`, `assessments`, `assessment_questions`, `get_exam_summaries`).
Every student Home, Courses and learning-overview call reads `offering_assessments` and `assessments` too, and `contentLimited` depends on the
answer. Proof on the local database: for a student the new `exam_student_list` returned 0 rows while the legacy read still returned 1 row, and
the new `exam_get` refused the legacy schedule id with `42501 Exam unavailable`, so the Home link `/exams/<legacy schedule id>` leads to an
error. If the database is changed first, these calls throw. In `WebsiteExams`, a thrown legacy read makes `staff=false`, so a **teacher would be
shown the student view**. Before then the cost is wasted reads on the two busiest student pages.

**Fix:** code first. Replace `loadExamList` by a plain "is this person staff here" check; drop the two reads from `loadWebsiteScope` and the
website repository (and the dependent `contentLimited` rule); delete the `Assessments` section on Home (the new exam list is the only list).
Recommended: do this in the first code change, before any database drop.

### A6b-03 Medium, performance: the legacy tables are expensive to read, and any teacher can add rows by direct writes

**Where:** policies on `assessments`, `assessment_questions`, `assessment_options`, `offering_assessments` (per-row helpers such as
`private.can_view_assessment`).

**Proof:** with 501 legacy exams, 5,001 questions, 20,002 options and 1,002 schedules, `select count(*)` took, for a student, 2.1 s (exams),
20.1 s (questions), 39.0 s (options), 4.4 s (schedules). A student of **another** space who can see zero rows took 3.1 / 32.6 / 31.6 / 2.4 s
(the policy runs per row even when nothing is visible). A course assistant took 0.7 / 5.9 / 11.7 / 3.7 s; an owner 0.3 / 2.8 / 5.3 / 1.9 s.
`authenticated` holds table grants (select, insert, delete and column updates, including `is_correct` update on options), so any teacher can add
rows with plain inserts, and any signed-in person can run these reads. The hosted 8 s limit cancels the statement but only after it has used a
core. Same class as A0-03 and A5/A6a "my scope" findings.

**Fix:** stop-gap: revoke all table grants on the six legacy tables and EXECUTE on the 24 legacy RPCs (the route is closed by A6b-06 in the
same step). Final fix: drop them.

### A6b-04 Low, access: the "closed" legacy builder can be used through direct table writes

**Where:** same grants as A6b-03; the closure in `20261114120000_exams.sql:1444` revokes only `save_exam_definition(_v2)` and
`clone_exam_schedule`.

**Proof:** owner A inserted an assessment, questions, options and a published schedule with direct inserts; an enrolled student then started,
saved and submitted through the public legacy RPCs; the all-objective result auto-released. The student could not read `is_correct` or the
answer keys. Cross-tenant checks held: an owner and a student of another space, and a student of another run, were refused on start,
definition, clone, keys and set-key; direct inserts across spaces were refused by a validation trigger. A course-editor assistant can clone and
read/set keys in their own course (by design, course edit rights).

**Fix:** same stop-gap as A6b-03 (revoke the table writes and the 24 RPCs). This is why the owner's decision "legacy builder closed" is not
yet true in the database.

### A6b-05 Low, access: enrolled students can read legacy questions before they start a try

**Where:** `assessment_questions` select policy (`can_view_assessment` once `opens_at` has passed).

**Scenario:** an enrolled student reads the prompts directly at the opening time, without starting, so the time limit does not apply to
reading. Legacy by design; answer keys stay hidden. Closed by the same stop-gap.

### A6b-06 Low, surface: `/api/secure-exams/*` is a reachable API with 12 actions and no screen

**Where:** `app/api/secure-exams/[examId]/[action]/route.ts` → `server/http/exam-runner.ts`; allow-lists `frontend/lib/api.ts:7`,
`middleware.ts:73`.

**Scenario:** gated by `isFirebaseStaging()` and `supabase-staging`, origin-checked; no UI passes `secure`. Any signed-in person can still call
state, start, answers, submit, grading, release and definition. Each action is authorised in the database, so this is attack surface, not a
hole. **Fix:** delete the route and both allow-list entries in the removal step (step 2), or answer 410 first if removal waits.

### A6b-07 Note, deletion: legacy rows would block deleting a person, a course, a run or a file

All legacy tables reference `profiles`, `courses`, `course_offerings` and `media_assets` with RESTRICT. If dev or production holds any legacy
row, deleting that profile, course, run or media asset fails with a foreign-key error (and the demo cleaner reports an "exams" blocker). Today
dev has none (EXAMS_DB_AUDIT, section d: 0 rows on 2026-11-13; the owner's chat re-counts, below). Removal also removes this risk.

### A6b-08 Note, record: Part 6a listed `exam_grade_changes` and `immutable_grade_change` as new-exam objects

Both are legacy (created in `20261012063114_complete_exam_workflows.sql`) and belong to this removal. The new exams keep their history in
`private.exam_audit`. No change to the new system.

### A6b-09 Note, cleanup: dead code and tests that pin the legacy system

`server/repositories/lms.ts`, `server/services/lms-staging.ts`, `loadExam`, the legacy `exams/*` frontend (Clerk branch only), `shared/exams.ts`
and four legacy contracts, 58 locale keys, `scripts/lms-storage-maintenance.cjs` (UPDATE on `assessment_responses`, breaks after the drop),
`scripts/exam-sql-local.cjs:86,91` (rollback baseline reads `public.assessment_attempts`, so every suite fails after the drop),
`teacher-foundation.test.cjs` and `homework-rules-migration.test.cjs` pins, and `supabase/seed.sql:52-62`. All listed in the inventory. Missing
any one of them makes the SQL runner or `npm test` fail, not production.

## Removal plan (order matters)

**Step 0, count first (owner's chat, read-only).** See "What the owner's chat must count". If every count is 0, removal is a plain drop. If
not, decide what history to keep before step 3.

**Step 1, stop-gap migration (can ship alone, closes A6b-01, 03, 04, 05).** One new migration: revoke all privileges on the six legacy tables
and EXECUTE on the 24 legacy RPCs from `authenticated`/`service_role`; limit `media_assets_insert` and the storage policies to
`lms-course-media`. Nothing live calls these paths (the two live reads in A6b-02 are the exception: they read `offering_assessments` and
`assessments` as the caller, so do step 2a first or catch their error). Recommended: ship step 2a and step 1 together.

**Step 2, code first.**
- 2a: A6b-02: replace `loadExamList` with a staff check; drop the two reads and `contentLimited` dependence from `loadWebsiteScope`; delete
  the Home `Assessments` section.
- 2b: delete `/api/secure-exams`, `server/http/exam-runner.ts`, the legacy services/repositories, the legacy `frontend/features/exams/*`, the
  two allow-list entries, the Clerk branch of the two Exams pages, the legacy contracts, `shared/exams.ts`, the locale keys.
- Check: `tsc`, `npm test`, and a grep for `assessment_`, `offering_assessments`, `secure-exams`, `lms-submissions` leaves only history docs
  and old migrations.

**Step 3, database migration (new file, dated after `20261119120000_live_class.sql`, one new line in `scripts/migrations.sha256`).** Order
inside it: (a) `create or replace` the shared pieces from the table above, (b) the policy edits, (c) drop the 10 tables children first, with
no `CASCADE` so a hidden dependent fails loudly, (d) drop the 76 functions (public wrappers first), (e) leave the empty `lms-submissions`
bucket or delete it after the count says 0 objects. Old migrations stay untouched (immutable history). If the count in step 0 is not zero,
copy `private.exam_grade_changes` and legacy results to an archive table first (a product question, below).

**Step 4, tests, seed, docs.** Delete or rewrite the files in the inventory; remove the legacy quiz from `seed.sql`; regenerate
`shared/contracts/database.types.ts`; update DECISIONS.md and TESTING.md; mark the older step docs historical.

**Step 5, proof that nothing live broke** (affected suites only while working; one full run at the end):
`exams`, `exams-demo`, `exams-student`, `reports`, `reports-demo`, `homework`, `notifications-support`, `group-notifications`, `lessons`,
`lesson-covers`, `demo-*`, `authorization`, `hardening`, `firebase-identity`, then the full SQL run once, then `npm test` and typecheck.

### Proof the plan works (local, thrown away)

I replayed all migrations, cloned the database, and applied a draft of step 3 (the shared-function edits, the three policy edits, 10 table
drops, 76 function drops, no `CASCADE`). It applied cleanly in one transaction (100 statements). Afterwards no view, check constraint, public or
private function referenced a legacy name (0 tables, 0 functions left) and the 57 new `exam_*` functions were intact. I then added the draft
as a migration in a **copy** of the repo scripts (not in the repo) and ran 47 SQL suites (without `listing-performance`):

- 35 passed untouched, including `reports`, `reports-demo`, `homework*`, `groups-attendance`, `live-class`, `lessons`, `notifications` (group),
  `demo-notifications`, `account-profiles`, `settings`.
- Every suite first failed on `exam-sql-local.cjs:86,91` (counts `public.assessment_attempts`); after switching it to `private.exam_attempts`,
  12 suites still failed, all because they test or build legacy objects: `hardening`, `firebase-identity`, `authorization`,
  `exam-attempts-results`, `exam-completion`, `exam-authoring`, `notifications-support`, `student-administration`, `teacher-websites`,
  `demo-clear-robust`, `demo-students` (these two via the `seed.sql` legacy quiz), and `exams` (section 11). After deleting `exams` section 11
  the suite passed (183 checks), and so did `exams-demo`, `exams-student` and the exam race script.

That is the exact list of tests the plan must edit.

## What the owner's chat must count on dev before removal (read-only)

1. Rows in each of the 9 legacy tables: `assessments`, `offering_assessments`, `assessment_questions`, `assessment_options`,
   `assessment_attempts`, `assessment_responses`, `private.assessment_answer_keys`, `private.assessment_participations`,
   `private.assessment_question_outcomes`, and `private.exam_grade_changes`.
2. `media_assets` rows with `bucket='lms-submissions'` (count, total size, status), and objects in the `lms-submissions` storage bucket.
3. `notification_events` of type `exam_released` whose resource is a legacy schedule id (the demo had 2 on 2026-11-13).
4. Any `assessments` of type assignment or practice (the old homework path), and any schedule that is published and not yet closed.
5. Whether `get_exam_summaries` or any legacy RPC shows up in the hosted logs in the last 30 days (proves nothing live calls it).

On 2026-11-13 these were all 0 (EXAMS_DB_AUDIT, section d), with 2 demo `exam_released` notices. The seed's legacy quiz exists only in local
tests; the demo seed never creates legacy rows.

## Dev counts (2026-11-17, owner's chat, read-only)

The counts asked for in the section above, answered from the hosted dev project by the owner's chat (not by this audit):

- All 9 legacy tables and `private.exam_grade_changes`: **0 rows**.
- `media_assets` with `bucket='lms-submissions'`: **0**. Objects in `storage.objects` for `lms-submissions`: **0**.
- `notification_events` of type `exam_released`: **42** = 40 tied to new `private.exam_results`, **0** tied to legacy `offering_assessments`,
  **2** demo-seeded notices whose resource matches nothing (their links are dead; noted for Part 8).
- Legacy assignment/practice items and open legacy schedules: **0** (the tables are empty).
- Hosted edge logs, last 24 h: no `/rest/v1/rpc` calls of any kind, so the logs prove nothing here. The code search and a drop without
  `CASCADE` are the proof.

So step 0 is done: every count is 0 and the removal is a plain drop; no history needs archiving.

**Decided removal order (owner, 2026-11-17):** (1) stop-gap migration (revoke grants and RPCs on legacy objects, limit the media policies to
`lms-course-media`), shipped inside the direct-access revoke group; (2) code first: A6b-02, then delete the legacy route and modules;
(3) database drop migration, no `CASCADE`; (4) tests, seed, docs (`exam-sql-local.cjs` lines 86 and 91 must count `private.exam_attempts`);
(5) checks.

## Checked and fine

- No new-exam function, report, notification or demo function (other than the shared pieces above) references a legacy object.
- Tenant isolation of the legacy RPCs: an owner and a student of another space, and a student of another run, are refused on every action I
  tried; direct inserts across spaces are refused by a trigger.
- `anon` has no access to any legacy table or function.
- Students cannot read `is_correct` or answer keys, directly or through the RPCs.
- `save_exam_definition(_v2)` and `clone_exam_schedule` are closed to clients (20261114120000_exams.sql:1444); `exams.sql` section 11 proves it.
- The new `/api/exams*` routes and `shared/exams-student.ts` do not import any legacy module.
- A migration that drops the tables without `CASCADE` fails if anything hidden depends on them; mine did not.

## Could not verify

- Hosted data on dev and production (only the local database and the 2026-11-13 audit): the owner's chat counts it.
- Whether any hosted caller outside this repo (a script, a dashboard) uses the legacy RPCs: the hosted logs are the only proof.
- Browser behaviour of the Exams pages after A6b-02 (no browser run; read from the code and the database reads).
- The old Clerk branch was not run; it is not reachable in Firebase mode.

## How the proofs ran

Local embedded PostgreSQL, `timezone=UTC`, port 55432, all repo migrations replayed, throwaway databases `leg6b` and `leg6b_after`. JWT claims
set per role as the test harness does. Client-side ids were used for direct inserts (the select policy cannot see a same-statement row).
The large-data run (501 exams) and the 45-upload run were rolled back. The server and all databases were stopped and deleted at the end.
