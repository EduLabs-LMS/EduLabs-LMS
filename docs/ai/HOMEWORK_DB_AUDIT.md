# Homework database audit (branch `claude/homework-db`, base `e3932f2`)

This audit was done before the draft migration `supabase/migrations/20261109120000_homework_teacher_rules.sql` was written.
It lists what the homework backend is today, what the owner's spec changes, who calls each changed behaviour, and the conflicts.
None of the conflicts needed the owner before writing SQL. Each one has a safe reading, recorded under "Decisions" in
`DECISIONS.md` and in the report. The migration is a **draft**: it is not applied anywhere.

## 1. What exists today

Everything comes from one applied migration, `20261013184915_complete_homework_workflows.sql`. No later migration redefines a
homework function. Later migrations only read homework:
- the notification trigger (`20261015185510`, `20261018100132`): `homework_released` when a correction gets `released_at`;
- the student counts (`20261016053117`, `20261105120000`, `20261106120000`): pending homework, assignments not handed in;
- the course content tree (`20261106130000`): homework counts and delete blockers per lesson;
- demo Clear (`20261104120000`): refuses any homework.

### Tables

| Table | API grant | RLS | Notes |
| --- | --- | --- | --- |
| `public.homework_assignments` | select | `homework_visible(id)` | `lesson_id NOT NULL`, `mode` FILE_UPLOAD / PLATFORM_QUESTIONS, `status` draft / published, `family_id` + `version` + `supersedes_id` (versions), `revision` (stale check) |
| `public.homework_questions` | select | `homework_visible(assignment_id)` | single_choice / multiple_choice / essay, `response_mode` text / photo / both, `image_id` |
| `public.homework_options` | select | through questions | positions 0–7, cascade with question |
| `public.homework_submissions` | select | `homework_submission_visible(id)` | `number` (1, 2, …), draft / submitted, one draft per student (partial unique index), `revision` |
| `public.homework_responses` | select | same | `{optionIds, text}` per question |
| `public.homework_submission_files` | select | same | a submission's upload per question (or per submission for FILE_UPLOAD) |
| `private.homework_uploads` | none | on, no policy | purpose reference / question / solution / submission, status pending / ready / archived, `size_bytes`, `path = assignment/upload/resource.ext` |
| `private.homework_clone_sources` | none | on | media copied for a cloned version |
| `private.homework_keys` | none | on | correct option ids, model answer |
| `private.homework_solutions` | none | on | solution text, video URL, video upload |
| `private.homework_materials` | none | on | reference and solution files |
| `private.homework_corrections` | none | on | one per submitted try: status, score, feedback, `revision`, release |
| `private.homework_marks` | none | on | points per question per try (null = waiting) |
| `private.homework_annotations` | none | on | positioned notes on a file |
| `private.homework_audit` | none | on | every definition save, submit, grade, release, annotate, clone |

### Functions (all `SECURITY DEFINER`, `search_path=''`, caller from `private.current_app_user_id()`)

- Helpers granted to `authenticated` (they are used in policies): `homework_staff(id, capability)`, `homework_enrolled`,
  `homework_visible`, `homework_submission_visible`, `homework_unlocked`, `homework_upload_visible`, `homework_storage`.
- Internal, revoked from everyone: `homework_upload_referenced`, `homework_integrity` (trigger), `homework_asset`,
  `homework_submission_json`.
- API (private definer + public invoker wrapper, revoked from public/anon): `save_homework`, `homework_work`
  (start / save / submit / grade / release / annotate), `get_homework`, `homework_inbox`, `homework_lifecycle`
  (publish / unpublish / clone), `homework_upload` (intent / clone-tasks / get / pending / archive / complete),
  `homework_history`, `homework_revisions`.
- View `private.expired_homework_uploads` (no grant; nothing in the app reads it).

Capabilities in `homework_staff`: `author` = `can_edit_course`; `grade` = `can_support_offering`; `release` =
`can_manage_offering`; default (view) = edit or support.

### Storage

Bucket `lms-homework` (private, 50 MB, PDF/PNG/JPEG/WebP/MP4). Three policies on `storage.objects` call
`private.homework_storage(bucket, name, action)`:
- insert: a pending upload of the caller (a draft of their own for a submission, `author` otherwise);
- read: a ready upload that `homework_upload_visible` allows (solutions through `homework_unlocked`), or the caller's own
  pending / archived upload;
- delete: the caller's own archived upload that nothing references.

SQL never deletes a storage object. The server removes objects through the Storage API (`cleanup` after `archive`).

### Callers

- `server/http/homework.ts` + `server/services/homework.ts`: strict zod (`homeworkDefinition` is `.strict()`; the work
  actions enum is start / save / submit / grade / release / annotate). `homeworkChecked` turns every database error into a
  generic message by SQLSTATE and drops the database message.
- `frontend/features/courses/lesson/homework-student.tsx` (the student V2 screen, kept): calls `start` when there is no
  submission, or from "prepare requested revision" when the latest correction is `resubmit_required`.
- The old teacher screens were removed (see `RETIRED_TEACHER_UI.json`). No teacher UI calls homework today.

### Tests

`supabase/tests/homework.sql` (legacy UUID-subject claims), `scripts/homework-concurrency.cjs` (14 races),
`notifications-support.sql` and `student-administration.sql` (create homework through `save_homework`), and suites that insert
homework rows directly (`course-content-tree`, `group-presentation-summary`, `group-summary-performance*`, `listing-performance*`).

## 2. What the spec changes, and who is affected

| Spec | Today | Change | Affected callers |
| --- | --- | --- | --- |
| 1. Questions only | new homework defaults to FILE_UPLOAD | new homework is created `workflow='questions'`, `PLATFORM_QUESTIONS`; FILE_UPLOAD refused for it | `save_homework(null, …)` callers: the legacy route and three SQL suites |
| 1. One photo, 5 MB | up to 4 files per essay; image cap 5 MB at `complete` (23514) | 1 photo per essay for new homework, images only, PT413 when larger | `homework_work save`, `homework_upload intent/complete` |
| 1. Photos switch | none | `photos_allowed`; off ⇒ every essay text only, photo intents refused | `save_homework`, `homework_upload` |
| 2. Deadline | none | `deadline_at`, `late_allowed`, `missed_deadline` | `start`, `save`, `submit`, upload intent |
| 3. Tries | a new try only after a released `resubmit_required` | `tries_mode`, `max_tries`, new action `retry`; the old path is refused for new homework, kept for legacy | `homework_work`, student UI (has no retry button yet) |
| 4. Solutions | open after the student's own hand-in | per-homework mode, deadline rules | `homework_unlocked` → `get_homework`, `homework_upload get`, storage read |
| 5. Assistant rights | assistants grade; only managers release | per assistant per course `can_correct`, `can_release`, default on | `homework_staff`, `homework_work`, `get_homework` (`canGrade`, `canRelease`) |
| 6. No image edits | annotate exists | refused for new homework; tables stay | `homework_work annotate` |
| 7. Delete images | none | new `homework_delete_images`, upload status `deleted` | new; storage delete policy |
| 8. Freeze-and-clone | exists | unchanged; clone copies the rules | `homework_lifecycle clone` |
| 9. Whole course | `lesson_id NOT NULL` | unchanged | — |
| 10. Teacher reads | `homework_inbox` per offering | new `homework_portal`, `homework_queue`, `homework_storage_usage` | new |
| 11. Demo v5 | Clear refuses any homework | homework module, Clear removes demo homework | demo fill/clear/status, contract constant, demo suites |

## 3. Conflicts and how each is resolved

1. **Existing rows.** Every existing assignment becomes `workflow='legacy'` (the column default). Legacy rows keep exactly
   today's behaviour: no deadline, no tries limit, the teacher-request path, solutions after the student's own hand-in, up to
   4 files per essay, annotations. Nothing is back-filled and no row is rewritten. This is the safe migration: a deadline
   invented for old homework would lock students out, and a changed solutions rule would expose or hide answers students
   already had.
2. **`save_homework(null, …)` now creates questions-only homework.** Three existing SQL suites and the concurrency script
   create FILE_UPLOAD or undated homework that way. Their fixtures change (a legacy row inserted by the database owner, then
   saved through the same function; or a `rules` object with a deadline). Every changed line is listed in the report and
   pinned in `scripts/teacher-foundation.test.cjs`.
3. **The legacy API route cannot send `rules`.** `homeworkDefinition` is strict, so the existing route can create a draft
   (with default rules and no deadline) but cannot publish new homework. That is accepted: the old teacher screens are
   removed, and the new teacher API is a later track.
4. **Assistants release by default.** `homework.sql` line 47 asserted that a grading assistant cannot release. The spec
   changes that (release is on by default). The assertion now turns the assistant's release right off first.
5. **The student UI's error text.** `homeworkChecked` turns PT409 into "Homework changed. Reload before saving." and drops
   the database message. The database now raises stable messages (`Deadline passed`, `No tries left`) with a JSON detail
   `{"reason":"deadline_passed"|"no_tries_left"}`. Showing them needs a two-line server change in a baseline file that
   `teacher-foundation.test.cjs` protects; it is **not** done in this database-only track (question for the owner).
6. **Demo Clear refused any homework.** It now removes homework in the demo courses, and still refuses when a submission
   belongs to someone who is not a demo student ("homework from real people") or a stored object exists under a demo
   homework ("homework files", because SQL never deletes storage objects).
7. **`course-content-migration.test.cjs` and `listing-performance.test.cjs`** assert that their migration is the newest (or
   second newest). They are relaxed to "comes before the homework migration". `teacher-foundation.test.cjs` lists the
   non-baseline migrations exactly; the new one is appended.

## 4. Things checked and left unchanged

- `homework_inbox`, `homework_history`, `homework_revisions`: unchanged.
- The `homework_released` notification trigger: unchanged; a release by an assistant fires it the same way.
- The student counts in the student Home: unchanged (they count published homework not handed in; a late-allowed or closed
  homework still counts as not handed in until handed in, as before).
- Exams: no exam table or function is touched. `homework_delete_images` takes a homework id only; an exam id is "unavailable".
