# Backend audit, Part 5: Homework

Read-only audit. Nothing in code, migrations, tests or config was changed. Branch `claude/backend-audit`, head at start
`f65f9096a6b50745aeb600a64abe0e969aafe74a` (confirmed on origin with `git ls-remote`).

## Summary

| Severity | Count | IDs |
| --- | --- | --- |
| High | 0 | none |
| Medium | 2 | A5-01, A5-03 |
| Low | 5 | A5-02, A5-04, A5-05, A5-06, A5-07 |
| Note | 4 | A5-08, A5-09, A5-10, A5-11 |

**What is sound.** The security design holds up under attack: every one of the 130 or so role, tenant and rule checks was refused or
allowed as designed (see "Checked and fine"). No student could see a model answer, a key, another student's answers, marks or photos,
or an unreleased mark; no one could submit late, beyond the tries, or into a draft lesson; assistants without rights could not
correct or release; staff of another space or run could touch nothing.

**What is not sound.** The same two problems as the earlier parts: the Data API can still read five homework tables through
per-row policies (A5-01, same class as A4-02 and A0-02), and one student can pile up unlimited stored photos (A5-03). The rest is
small. Three product questions for the owner are at the end.

**Cost at realistic size** (local PostgreSQL 17.10, UTC, 8 s statement limit like hosted, 410 users, 60 homework of 20 questions,
16,800 tries, 336,000 answers and marks, 22,400 photos; median of 7 warm runs):

| Operation | Time |
| --- | --- |
| Student opens a homework (`get_homework`) | 53 ms (193 identity lookups) |
| Student lesson list (direct table read, 7 homework) | 49 ms (about 7 ms per homework) |
| Student start / save / submit (20 questions, 4 photos) | 14 / 17 / 16 ms |
| Teacher portal (instructor / owner / assistant) | 52–58 ms |
| Correcting queue (instructor / assistant) | 30 / 50 ms |
| `homework_release_many`, 360 tries at once, as instructor and assistant | 266–290 ms and 273–275 ms |
| Reschedule of a closed homework with 360 hand-ins | 10.8 ms median |
| Delete images, 480 photos | 17.6 ms median |
| 300 students submitting in the same second, plus a teacher correcting and reading the queue | 2.8–3.1 s for all 300; each submit 2.1–2.6 s; 0 errors, 300 of 300 handed in |
| Direct `count(*)` as a student on `homework_submissions` (16,800 rows) | cancelled at 8 s (more than 68 s without a limit) |

## Scope and live versions

Part 5 is 18 tables, 46 functions, 3 triggers, and the policies below. The live version of each function is the last
`create or replace` in migration order, found by replaying all 52 migrations into a disposable database and dumping the catalog.

| Group | Objects | Live in |
| --- | --- | --- |
| Tables, public (read by `authenticated` through policies) | `homework_assignments`, `homework_questions`, `homework_options`, `homework_submissions`, `homework_responses`, `homework_submission_files` | `20261013184915_complete_homework_workflows.sql` |
| Tables, private (no grant to any API role) | `homework_keys`, `homework_solutions`, `homework_materials`, `homework_uploads`, `homework_marks`, `homework_corrections`, `homework_audit`, `homework_solutions_seen`, `homework_carried`, `homework_assistant_permissions`, `homework_annotations`, `homework_clone_sources` | same, plus `20261109120000_homework_teacher_rules.sql` |
| Student reads and work | `get_homework`, `homework_work` (start, retry, save, submit; grade, release, annotate for staff), `homework_upload`, `homework_history`, `homework_revisions`, `homework_submission_json`, `homework_asset` | `get_homework`, `homework_upload`: `20261112120000_homework_move.sql`; `homework_work`, `homework_submission_json`: `20261109120000`; rest `20261013184915` |
| Teacher authoring | `save_homework`, `homework_lifecycle` (publish, unpublish, clone, reschedule), `homework_delete_images`, `homework_integrity` | `20261112120000` (`homework_delete_images`: `20261109120000`) |
| Teacher reads and rights | `homework_portal`, `homework_queue`, `homework_release_many`, `homework_assistants`, `set_homework_assistant`, `homework_storage_usage`, `homework_course_manager`, `homework_staff` | `homework_portal`: `20261112120000`; the rest `20261109120000` |
| Rule helpers | `homework_solutions_rule`, `homework_unlocked`, `homework_enrolled`, `homework_visible`, `homework_submission_visible`, `homework_is_late`, `homework_week_start`, `homework_storage`, `homework_upload_visible`, `homework_upload_referenced`, `homework_workflow_guard` | `20261109120000`, `20261112120000`, `20261013184915` |
| Dead | `homework_inbox` (public wrapper and private function) | `20261013184915` |
| Triggers | `homework_integrity` and `homework_workflow_guard` on `homework_assignments`; `notification_homework` on `private.homework_corrections` (event `homework:<try>:<released_at>`, one per release) | `20261119120000_live_class.sql` for the notification function |
| Policies | `homework_read`, `homework_questions_read`, `homework_options_read`, `homework_submissions_read`, `homework_responses_read`, `homework_files_read`; `storage.objects` `homework_objects_insert/read/delete` (call `private.homework_storage`) | `20261013184915` |
| Routes | student `/api/homework/[assignmentId]/[action]` (`server/http/homework.ts`); teacher `/api/teacher/homework/...` (`server/http/teacher-homework.ts`) | |
| Other parts | `private.report_homework`, `demo_homework_make`, `demo_homework_try` | Part 8 |

Grants: `authenticated` has `SELECT` only on the six public tables (loop at `20261013184915:132`) and no insert, update or delete; the
private tables have no grant at all. Public wrappers are `security invoker` with `EXECUTE` for `authenticated` and `service_role`.
`anon` and `service_role` cannot call the student or teacher functions or read the tables (tested).

## Findings

### A5-01 (Medium, performance and availability): five homework tables can be read directly by any signed-in person, one policy call per row

`20261013184915:132` grants `SELECT` on all six public homework tables, and each policy calls `homework_visible` or
`homework_submission_visible`, which look up the caller, the profile status, the role and the membership again for every row.
Nothing in the application reads `homework_questions`, `homework_options`, `homework_submissions`, `homework_responses` or
`homework_submission_files` directly. Only `homework_assignments` is read directly (the lesson list and a course lookup).

**Failure scenario.** A student (or a stranger with a profile) calls the Data API with `select count(*) from homework_submissions`.
On 16,800 rows the query is cancelled after the hosted 8 s limit, and the same cancel happens for `homework_responses` (336,000
rows), `homework_questions`, `homework_options` and `homework_submission_files`. Without the limit `homework_submissions` took more
than 68 s. A handful of such calls in a loop hold the 60 hosted connections. This is the A4-02 and A0-02 class: no data leaks (the
rows returned are the correct ones), but any signed-in user can burn database time.

**Evidence.** The unfiltered `count(*)` as a student on `homework_assignments` (60 rows) took 406 ms (6.8 ms per row, 1,425 identity
lookups), as the instructor 89 ms. As a student, the other five tables hit the 8 s limit (code 57014). The same cancel happened for a stranger
(no enrolment) on submissions and responses, and for the instructor on responses and submissions.

**Suggested fix (not done).** Recommended: revoke `SELECT` on the five tables from `authenticated` (no code reads them) and drop
their policies; give the student lesson list and the course lookup a small function that checks the caller once per statement
(the shared "my scope" fix). Ships with the direct-access group.

### A5-02 (Low, performance): a student's homework page and lesson list repeat the identity lookup 24 times per homework

`get_homework` for a student makes 193 `current_app_user_id` calls and takes 53 ms. The lesson list reads
`homework_assignments` directly, 7 ms per homework (49 ms for 7). This is cheap today, but it grows with homework per lesson and is
the same per-row helper cost as A0-01.

**Suggested fix (not done).** Part of the shared "my scope" fix: resolve the user once per statement and join on it. Not urgent alone.

### A5-03 (Medium, storage abuse): there is no cap on ready photos, so one student can fill the Storage bucket

`homework_upload` limits only pending uploads (20 per student and homework; `20261112120000:339`-area, `>=20`). Once an upload is
completed (`ready`) it is no longer counted, and nothing references it until the student attaches it, so it also does not show in
`private.expired_homework_uploads` (the cleanup list).

**Failure scenario.** An enrolled student loops intent, upload, complete, and repeats. Each completed file is ready and unreferenced.

**Evidence.** On one draft try, the loop ran 45 times with 5 MB files and was never refused: 45 ready files per run (two runs left
90 ready, 450,000,000 bytes) and 0 rows on the cleanup list. `homework_storage_usage` counts them to the space but nothing stops them.
The hosted per-file limit was not measured (the local bootstrap has no Storage API); the bucket's own limit applies per file only.

**Suggested fix (not done).** Recommended: cap ready, unreferenced uploads per student and homework (for example 40 pages, matching what a
try can hold), and add ready-but-unreferenced files older than a day to the expired list. Ship with the next homework migration.

### A5-04 (Low, lock): saving homework takes the run row `FOR SHARE`, which waits behind the lock A0-04 will put on the run

`save_homework` locks the run `FOR SHARE` (`20261112120000:91,96,200`). The A0-04 fix makes the add, remove, transfer and create
enrolment commands take the run `FOR NO KEY UPDATE`; `FOR SHARE` conflicts with that.

**Evidence.** With the run row held `FOR NO KEY UPDATE`, `save_homework` returned after 1,542 ms (it waited the full hold). A student
`homework_work` start did not wait (67 ms), because it does not lock the run row.

**Suggested fix (not done).** Change `save_homework` and the move to `FOR KEY SHARE`, which does not conflict with `FOR NO KEY UPDATE`.
Ships with the A0-03/A0-04/A0-05 lock set. Also add the homework functions to A0-06 (below).

**A0-06 re-check for homework.** These lock shared rows with no `lock_timeout`: `homework_work` (homework `FOR SHARE`, then enrolment
`FOR SHARE`, per student), `save_homework`, `homework_lifecycle` (homework `FOR UPDATE`; advisory lock on clone), `homework_delete_images`
(homework `FOR UPDATE`), `homework_release_many` (homework `FOR SHARE`, then tries and corrections `FOR UPDATE`, both in id order),
`homework_upload` (homework, enrolment and try `FOR SHARE`; advisory lock per assignment and user), `set_homework_assistant`
(advisory lock per course) and the storage insert policy (`FOR SHARE` on the upload row). Proofs: a teacher transaction holding the
homework row via a reschedule made a student's `start` wait 2,591 ms until the commit, while `get_homework` (101 ms) and the queue
(83 ms) did not wait; a reschedule issued while 300 submits were in flight waited 2.57 s behind them and then ran. Hold times of the
teacher actions themselves are short (reschedule 10.8 ms, delete images 17.6 ms, clone 5.7 ms, unpublish 2.1 ms), so the realistic
risk is only an open transaction left idle (A0-06 fact 2). No deadlock was found: lock order is homework, enrolment, try, correction
everywhere, and `release_many` locks in id order.

### A5-05 (Low, correctness): saving with an empty payload silently deletes the student's draft answers

`homework_work` `save` (`20261109120000:369-377`) checks `jsonb_typeof(p_data->'answers')<>'array'`; with `p_data = NULL` the
comparison is NULL, the check does not raise, and the loop then replaces the answers with nothing.

**Evidence.** A student's draft had 3 answers; `homework_work(…,'save',…,NULL)` was accepted and left 0 answers. Only the student's own
draft is affected, and the server route validates the body, so a normal client cannot send it; a client bug or a retry with a lost
body would.

**Suggested fix (not done).** Reject `p_data is null` (and a payload without `answers` or `fileIds`) at the top, with the same
`23514` as other invalid payloads.

### A5-06 (Low, correctness): an Arabic essay between about 15,000 and 20,000 characters is refused with a raw database error

The function allows 20,000 characters per answer (`length(...)>20000`), but the table check is on bytes
(`octet_length(response::text)<=30000`, `20261013184915:82`). Arabic letters take 2 bytes.

**Evidence.** An answer of 20,000 Latin letters was accepted; one of 16,000 Arabic letters was refused with `23514`
`new row for relation "homework_responses" violates check constraint "homework_responses_response_check"`.

**Suggested fix (not done).** Recommended: measure bytes in the function and return the same "answer too long" message, or raise the table
limit to 80,000 bytes (the whole payload limit is 500,000).

### A5-07 (Low, product): publishing a corrected version leaves the old version open for students who have not started

`homework_lifecycle` publish does not unpublish the version it supersedes. After v2 was published, a student's lesson list showed both
v1 and v2, and a student who had not started could still start v1. The teacher portal and counts take only the newest version of a
family (DECISIONS: "listed when it is the newest of its family or has handed-in work"), so the student and teacher views disagree.

**Evidence.** After cloning and publishing v2 of one homework, the student read returned `[v1 published, v2 published]`, and `start`
on v1 by a student with no work succeeded.

**Needs owner decision (product).** Should students who have not started see only the newest version? Recommended: yes; show the old
version only to students who already have work on it, and refuse a new start on it.

### A5-08 (Note, product): with late hand-ins allowed and "solutions after the deadline", solutions open at the deadline for those who handed in

`homework_solutions_rule` does not look at `late_allowed`. A student who handed in before the deadline sees the solutions at the
deadline while a classmate can still hand in late (the rule is "only to students who handed in", the owner's 2026-11-06 decision).
**Evidence.** Rule text (`homework_solutions_rule`, `20261109120000`) and the test: after the deadline a student who handed in could
read the solution file and one who had not could not.
**Needs owner decision (product).** Should solutions wait until late hand-ins close? Recommended: yes when late is allowed, they open
at the end of the late window; for homework with no late hand-in nothing changes.

### A5-09 (Note, product): unsaved typing is lost at the deadline

When the deadline passes (late not allowed), a save is refused with `PT409 Deadline passed` (`start` and `retry` tested; `save` read from
the code), and nothing submits the draft for the student. A student still typing loses what they typed since the last autosave.
**Needs owner decision (product).** Should a draft be handed in automatically at the deadline? Recommended: no (it would grade
unfinished work); instead show the student a clear message and keep the draft readable.

### A5-10 (Note, lock): `homework_work` locks the submission row before the permission check

`select … from homework_submissions where id=p_submission … for update` (`20261109120000:356`) runs before the student or staff check,
as in A2a-07 and A3-09. A caller who knows a submission id (a random UUID) could make the owner's save wait for the length of their
transaction. Not realistically exploitable without the id; the 8 s limit bounds it. **Suggested fix:** check the caller's rights before locking.

### A5-11 (Note, dead and duplicate code)

- `/api/homework/[assignmentId]/[action]` actions with no frontend caller: `offerings`, `save`, `lifecycle`, `copy-media`, `inbox`,
  `assignments`, and `work` with `grade`, `release` and `annotate`. The teacher routes under `/api/teacher/homework` are the live ones.
- `private.homework_inbox` and its public wrapper: no caller, and the most expensive homework read measured (254 ms for 25 rows, 867
  identity lookups).
- The `legacy` workflow, FILE_UPLOAD mode, `homework_annotations` and the annotate action exist only for old rows. V1 holds development data only.
- `FILE_UPLOAD` grade with `uses_marks=false` accepts any score (never shown to students).

**Suggested fix (not done).** Recommended: remove the unused actions and `homework_inbox` with the next homework migration; decide on
the legacy workflow after V1.

## Checked and fine

All run as `authenticated` with Firebase-shaped claims against the replayed database (a fixture of synthetic users only).

- **Solutions and keys.** Before the rule: `get_homework` returns no model answer text, no correct ids and no solution (also not in
  question `modelAnswer`); after hand-in with `after_deadline` and the deadline in the future, still shut; with `after_hand_in` and one
  try, open at hand-in. Solution files: `homework_storage` read false and `homework_upload get` refused before the rule, for the student
  who handed in and one who had not; open after the deadline only for those who handed in.
- **Other students' work.** Another student could not read a try (`get_homework`, `homework_history`), could not read it directly (0 rows
  for submissions and answers), could not save into it, grade or release it; could not read, or get a link to, another student's photo; could not write an
  object at another student's pending path; storage row reads and deletes by other students returned or affected 0 rows.
- **Unreleased marks.** Before release the student sees status under correction, no score, no marks. An edit of a released correction
  needs a reason and withdraws it from the student until released again.
- **Deadline, tries, lessons.** Start and retry after the deadline refused (`PT409`); a late hand-in accepted only when allowed and flagged
  `missed_deadline`; a second try on a one-time homework refused; start and `get_homework` refused for homework of a draft lesson and for
  unpublished homework; save refused after the lesson was unpublished; suspended profile and suspended enrolment refused everywhere.
- **Reschedule.** Tries used stay used (`triesUsed=1, triesLeft=0, triesEnded` after the extension; try 2 refused `no_tries_left`);
  students with only a draft keep their tries; reschedule to a past time, without an offset, or with a stale revision refused. Deadlines
  must carry an offset or Z, so there is no server-timezone dependence; the week starts Saturday 00:00 Cairo (Friday 23:59 and Saturday
  00:00 tested, and the two daylight-saving boundary weeks tested on a UTC server).
- **Roles.** Assistant with both rights off could read a try and the queue (view only) but not grade, release, release many, delete
  images, or change rights; with default rights grade and release worked; a second staff member with an old revision got `PT409`; a
  course editor without a support role got the portal without student numbers and was refused the queue and tries; other-space owner, other-space student, and staff of another run of the same course were
  refused on every function tested (`get_homework`, queue, portal, grade, `release_many`, lifecycle, delete images, upload, storage
  usage, assistant rights, save into the foreign run).
- **`release_many`.** All checks run before any write: a try of another homework, a stale revision and a duplicate each refused the whole
  call, and nothing was released. 360 tries in 266–290 ms including the notification trigger; one event per release.
- **Auto-grading.** Single choice right: full points. Multiple choice with two right answers: both right is full; one of two, both plus a wrong one,
  all four, none, and a wrong one only are all zero (exact set match, no partial credit); an empty key is refused at publish.
- **Direct writes and roles.** Insert, update and delete on all six public tables refused for the instructor (`42501`); all private tables
  unreadable by a student; `anon` and `service_role` refused on every function and table tested.
- **Moves and history.** A homework with a hand-in cannot be moved or edited (`PT409 started`); an edit after start goes through a new
  version, so submitted work is never rewritten.
- **Storage.** `storage.objects` policies tested through the real row-level rules (owner, other student, instructor, other-space owner);
  insert only at a registered pending path of the caller; staff upload into a homework with tries refused.
- **Load.** 300 simultaneous hand-ins with a teacher grading and reading the queue: no error and no lock wait; wait events were CPU and
  buffer contention. A prototype without the homework and enrolment `FOR SHARE` gave the same 2.9 s, so the share locks are not the cause.

## Could not verify

- **Hosted Storage.** The local bootstrap has a stub for `storage.objects`; file size and MIME limits of the real bucket, signed-URL
  lifetime and the Storage API removal of deleted photos were not tested (the cleanup script was read, not run).
- **Hosted speed.** Times above are from a 20-thread machine. On the hosted project (fewer cores, 60 connections) the 300-student
  minute will be slower; 16 ms of database time per hand-in means about 4.8 s of CPU for 300.
- **Save after the deadline** (A5-09) was read from the code, not run in two sessions.
- **Notifications** other than the release event were not run end to end (no push worker locally).

## How the proofs were run

A disposable PostgreSQL 17.10 (`timezone=UTC`, port 54875, data folder `pg-data-audit5`) was built by replaying the bootstrap, seed and all 52
migrations; synthetic users (owner, instructor, editor, two assistants, another-space owner, students s0–s399), 60 homework through the
real `save_homework`, and bulk tries, answers, marks and photos. Each check ran in its own transaction as role `authenticated` with
the Firebase-shaped claims. Locks were proved with two or three sessions at once (held transactions, `pg_stat_activity`, a prototype of
`homework_work` without share locks that was restored afterwards). The server and its data folder were stopped and deleted at the end; the scripts
lived in the git-ignored scratchpad and nothing was committed besides the three docs.
