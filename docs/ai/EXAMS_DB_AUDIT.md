# Exams database audit and plan (branch `claude/exams-db`, base `4404a68`)

Step 1 of the exams track: **audit and plan only.** No SQL was written, nothing was applied, no screen or route changed. The owner's
rules are in the task and the boards are in `docs/design/exams/` (committed as `803711b`, "docs: exam boards"). The homework audit
(`HOMEWORK_DB_AUDIT.md`) is the model for this one.

Read-only checks on the dev database (`gmvouqgjbtbkbhrdruzu`, 2026-11-13) are quoted where they matter. Nothing was written there.

---

## a. What exists today

### Migrations that define or touch exams

| Migration | What it does for exams |
| --- | --- |
| `20261001230352_lms_schema` | Tables `assessments`, `assessment_questions`, `assessment_options`, `offering_assessments`, `assessment_attempts`, `assessment_responses`, `media_assets`, `private.assessment_answer_keys`. RLS on, all grants revoked. |
| `20261001230357_lms_authorization` | `can_view_assessment`, `can_grade_assessment`; RLS policies and column grants on all six public tables and `media_assets` (below). |
| `20261001230358_lms_integrity` (+ `…230955_lms_verification_fixes`) | Integrity trigger: an offering's assessment must be of the same course, a response's question must belong to the attempt's assessment, a response photo must be the student's own `submission` asset of that offering, points ≤ question points. `reject_reparenting` on the parent columns. `preserve_assessment_history`: no edit of an assessment, its questions, options, keys or schedule once any attempt exists ("clone a new version"). |
| `20261001230606_lms_workflows` | First versions of `start/save/submit/grade/finalize`, `get_assessment_results`, `get_assessment_answer_keys`, `set_assessment_answer_key`, `clone_assessment` (private definer + public invoker wrapper). |
| `20261001230644_lms_storage` | Buckets `lms-course-media` and `lms-submissions` (private, 20 MB, JPEG/PNG/WebP/PDF/text); `can_upload_media`, `can_download_media`, `complete_media_upload`; storage policies `lms_objects_insert` / `lms_objects_select`. |
| `20261010100544_harden_storage_and_assessments` | Upload bound, `upload_expires_at`, safe paths, column-limited insert grant on `media_assets`, owner check on object insert; per-student advisory lock on exam start; `require_completed_response_file` (a response photo must be `ready`). |
| `20261010100545_external_identity_preparation` | **Rewrites every function and policy that used `auth.uid()` to `private.current_app_user_id()`** (by text replacement). This is why the older exam SQL works under a Firebase identity; checked on dev: `can_edit_course`, `can_manage_offering`, `can_support_offering`, `is_enrolled`, `can_view_media`, `can_upload_media`, `complete_media_upload` and `start_assessment_attempt` all use `current_app_user_id()`, none uses `auth.uid()`. |
| `20261010100547_objective_assessment_grading` | Auto-grade on submit (trigger `auto_grade_submitted` → `grade_on_submission`), numeric keys with absolute tolerance. |
| `20261010101249_ready_media_references`, `…102724_bound_assessment_response_size` | A response may reference only a ready asset; response size bound. |
| `20261010123515_firebase_identity_resolution` | `current_app_user_id()`, a restrictive `trusted_identity` policy on every public table and on the two LMS buckets. |
| **`20261012044748_secure_exam_attempts_and_results`** (applied, migration 18) | The secure exam layer, below. |
| **`20261012053751_atomic_exam_authoring`** (applied, 19) | `save_exam_definition`, `get_exam_definition` (MCQ / written only). |
| **`20261012063114_complete_exam_workflows`** (applied, 20) | `save_exam_definition_v2` (7 formats), `save_exam_answers`, `get_exam_definition_v2`, `clone_exam_schedule`, `private.exam_grade_changes` + `immutable_grade_change`, `grade_exam_paper`, `get_exam_grade_changes`, `get_exam_submission_page`. |
| `20261013141230_complete_lesson_workflows`, `20261018091735_lesson_covers` | Media cleanup refuses an asset referenced by an `assessment_responses` row. |
| `20261015185510_complete_notifications_support_workflows`, `20261018100132_group_presentation_and_session_summary` | Event type `exam_released`; trigger `notification_exam` on `private.assessment_participations` (fires when `released_at` is set, key `exam:<participation>:<released_at>`, link `/exams/<schedule>` while released). Support category `exam`. |
| Demo: `20261029120000`, `20261030120000`, `20261104120000`, `20261109120000` (`demo_clear_core`) | Clear refuses (blocker `exams`) when any `assessments` row is in a demo course or any `offering_assessments` row in a demo offering. Seeds `20261031120000`, `20261106130000`, `20261109120000`, `20261113120000` write one `exam_released` notification (no exam row). |
| `20261109120000_homework_teacher_rules` | Explicitly does not touch exams: `homework_delete_images` takes a homework id only. |

On dev the migration history records `20261113120000_homework_correct_demo.sql` as version `20261112225004` (and other files under
the versions the MCP assigned); the file names in the repo are unchanged. No exam migration after `20261012063114` exists.

### Tables

| Table | Grants to `authenticated` | RLS | Notes |
| --- | --- | --- | --- |
| `public.assessments` | select, insert, delete, update(title, type, instructions, status) | `can_view_assessment` (select); `can_edit_course` (write) | per **course**; `type` quiz / exam / assignment / practice; `version`, `supersedes_assessment_id` |
| `public.offering_assessments` ("schedule") | select, insert, update(opens_at, closes_at, time_limit_seconds, max_attempts, shuffle_questions, shuffle_options, published) | staff of the offering, or enrolled + published | **one window per offering** (`opens_at`, `closes_at`), `unique(offering_id, assessment_id)` |
| `public.assessment_questions` | select, insert, delete, update(question_type, prompt, points, position, settings) | through the assessment | 7 types; `settings` limited to placeholder / min_length / max_length / allowed_mime_types / max_files / max_size_bytes |
| `public.assessment_options` | select (no `is_correct`), insert, delete, update | through the question | positions; `is_correct` hidden by the column grant |
| `public.assessment_attempts` | select(id, offering_assessment_id, user_id, attempt_number, started_at, deadline_at, submitted_at, status, created_at, updated_at) | own (active user) or support staff | `score`, `max_score`, `graded_*` revoked (migration 18); `participation_id` |
| `public.assessment_responses` | select(id, attempt_id, question_id, response, media_asset_id, created_at, updated_at) | own or support staff | marks and feedback not granted |
| `private.assessment_answer_keys` | none | on, no policy | numeric keys |
| `private.assessment_participations` | none | on, no policy | one per schedule and student: attempts state, retry decision, final attempt, `grading_state`, `released_at`, `review_released_at`, `revision` |
| `private.assessment_question_outcomes` | none | on, no policy | per attempt and question: **`display_position` and `option_order`** (the shuffled order, stored), outcome, points |
| `private.exam_grade_changes` | none | on, no policy | append-only audit (trigger refuses update/delete while the attempt exists) |
| `public.media_assets` (`lms-submissions`, kind `submission`) | select; insert of named columns | `can_view_media`; insert: own pending asset, enrolled | exam photo answers |

### Functions (private definer, public invoker wrapper, `authenticated` only)

- **Student:** `start_assessment_attempt`, `sync_exam_participation`, `decide_exam_retry` (accept / decline), `save_exam_response`,
  `save_exam_answers` (atomic snapshot), `submit_assessment_attempt`, `get_exam_attempt_content` (questions in the stored order, no
  keys), `get_exam_review` (keys and both attempts, only after `review_released_at`), `get_exam_summaries` (≤ 100 schedules),
  `get_assessment_results`, `get_exam_grade_changes`.
- **Staff:** `save_exam_definition` / `_v2`, `get_exam_definition` / `_v2`, `clone_exam_schedule`, `grade_exam_paper` (idempotent
  request id, reason after release, audited), `grade_assessment_response`, `finalize_assessment_grade`, `release_exam_result`,
  `release_exam_review` (only after `closes_at`), `get_exam_grading_detail`, `get_exam_submission_page` (25 per page, cursor).
- **Internal (revoked):** `validate_exam_settings` (trigger: exams need 1 or 2 attempts), `lock_exam` (one lock order), `exam_enrolled`,
  `exam_integrity` (trigger on attempts, participations, outcomes), `valid_objective_key`, `auto_grade_attempt`, `refresh_exam_grade`,
  `finish_exam_attempt`, `reconcile_exam` (finishes an expired try at the next call), `exam_state`; the renamed `_v17` originals.
- Who may do what: authoring needs `can_manage_offering` **and** `can_edit_course`; grading and both releases need
  `can_support_offering` (every offering assistant; no per-assistant switch).

### Behaviour of the legacy flow (what a student gets today)

- One window per offering (`opens_at`..`closes_at`), optional limit; deadline = min(start + limit, close); server clock; late saves refused.
- Up to 2 attempts. After a first paper with an objective mistake, the **student decides** to retry or not; the second paper starts
  empty and its score replaces the first (no "fix mistakes").
- **Objective-only papers release their total by themselves the moment a student finishes** (`refresh_exam_grade`), per student,
  regardless of other students or windows. Answer review is a separate per-student release, allowed only after `closes_at`.
- Shuffled order is drawn with `random()` at start and stored per attempt (`assessment_question_outcomes`).

### Storage

Exam photo answers go to bucket `lms-submissions` through `media_assets` (`kind='submission'`, path `<org>/<asset>/…`). Read: the
uploader, space owners/admins, and support staff of the offering (`can_view_media`). There is no exam picture for questions or model
answers in storage: a question picture is an `https://` URL in `settings.image_url`, and there are no model answers.

### App code and tests that call it

- **Student, live (the contract):** `/exams` and `/exams/<schedule id>` (`app/(dashboard)/(routes)/exams/*`,
  `app/(dashboard)/_components/website-exams.tsx`) → `server/services/exams.ts` + `server/repositories/exams.ts` (direct selects on
  `offering_assessments`, `assessments`, `course_offerings`, `assessment_questions`, `courses`, and `get_exam_summaries`) and the runner
  `frontend/features/exams/exam-runner.tsx`, `exam-result.tsx`, `exams-retry.tsx`, `exams-list.tsx`, `exams-view.tsx`.
- **One route:** `POST /api/secure-exams/<id>/<action>` (`server/http/exam-runner.ts`; middleware allows exactly the 14 actions state,
  start, answers, submit, decision, result, photo, grading, grade, release, release-review, definition, save-definition, clone) →
  `exam-runner.ts`, `exam-grading.ts`, `exam-authoring.ts`, `exam-security.ts` (repositories `exam-security.ts`, `lms.ts`).
  Staff see `TeacherFoundationNotice` on `/exams`; the teacher builder and grading panel were retired, but the **staff actions of the
  route still work** for anyone the database authorizes.
- **Tests:** `supabase/tests/exam-attempts-results.sql`, `exam-authoring.sql`, `exam-completion.sql`, `authorization.sql`,
  `hardening.sql`, `firebase-identity.sql`, `notifications-support.sql` (exam_released), `settings.sql`, the demo suites (exam blocker,
  seeded notification); `scripts/exam-concurrency.cjs`, `exam-deadline.cjs` (`--timers`), `exam-runner.test.cjs`,
  `exam-security.test.cjs`, `exams-foundation.test.cjs`, `exam-sql-local.cjs`, `continue-learning*`, `student-portal.test.cjs`,
  `firebase-tenant-http.cjs`, `lms-load-test.cjs`, `lms-storage-maintenance.cjs`, `legacy-migration*`.

### Defects found while reading (not fixed; nothing is in use)

1. **A legacy question picture cannot be saved.** `save_exam_definition(_v2)` writes `settings = {"image_url": …}`, but the table check
   (confirmed on dev: `assessment_questions_settings_check`) allows only placeholder / min_length / max_length / allowed_mime_types /
   max_files / max_size_bytes, so any `imageUrl` fails with 23514. The runner reads `settings.image_url`, so this never worked.
2. Legacy authoring is reachable through `/api/secure-exams/<id>/save-definition` and `clone` by any course editor who manages the
   offering, though no screen calls it. A legacy exam created that way would follow the old rules (instant per-student release).

---

## b. The owner's rules against what exists

| # | Rule | Exists | Changes | New |
| --- | --- | --- | --- | --- |
| 1 | Online and paper kinds | online only | — | `kind` online / paper; paper has `max_marks`, no questions, no window; per-student mark or Absent |
| 1 | Paper → bubble sheets later | — | — | tables shaped so a key and scanned sheets attach later (§c.6) |
| 2 | Belongs to a course (offering), tagged with chapters | offering via schedule; assessment per course; no chapter link | — | exam row has course + offering; `exam_chapters` (+ "all") |
| 3 | Choice 2–8, one or more right, derived type | 2–6 options, explicit single/multiple type | — | 2–8, A–H, derived type (as homework since `20261112120000`) |
| 3 | Number with tolerance | yes (`numeric`, absolute tolerance) | — | same idea, new table. **Homework has no Number type** (see e.Q1) |
| 3 | Essay: text and/or one photo, 5 MB, per-exam photo switch | essay / file_upload types, photo up to 5 MB in the route | — | `response_mode` text / photo / both + `photos_allowed`, as homework |
| 3 | Model answer, text + optional photo, only at review | none | — | `exam_keys.model_text`, `model_image_id` |
| 4 | Per-Group windows linked to sessions | one window per offering | — | `exam_group_windows` with a session link or a custom window (§c.3) |
| 4 | Same time for all | the one window | — | `timing='same_time'`, `opens_at`/`closes_at` on the exam |
| 4 | No-Group students; several Groups | — | — | computed window (§c.3) |
| 4 | Limit; late starter gets what's left; server clock | yes | — | same formula over the student's window |
| 5 | Tries: one / fix mistakes / from zero | 1–2 attempts, student decides, second paper empty | — | homework's three modes, max 2, second try only inside the student's window |
| 6 | Mix order, stored per try | yes (`option_order`, `display_position`) | — | same storage idea in `exam_attempt_items` |
| 7 | Teacher releases, per student or "Release N" | per student only, release by support staff | — | `exam_release_many` (all or nothing), per-assistant `release` right |
| 7 | Changed released grade needs a reason, audited | yes (`grade_exam_paper`) | — | same rule in `exam_grade` + `exam_audit` |
| 7 | Auto-release, no essays, after the LAST window | instant per-student auto-release | **must not apply to new exams** | computed on read + settled at the next action (§c.5) |
| 7 | Answer review after the LAST window, DB + storage | per student, after `closes_at`, needs a staff action | — | one exam-wide gate, enforced in reads and the storage policy (§c.5) |
| 7 | Release notifies like homework | `exam_released` on participations | — | same event type, new trigger branch on `exam_results` |
| 8 | Paper marks: managers + `correct`; release: `release` | — | — | `exam_paper_marks` path through `exam_staff(…, 'correct' / 'release')` |
| 8 | Reuse homework assistant rights | `private.homework_assistant_permissions` (course, user, can_correct, can_release; no row = on) | none to the table | one shared helper reads it for both (§c.7) |
| 9 | Exam uploads kept, count toward storage | no exam uploads table | `homework_storage_usage` gains an exams part | `private.exam_uploads`, bucket `lms-exams`, no delete action |
| 10 | Teacher reads | `get_exam_submission_page` only | — | `exam_portal`, `exam_queue`, `exam_paper_sheet` (§c.8) |
| 11 | Demo seed v7 | Clear refuses exams | later | (§e.R6: Clear must still work once teachers can add exams) |

---

## c. Proposed design

### c.1 New exam tables beside the legacy ones (recommended)

**New `exam_*` tables, modelled on the homework tables, with the legacy assessment tables left working and unchanged.**

Why not extend `assessments` / `offering_assessments`:
- **The legacy rules contradict the owner's.** Objective papers release per student the moment they finish (`refresh_exam_grade`),
  which breaks rule 7 (no Group sees anything early); the second try is a student "accept/decline" with an empty paper, not fix
  mistakes / from zero; there is exactly one window per offering (`unique(offering_id, assessment_id)`, `opens_at`/`closes_at`), and no
  session link. Changing these means replacing `refresh_exam_grade`, `finish_exam_attempt`, `reconcile_exam`, `exam_state`,
  `start_assessment_attempt`, `decide_exam_retry`, the `validate_exam_settings` and `exam_integrity` triggers and
  `preserve_assessment_history`, all applied and all shared with `assignment` / `practice`. Each "if new kind then…" branch inside them
  is the coupling the owner asked to avoid, and it would change the contract of the live student runner.
- **The student runner is part of the contract.** `/exams` keeps reading the legacy tables and keeps working for legacy schedules.
- **Homework already solved the hard parts** in the owner's terms (questions, keys, model picture, photos, tries, corrections, marks,
  release-many, queue, assistant rights, uploads and storage policy). Copying its shape gives one mental model; extending legacy
  would give a third.
- **Seven question types become three**, and the column grants that expose legacy tables directly would have to be narrowed.
- Cost of this choice: two exam systems in the schema until legacy is retired; `/exams` must list both (a later UI/read task).
  Dev has **no** legacy exam data (§d), so nothing has to be migrated.

Legacy stays as is, with one proposal for the owner (e.Q2): revoke `save_exam_definition`, `save_exam_definition_v2` and
`clone_exam_schedule` from `authenticated` so no new legacy exam can be created through the route.

### c.2 Tables and columns

All `private` unless noted, RLS on, **no client grants**; every read and write goes through definer functions with
`search_path=''` and the caller from `private.current_app_user_id()` (never `auth.uid()`), like homework. This also avoids per-row
RLS cost (listing_performance).

**`private.exams`** — one row per exam version
`id`, `family_id`, `version`, `supersedes_id`, `revision` (stale check), `course_id`, `offering_id` (same course, trigger),
`kind` online | paper, `title`, `description`, `status` draft | published | archived, `published_at`, `created_by`, `created_at`,
`updated_at`;
paper: `max_marks` (integer 1–1000), `held_on` (date, optional; e.Q7);
online: `timing` per_group | same_time, `starting_from` (date, Cairo), `opens_at`, `closes_at` (same_time only),
`time_limit_minutes` (null or 1–1440), `tries_mode` one | fix_mistakes | from_zero, `shuffle` boolean, `photos_allowed` boolean,
`auto_release` boolean (refused when any essay exists), `covers_all_chapters` boolean.
Checks: paper ⇒ no online columns and no questions; same_time ⇒ both times, closes > opens.

**`private.exam_chapters`** — `(exam_id, module_id)` primary key; the module must be a chapter of the exam's course (trigger).
`covers_all_chapters` means "all", including chapters added later. On chapter delete: cascade (tags only; they never block
`delete_chapter`, and `course_structure` blockers stay as they are).

**`private.exam_questions`** — `id`, `exam_id`, `position`, `type` single_choice | multiple_choice | number | essay (choice type
derived from the key at save), `text` (optional for choice), `image_id` → `exam_uploads`, `points` (0–1000), `response_mode` text |
photo | both (essays).
**`private.exam_options`** — `id`, `question_id`, `position` 0–7 (letters A–H / أ–ح come from the position), `text` (optional).
**`private.exam_keys`** — `question_id`, `correct_option_ids uuid[]`, `number_value numeric`, `number_tolerance numeric ≥ 0`,
`model_text`, `model_image_id` → `exam_uploads`. Never returned to a student before review.

**`private.exam_group_windows`** — `(exam_id, group_id)` primary key, `source` auto | picked | custom, `session_id` →
`group_sessions` (auto/picked), `custom_opens_at`, `custom_closes_at` (custom). Check: exactly one of session / custom. Trigger: the
group belongs to the exam's offering, the session to that group. (§c.3)

**`private.exam_attempts`** — one per try: `id`, `exam_id`, `user_id`, `number` 1 | 2, `channel` (online now; later `sheet`, §c.6),
`window_group_id` (null = no-Group or same-time window: which window was used, pinned at start), `started_at`, `submitted_at`,
`status` in_progress | submitted, `auto_submitted` boolean, `revision`. Unique (exam, user, number); one in-progress try per student
(partial unique index).
**`private.exam_attempt_items`** — `(attempt_id, question_id)`, `position`, `option_order uuid[]`, unique (attempt, position). (§c.4)
**`private.exam_responses`** — `(attempt_id, question_id)`, `option_ids uuid[]`, `number_value numeric`, `text`, `upload_id` →
`exam_uploads`, `kept` boolean (fix mistakes), `saved_at`.
**`private.exam_marks`** — `(attempt_id, question_id)`, `points` (null = waiting), `auto` boolean, `note`.

**`private.exam_results`** — one per exam and student, for **both kinds**: `exam_id`, `user_id`, `final_attempt_id` (online),
paper: `paper_mark numeric(7,2)` 0..max_marks, `absent` boolean (never both; Absent ≠ 0), then `status` waiting | corrected,
`score`, `max_score`, `released_at`, `released_by`, `revision`, `entered_by`, `updated_at`. This is the one row a release, a notice and
Reports look at, whatever the kind.

**`private.exam_audit`** — append-only: definition saves, window changes, start, submit, auto-submit, mark entry, grade, release,
unrelease, reason, before/after. Same immutability trigger idea as `exam_grade_changes`.

**`private.exam_uploads`** + bucket **`lms-exams`** (private, 5 MB images; PNG/JPEG/WebP) — `purpose` question | model | answer,
`status` pending | ready, `size_bytes`, `path = <exam>/<upload>/<file>`, `uploaded_by`. No `deleted` or `archived` state is ever set by
an exam function (rule 9). Storage policies through `private.exam_storage(bucket, name, action)`: insert = the caller's pending upload
(answer: own in-progress try inside the window, photos on; question/model: author); read = staff of the exam, or the student's own
answer, or a question picture of an exam they may take while their try is open, or a **model picture only when review is open**; no
delete policy.

### c.3 Windows linked to sessions (rule 4)

- **Per Group (default).** On every draft save and at publish, for each **active Group of the offering** without a picked or custom
  row, the function first runs the existing `private.materialize_group` (sessions exist only 90 days ahead) and then links the first
  **non-cancelled** `group_sessions` row with `starts_at ≥ starting_from 00:00 Cairo`, stored as `source='auto', session_id`. No
  times are copied.
- **The window is always read live:** `private.exam_window(exam, group)` returns `opens = session.starts_at`, `closes =
  session.ends_at`, or the custom pair, or a state: `cancelled` (linked session cancelled), `none` (no session after the date and no
  custom time). A moved session moves the exam; a cancelled one leaves that Group with no window, and every teacher read shows it.
- **Change** = `exam_set_window(exam, group, revision, {sessionId} | {opensAt, closesAt})`: another session of that Group (`picked`)
  or a custom pair (`custom`, for a Group with no session). Auto links are never re-resolved silently after publish (a cancellation
  stays visible until the teacher acts).
- **Publish** needs a window for every active Group (link or custom). A Group created after publish has no row: reads list it as
  "needs a time" (e.Q4).
- **Same time for all:** one window on the exam; Groups are ignored.
- **No-Group students** (active enrollment, no active membership): from the earliest open to the latest close over the Groups that
  have a window.
- **Several Groups:** the schema allows one active membership per offering (`group_memberships_one_active`), so it cannot happen
  inside one exam today. The window function still takes the student's set of Groups and uses the first window that has not closed,
  so the rule holds if that ever changes. A moved student uses their membership **at start**; the start pins `window_group_id`.
- **Deadline** = min(`started_at` + limit, the pinned window's **current** close), on `clock_timestamp()`; saves after it are refused
  (PT409 `deadline_passed`); an unfinished try is submitted as it stood at the next call (`auto_submitted`), as legacy does.
- **The last close** = the latest close among all windows that exist (Groups, no-Group, or same-time). (Cancelled Groups: e.Q3.)

### c.4 Order storage (rule 6)

`exam_attempt_items` is written once at start (and at the second try): question order and each choice's option order, drawn with
`random()` when `shuffle` is on, else the authored order. Reads always order by the stored rows, so a refresh shows the same paper.
Answers are option ids and grading reads `exam_keys`, so order never touches grading. Letters are shown by on-screen position for the
student; teachers and review show both the student's letter and the authored one. Fix-mistakes second try reuses the first try's
order so kept answers stay in place; from-zero draws a new one (e.Q8).

### c.5 Auto-release and answer-review gating (rule 7)

**Chosen: compute on read, settle at the next action, no new scheduled job.**
- `private.exam_closed(exam)` = every window has closed (§c.3) on the server clock. It is cheap (one exam, its Groups).
- **Review gate** `private.exam_review_open(exam) = exam_closed(exam)` — exam-wide, the same instant for every Group. It guards
  `exam_get` (keys, model text, model picture ids, per-question marks), the storage read of model pictures, and every review read. No
  staff action is needed and none can open it early.
- **Auto-release** (allowed only when the exam has no essay): a result counts as released when `released_at` is set **or**
  (`auto_release` and `exam_closed`). Every student and teacher read applies this, so nobody waits for a job.
- **Settling** writes `released_at` (and so the notices) the first time anything touches the exam after it closed: any student call
  (state, start, review), any teacher read or write on that exam, and the `exam_portal` read for the exams on its page. These run as
  `volatile` functions; the write is idempotent under the exam lock. The existing trusted `notification_worker('sweep')` could also
  settle due exams, but that is a change to an applied function and a question of whether the worker runs at all (e.Q9).
- Why not a job: none exists for this in the app (an in-app job would be a new provider/scheduler change), and a job that is late
  would delay grades; the read rule is exact. The cost: a notice may arrive when the next person opens EduLabs, not at the close.
- **Notices:** a new branch in `private.notification_business_event` for `private.exam_results` when `released_at` goes from null to a
  value, event `exam_released`, key `exam:<result>:<released_at>`, one per released result (like homework, one per released try),
  and a new link rule in the resolver (the student exam page path is decided with the student UI). Both functions are replaced with
  `create or replace` in the new migration; the legacy participation branch stays.

### c.6 Paper exams, and bubble sheets later

- **Now:** `kind='paper'`, `max_marks`, no questions, no windows, no attempts. `exam_paper_mark(exam, items[{userId, mark|absent,
  revision}])` saves as the teacher types (one or many rows, stale check per row), writes `exam_results` (`paper_mark` or `absent`,
  `status='corrected'`) and `exam_audit`. A changed **released** mark needs a reason (≥ 3 characters), withdraws the release until it
  is released again, and is audited (homework's rule). Release per student or `exam_release_many` (all or nothing).
- **Later, nothing thrown away:** a paper exam gains `exam_questions` / `exam_keys` (the same tables online exams use; the "no
  questions" check is relaxed for paper); a photographed sheet becomes `exam_uploads` (purpose `sheet`) plus an `exam_attempts` row
  with `channel='sheet'`, its `exam_responses` filled from the reading and its essay marks in `exam_marks`; `exam_results.score` is
  then computed from that attempt exactly as for online. Typed marks stay valid: a result has either `paper_mark` or a
  `final_attempt_id`, and the check is widened then, not now.

### c.7 Sharing with homework without coupling

- **Assistant rights:** one helper, `private.course_assistant_right(course, capability)` (`correct` / `release`): managers of the
  offering always; offering support staff when their row in `private.homework_assistant_permissions` is on (no row = on). Exams call
  it through `private.exam_staff(exam, capability)` (`author` = `can_edit_course`; `grade`/`view` = `can_support_offering`;
  `manage`; `correct`; `release`). `homework_staff` is **not** rewritten (applied, tested). The table keeps its name; renaming it would
  break every homework function that names it. `set_homework_assistant` therefore sets both features at once, and the assistants
  screen must say "homework and exams". It fits rule 8; the limit is that separate exam switches later need new columns (e.Q6).
- **Question editing:** the same JSON shape on the wire as homework questions (`type`, `text`, `imageId`, `points`, `responseMode`,
  `options[{id,text}]`, `correct[]`, `modelText`, `modelImageId`) plus `number {value, tolerance}`. The rules are a separate
  `private.exam_question_check` in SQL, so neither feature's validator can change the other. On the screen side the Questions step and
  the correcting screen take a "supports Number" flag (a UI task, later).
- **Corrections:** `exam_queue` returns homework_queue's shape (tabs, counts, rows, `readyToRelease`, `releasable`), so the
  correcting screen can serve both.

### c.8 Functions

Writes (each locks the exam, checks `revision`, audits):
`exam_save(exam|null, revision, definition)` (draft; questions frozen once any try exists: then a new version, like homework);
`exam_lifecycle(exam, action, revision, data)` publish / unpublish / clone / archive / reschedule (`starting_from`, same-time times or
limit; allowed after starts only for windows that have not opened: e.Q5); `exam_set_window`; `exam_work(attempt|exam, action,
revision, data)` start / save / submit / retry (student) and grade / release (staff); `exam_release_many(exam, items)`;
`exam_paper_mark`; `exam_upload(action, data)` intent / complete / get.
Reads: `exam_get(exam, attempt?)` (student: their paper in stored order, deadline, tries left, results when released, review when
open; staff: definition with keys, `canCorrect`, `canRelease`); `exam_student_list()`.
Teacher reads (scope from the caller's memberships, never authorizing every exam in the database; 25 / 50 per page):
- `exam_portal(course|null, tab, page)` → `live` (per Group: started / total, time left, closes at), `toCorrect` (online: essays
  waiting; paper: marks missing), `upcoming` / `closed` / `drafts` rows each with its Group windows and states (`ok`, `cancelled`,
  `none`, `needs_time`), question count and marks, counts for "All exams".
- `exam_queue(exam, tab, page)` — to_correct / done / missing, as `homework_queue`.
- `exam_paper_sheet(exam, group|'none'|null, page)` — students of a Group with mark, Absent, revision; per-Group "left" counts.
- `exam_storage_usage` folded into the existing `homework_storage_usage(space)` (same signature, an `exams` section added).

---

## d. Data on dev (read-only check, 2026-11-13)

| What | Rows |
| --- | --- |
| `assessments`, `offering_assessments`, `assessment_questions`, `assessment_attempts`, `assessment_responses` | **0** |
| `private.assessment_participations`, `assessment_question_outcomes`, `exam_grade_changes`, `assessment_answer_keys` | **0** |
| `media_assets` in `lms-submissions` | **0** |
| `private.notification_events` of type `exam_released` | 2 (the demo seed's sample notices; they point at no exam) |

There is nothing to migrate or reconcile. Dev data is worthless anyway; if anything existed it would stay in the legacy tables, served
by the legacy runner, and new exams would never read it. The two demo notices stay as they are.

---

## e. Risks, conflicts with the rules, and questions

### Risks and conflicts

- **R1. Number questions are not in homework.** The board note says the Questions step is "the homework Questions step reused as
  is", with Number; homework has single/multiple choice and essay only. The plan gives exams Number now (Q1).
- **R2. A cancelled session after publish.** If that Group is left out of "the last close", review and auto-release can open while the
  Group still has no exam; if the teacher then picks a new session, that Group's students could take an exam whose answers are already
  open. If it is kept in, review waits until the teacher acts (Q3).
- **R3. A session moved while students are inside.** The deadline follows the live session end, so moving a session that is running
  can shorten a try in progress. Group code is not changed by this track. Proposed: allowed, and the exam reads warn; alternatively a
  try's deadline is frozen at start (Q5).
- **R4. Fix mistakes inside one window leaks which answers were wrong** to a student who can tell another Group before its window.
  That is inherent to the rule, not to the design.
- **R5. Grades released before the last window closes** show scores (never answers) while other Groups have not sat the exam. The
  rules allow manual release at any time; the plan does not block it (Q10).
- **R6. Demo Clear.** Clear refuses any exam today and the owner moved seed v7 to later. Once teachers can add exams in a demo space,
  Clear would refuse forever, and the new `exam_group_windows` → `group_sessions` foreign key would block deleting sessions. The
  migration that adds the tables should at least teach Clear to remove teacher-added exams (and refuse a real person's try or a stored
  exam file, as for homework), even before seed v7. The demo-data rule in V1.md says the seed moves in the same change; the owner's
  rule 11 overrides that for this track, and it needs saying.
- **R7. Two exam systems on `/exams`.** The student list today reads legacy only. New exams need a student read and a way into the
  runner (a UI task); the notice link waits for that path.
- **R8. Legacy authoring is still callable** by staff through `/api/secure-exams` and would create exams with the old release rule (Q2).
- **R9. Sessions exist only 90 days ahead.** A "starting from" date more than ~90 days out finds no session and reads as `none`
  until the teacher picks a time later.
- **R10. "Students in no Group"** depends on active membership; a student removed from a Group mid-exam falls back to the no-Group
  window at their next start, but a running try keeps its pinned window.

### Questions for the owner

1. **Number in homework too?** The board reuses the homework Questions step "as is" with Number. Exams get Number in this plan;
   should homework gain it (a separate homework migration), or does the step show Number for exams only?
2. **Close legacy authoring?** Revoke `save_exam_definition(_v2)` and `clone_exam_schedule` from clients so no new legacy exam can be
   made, keeping the legacy student runner and grading for existing ones? (Recommended; there are none on dev.)
3. **A Group whose linked session is cancelled after publish:** does it hold answer review and auto-release until the teacher picks
   another session or marks that Group "not taking it", or is it simply left out of "the last close"? (Recommended: it holds, and the
   Exams page says so.)
4. **A Group created after publish:** no time until the teacher picks one (shown as "needs a time"), or linked automatically to its
   first session after "starting from"?
5. **Changing times after students started:** may the teacher pick another session or change the limit for a Group whose window has
   already opened? And should a try in progress keep the deadline it started with when its session is moved (safer) or follow the
   session (the literal rule)?
6. **Shared assistant rights:** one correct/release pair per assistant per course for homework and exams, as asked. OK that a
   separate exam switch later means a schema change?
7. **Paper exam date:** the marks board shows "Group 1 · Sat 14 Nov". Is that an optional "held on" date for the exam, a date per
   Group, or nothing? And may marks have halves (e.g. 17.5)?
8. **Fix mistakes in an exam:** the second try keeps the first try's question order (kept answers stay where they were)? Do essays
   reopen with the student's first text and photo, or empty? (Homework keeps an essay only at full marks in a released correction,
   which cannot happen inside one session.)
9. **Auto-release timing:** computed exactly at the close for anyone who looks, with the stored release and the notices written at
   the next action (no new job). Acceptable that a notice may come when someone next opens EduLabs? Or should the existing
   notification worker settle closed exams (a change to an applied function, and only useful if the worker runs on staging)?
10. **Manual release before the last close:** allowed (scores only, never answers), or refused until every window has closed?
11. **Answer review for students who did not take it:** homework shows solutions only to students who handed in. Same for exams
    ("for everyone" = every Group at the same time), or should absent students see the key too?
12. **Who authors:** homework needs course edit rights; the legacy exam builder also needed offering management. Use homework's rule?
13. **Demo Clear:** may the tables migration also teach Clear to remove teacher-added exams, before seed v7 (R6)?
