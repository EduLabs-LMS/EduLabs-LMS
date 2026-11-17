# Backend audit, Part 6a: New exams

Read-only audit. Nothing in code, migrations, tests or config was changed. Branch `claude/backend-audit`, head at start
`ff10d4b2fb52912534f0908e603820a14836a4c5` (Part 5 and the owner decisions on Part 4).

## Summary

| Severity | Count | IDs |
| --- | --- | --- |
| High | 1 | A6a-01 |
| Medium | 5 | A6a-02, A6a-03, A6a-04, A6a-05, A6a-06 |
| Low | 6 | A6a-07, A6a-08, A6a-09, A6a-10, A6a-11, A6a-12 |
| Note | 2 | A6a-13, A6a-14 |

**What is sound.** The security design holds up under attack. Every table is private with row-level security on and no grant to any API
role; every `exam_*` function is a definer with `search_path=''` and the caller found through `private.current_app_user_id()`. No
student could read a question before the window opened, a right answer, another student's answers, marks or photos, or a result
before release. Nobody could start outside their Group's window, start twice (8 parallel starts made one try), or save after time
was up. Staff of another space or run, suspended people and assistants without rights were all refused. Paper marks reach only the run's
students. History is safe: an edit after a start goes through a new version.

**What is not sound.** The new owner rule "a student who starts before the close keeps the full time" (A5-12) is not built, and the
current code is written around the opposite rule. Built naively it leaks the right answers and releases results while a student is still
writing (A6a-01). The deadline formula, the wizard cap and the docs all have to change (A6a-02). Archiving an exam cuts off students who are
writing (A6a-03). One student can store about 225 MB of photos in one try (A6a-04). The teacher exam list slows down as a teacher gets
more courses (A6a-05). A teacher cannot extend an exam that is open (A6a-06). The rest is small.

**Cost at realistic size** (local PostgreSQL 17.10, UTC, 8 s statement limit like hosted; 400 students, 10 Groups, 30 exams of 40
questions, 393 tries on one exam; medians of several warm runs):

| Operation | Time |
| --- | --- |
| Student opens an exam (`exam_get`, no try) | 20 ms (322 identity lookups) |
| Student starts (40 questions, shuffled) | 14.5 ms |
| Answer save | 3.5 ms |
| Detail-only save by a teacher on a started exam (A0-09) | 3.3 ms hold, max 28 ms |
| Rewrite of 40 questions on an unstarted published exam | 11 ms |
| Student list (`exam_student_list`, 25 exams) | 55 ms (settles each exam: 200 settles per 8 calls) |
| Teacher portal, one course, open tab | 119–174 ms |
| Teacher portal, owner with 200 more courses and 400 more runs | 791 ms (assistant: 1,513 ms; 5,420 identity lookups) |
| Queue (400 students) | 17–21 ms |
| Paper sheet, 100 of 400 rows | 8 ms |
| Paper marks, 400 students in one call | 185 ms |
| Release many, 400 results (paper / online) | 375 ms / 617 ms |
| First reader after the close: settles 392 open tries, auto-releases 400 results with notices | 785 ms; the next 20 students waited 0.75–1.3 s |
| Group window computation (`exam_windows`, 10 Groups) | 9 ms cold (1,130 buffers); 0.04 ms per call in a loop |

## Scope and live versions

| Group | Objects | Live in |
| --- | --- | --- |
| Tables (private, no grant) | `exams`, `exam_chapters`, `exam_questions`, `exam_options`, `exam_keys`, `exam_group_windows`, `exam_attempts`, `exam_attempt_items`, `exam_responses`, `exam_marks`, `exam_results`, `exam_grade_changes`, `exam_uploads`, `exam_audit` | `20261114120000_exams.sql:21-246` |
| Authoring | `exam_check`, `exam_save`, `exam_lifecycle` (publish, unpublish, clone, reschedule, archive, restore, delete), `exam_set_window` | `exam_check` `:6`, `exam_save` `:24`: `20261115120000_exams_drafts_and_demo_v7.sql`; `exam_lifecycle` `:785`, `exam_set_window` `:845`: `20261114120000` |
| Student work | `exam_work` (start, retry, save, submit; staff: grade, release), `exam_attempt_json`, `exam_get` | `exam_work` `:904`, `exam_attempt_json` `:884`: `20261114120000`; `exam_get` `:142`: `20261115120000` |
| Windows and release | `exam_windows` `:389`, `exam_student_window` `:406`, `exam_user_windows` `:1200`, `exam_last_close` `:430`, `exam_closed` `:437`, `exam_review_open` `:441`, `exam_released` `:446`, `exam_release_check` `:1050`, `exam_release_many` `:1067`, `exam_apply_timing` `:647` | `20261114120000` |
| Marking and settling | `exam_mark_try` `:473`, `exam_finish` `:509`, `exam_settle` `:521`, `exam_items` `:544`, `exam_result_notice` `:594`, `exam_paper_mark` `:1099`, `exam_paper_sheet` `:1362` | `20261114120000` |
| Teacher reads | `exam_portal` `:1279`, `exam_queue` `:1332`, `exam_student_list` `:1258`, `exam_storage_usage` `:1388` (no caller), `exam_staff` | `20261114120000` |
| Uploads and storage | `exam_upload` `:1148`, `exam_upload_visible` `:562`, `exam_storage` `:574`; bucket `lms-exams` (5 MB; png, jpeg, webp); policies `exam_objects_insert`, `exam_objects_read` on `storage.objects` (no delete or update policy) | `20261114120000` |
| Triggers | `exam_row_integrity` (on `exams`, `exam_chapters`, `exam_group_windows`) `:266`; `exam_window_freeze` (after update on `group_sessions`) `:292`; `exam_link_new_group` (on `study_groups`) and `exam_link_new_session` (on `group_sessions`), both deferred constraint triggers `:317`; `exam_result_notice` (on `exam_results`); `immutable_grade_change` | `20261114120000` |
| Notifications | `notification_link` branch for `exam_released` | `20261115120000:180` |
| Routes | student `/api/exams/...` (`server/services/exams-student.ts`); teacher `/api/teacher/exams/...` (`server/services/teacher-exams.ts`); Home "Exams open now" (`teacher-home.ts:57`) | |
| Helpers | `exam_day_start` (Cairo midnight, tested across the daylight-saving days), `exam_taker`, `exam_enrolled_user`, `exam_link`, `exam_question_json`, `exam_row_integrity` | `20261114120000` |
| Demo | `demo_clear_core` (exam rows) | `20261114120000:1454`, seed v7 in `20261115120000` |

Grants: `authenticated` has `EXECUTE` on the 14 public `exam_*` wrappers (security invoker) and nothing else; `anon` and `service_role`
cannot call them. All 14 private tables: row-level security on, no policy, no grant to `authenticated`, `anon` or `service_role`.

`20261119120000_live_class.sql` does not touch any exam function.

## Findings

### A6a-01 (High, security): the rule started before the close keeps the full time changes what the exam functions may reveal and when

**What the owner decided (2026-11-17, A5-12).** A student who starts before the deadline or the window close gets their full time limit, even
past the close. Today every exam function assumes the opposite: nobody is writing after the last window closes, because the deadline of a
try is `least(window close, start + limit)` (`20261114120000:944`).

Four functions decide "the exam is over" from the **last window close alone**, ignoring tries still in progress:

- `exam_last_close` (`:430`) and `exam_closed` (`:437`).
- `exam_review_open` (`:441`): opens the review and the right answers for a student whose try is handed in.
- `exam_released` (`:446`): auto-release after the last close.
- `exam_settle` (`:521`) and `exam_mark_try` (`:473`): release, notify, and un-release and re-notify when a mark changes.

**Failure scenario.** The exam closes at 8:00 PM, and a student who started at 7:50 PM has 60 minutes, until 8:50 PM. At 8:00 the Group is
"closed" and:

1. Every student who already handed in sees the right answers and model texts (the review opens). They can send them to the one still
   writing. A student on the fix-mistakes try 2, who is still inside the exam, can read the answers to the first try through
   `exam_get(exam, try 1)`.
2. With auto-release on, results are released at 8:00 and notified, while a student is still answering.
3. `exam_mark_try` on a late hand-in lowers or raises a released result, un-releases it and notifies again.

**Evidence** (simulated by moving the Group windows into the past while student `s8` had try 2 running, deadline 20:55 UTC):
`exam_get(exam, try 1)` returned `reviewOpen: true`, `closed: true`, right answers and `modelText` in the first-try items; with auto-release
on, `exam_get(exam, null)` returned the result (`score 51 of 86`, `releasedAt` set) and the same read released both result rows while
`s8` and two other tries were `in_progress`. Today this cannot happen only because the deadline is capped at the close.

**Suggested fix (not done).** One gate everywhere: "the exam is over" means the last window close has passed **and** no try of the exam
(or of that Group's window) is `in_progress`. Put it in `exam_last_close` (return the later of the last close and the latest
in-progress deadline, indexed by `exam_attempts_one_open`) so that `exam_closed`, `exam_review_open`, `exam_released`, `exam_release_check`
and the queue all follow it. Re-check the gate inside `exam_settle` before releasing, and do not auto-release a Group whose own last try is
still running. A try 1 review must stay shut for a student who has another try open (fix-mistakes and from-zero). Test with two sessions: one
student writing past the close while another asks for the review.

### A6a-02 (Medium, correctness): the deadline formula, wizard cap, hints, tests and docs must change for the full-time rule

`exam_work` start sets the deadline to `least(window close, now + limit)` (`:944`). The same rule is written in
`shared/teacher-exams.ts:202-208` (`limitCap`: "at most the shortest window"; `clampLimit`), `frontend/features/teacher-exams/exam-wizard.tsx:131,273-278`
(the cap and its hint), `frontend/locales/en.ts:2032` and `ar.ts:2032` (`ex.w.limit_cap`: "At most {cap}: the shortest window"),
`scripts/teacher-exams.test.cjs:372-375` (pins the cap), `docs/ai/EXAMS_DB_AUDIT.md:450` ("Deadline fixed at start: `least(window end, start +
limit)`") and `docs/ai/DECISIONS.md:501`. The wizard also blocks a time limit longer than the shortest Group window.

**Failure scenario.** After the DB change alone, teachers still cannot enter a limit above the window, and the docs and tests describe
a rule the owner reversed. After the wizard change alone, the database still cuts every try at the close.

**Suggested fix (not done).** Deadline at start = `now + limit` when the start is before the close; no limit means the window close (as
today). Remove the cap in `limitCap`, the hint key and its test, keep `TIME_LIMIT_MAX` (1,440 minutes). Update `EXAMS_DB_AUDIT.md`,
`DECISIONS.md` and the demo seed. Keep the start gate (`not_open`, `deadline_passed`) unchanged: a start after the close is still refused.
Part of the A5-12 group with A6a-01.

### A6a-03 (Medium, correctness): archiving a live exam cuts off students who are writing

**Failure scenario.** A student is writing with 25 minutes left. The owner archives the exam. The student's next save and hand-in are
refused with `PT409 The exam has closed` (`deadline_passed`), and the try stays `in_progress` with time left. The work after the last save is lost,
and the student cannot hand in.

**Evidence.** `s9` saved, the owner archived the exam (`ok`, revision 3), then `exam_work save` and `submit` both gave
`ERR PT409 The exam has closed {"reason":"deadline_passed"}`; the try showed `status: in_progress, time_left: true`.

**Suggested fix (not done).** Let a started try finish after an archive (save, hand-in, auto-submit at its deadline); refuse only new
starts. This matters more under the full-time rule (A6a-01, A6a-02). Product question for the owner below.

### A6a-04 (Medium, abuse): one student can store about 225 MB of photos in one try; nothing lists abandoned uploads

`exam_upload` complete (`:1148`) checks size and type per file but not how many. `exam_storage_usage` has no caller.

**Evidence.** Student `s4` created 45 ready 5 MB answer photos in one try with no refusal (235,929,600 bytes). A pending upload that is never
completed stays for good: the bucket held 45 objects, one pending row, and no function or view lists expired exam uploads (the homework
side gets that from A5-03).

**Failure scenario.** 300 students at 40 photos each is 60 GB of Storage. A script does the same without a limit.

**Suggested fix (not done).** Cap about 40 ready unreferenced photos per student and exam (same as A5-03), and add an "expired exam
uploads" list (pending or unreferenced and ready, older than a day) for the cleanup script. Store the cap in one place with the homework cap.
Part of the same fix as A5-03.

### A6a-05 (Medium, performance): the teacher Exams page slows down as a teacher gets more courses

**Evidence.** `exam_portal`, open tab, owner: 174 ms with one course; 791 ms after 200 more courses and 400 more runs. For an assistant 179 ms
rises to 1,513 ms: 5,420 `current_app_user_id` calls, 2,007 `has_org_role`, 401 `can_support_offering`, 201 `can_edit_course`, per request. The time is
the per-row helper calls, not the exam data. The student list is similar: 200 `exam_settle` calls per 8 requests.

**Failure scenario.** A teacher with 50 courses opens the Exams page and waits over a second; the Home "Exams open now" card calls the same
read. The 8 s hosted limit leaves room, but 60 connections do not.

**Suggested fix (not done).** Part of the shared "my scope" fix (A0-01 and relatives): resolve the caller, the member roles and the courses
they run **once per statement** into a small set, and join the exams to that set instead of calling helpers per row.

### A6a-06 (Medium, product): a window that has opened cannot be extended, moved or given make-up time

`exam_lifecycle` reschedule and `exam_set_window` refuse once a window has opened (`PT409 window_open`), even when nobody has started.

**Evidence.** Same-time exam open now: extending the close by 2 hours gave `PT409 The exam has opened; its times are kept`. A per-Group
window that closed 7 days ago with no tries: `exam_set_window` gave `PT409 This Group's window has opened`. The only way out was
`unpublish`, which is possible only with no tries.

**Failure scenario.** A Group loses the room, a student is ill, the network fails: the teacher cannot extend the exam or give one Group make-up
time. The only options are a new exam or paper marks.

**Suggested fix (not done).** Product decision first (question below). Recommended: allow extending a close (never shortening below a
started try's deadline) and giving an ended Group a new window when it has no tries; keep the freeze for what a started try already
stored. This touches A6a-01 (the last close moves).

### A6a-07 (Low, correctness): rescheduling a published exam to a past day silently closes it

`reschedule` of an unopened published exam to 2020-01-01 returned `ok`. Its Group windows moved to the past (`closed: true`) and students were
refused with `The exam has closed`. No warning and no notice to the students.

**Suggested fix (not done).** Refuse a starting day before today (same check `exam_save` has for the day), or confirm.

### A6a-08 (Low, error handling): over-long text returns the raw database error and the failing row

`exam_save` with a 201-character title returned `23514 new row for relation "exams" violates check constraint "exams_title_check"
Failing row contains (…)`; a description of 8,001 characters did the same (`exams_description_check`). Part 5 found the same class (A5-05). The
message exposes the whole row and is not translated.

**Suggested fix (not done).** Check the lengths in `exam_check` and answer `23514` with a plain message and the field name.

### A6a-09 (Low, correctness): a refused late save says "This try was handed in" and rolls back the auto-submit

A student saves 5 seconds after the deadline: `PT409 This try was handed in` (`deadline_passed`), yet the try is still `in_progress`. The auto-submit that
`exam_settle` ran in the same call is rolled back by the error. The try is only submitted at the next read (`exam_get`), with
`auto_submitted: true`.

**Failure scenario.** A student sees "handed in" while the database says "writing". The teacher's queue shows the try as not handed in until
someone reads it.

**Suggested fix (not done).** Return the refusal without raising (or settle in a separate step before the check), and use the message
"time is up".

### A6a-10 (Low, lock): the first reader after the close pays for the whole exam, and the others wait

`exam_settle` takes the advisory lock `exam-settle` for the whole exam and does the auto-submit, the auto-release and the notices inside it.

**Evidence.** 392 open tries at the close: the first call (a teacher queue read) took 785 ms and auto-released 400 results with 400 notices; 20
students reading in parallel finished at 746, 776, 806, …, 1,286 ms, one after the other. No error; the cost is a second of waiting at the
worst moment.

**Suggested fix (not done).** Settle per student (advisory lock on exam and user) for reads, and move the exam-wide auto-release and
notices to one background run or batch. With A6a-01 the release moment also has to wait for the last started try.

### A6a-11 (Low, lock): a teacher editing a Group session holds up student starts, and a new Group costs a long deferred check

**Evidence.** A teacher held `FOR NO KEY UPDATE` on the Group's session for 1.5 s: a student start in that Group waited 1,536 ms (so a start
takes at least `FOR SHARE` on the session), and an exam rename queued behind that start (1,668 ms). A save by a student of another Group took 5 ms.
`exam_link_new_group` and `exam_link_new_session` are deferred; a new Group with 182 sessions took 3.4 s on the first run and about 80 ms
after that, with 26 published per-Group exams. `exam_materialize` stops at 100 Groups without a message; `materialize_group` locks the Group row
(A4-03) while the exam row is held.

**Suggested fix (not done).** Lock the session `FOR KEY SHARE`, or read it without a lock (the freeze trigger already stores times at the
open). Say so when the 100-Group limit is reached. Joins the A4-03 lock group.

### A6a-12 (Low, lock): no exam function sets `lock_timeout`

Same class as A0-06. `exam_save`, `exam_lifecycle` and `exam_set_window` take the exam `FOR UPDATE`; `exam_work` takes it `FOR SHARE` and then
an advisory lock per student, then `FOR UPDATE` on the try. Hosted `statement_timeout` is 8 s, `lock_timeout` is not set. During the
A0-09 test a teacher rename waited 2.0 s while 60 students saved without a pause.

**Suggested fix (not done).** Function-level `lock_timeout='3s'` on the authoring functions and map `55P03` to a retry message (same
as A0-06). No lock order problem was found: the order is always exam, then student, then try.

### A6a-13 (Note, product): small behaviours the owner may want to know about

- Fix-mistakes try 2 shows the first-try right answers as "kept" (24 of 40 in the test) while the exam is still open for other Groups. A
  student can tell a classmate which answers were right. Question below.
- A multiple-choice question is all or nothing (one of two right, or all four, gives zero). Same as homework; decided in `DECISIONS.md`.
- An online student who never starts has no result row, so the paper list shows them as "missing" but the results list does not.
- Auto-grading of a number question: tolerance 0.05 on 9.81 accepts 9.76 and 9.86, refuses 9.8601; −3 with tolerance 0 refuses
  −3.0000001. An empty or blank essay is scored 0 and marked corrected; an essay with text waits for the teacher.

### A6a-14 (Note, cleanup): dead code and what still calls the legacy exams (for Part 6b)

- `exam_storage_usage` has no caller (only its type in `shared/contracts/database.types.ts:2343`).
- The new exams do **not** use `media_assets` at all (photos go through `exam_uploads`). So the A0-02 leftover is decided: the revoke of
  `INSERT` on `media_assets` can include the exam path. The legacy runner still inserts into `media_assets` for `lms-submissions`
  (`server/services/exam-runner.ts:94`), which Part 6b retires. A student's insert naming another space was refused by a trigger
  (`Submission media has a different organization`).
- Functions that still mention the legacy tables: `private.notification_link` (legacy branch), `notification_business_event`,
  `demo_clear_core`, `check_lms_integrity`, `can_remove_lesson_upload`, `archive_unused_lesson_upload`.
- Legacy callers by file (Part 6b to confirm): `server/repositories/exam-security.ts`, `server/repositories/lms.ts`,
  `server/services/exam-runner.ts`, `server/services/exam-grading.ts`, `server/services/exam-authoring.ts`, `server/http/exam-runner.ts`,
  `shared/contracts/exam-listing.ts`, `frontend/features/exams/exam-result.tsx`, `exam-runner.tsx`, `frontend/lib/api.ts`,
  and scripts `exam-concurrency.cjs`, `exam-deadline.cjs`, `exam-runner.test.cjs`, `lms-load-test.cjs`, `teacher-foundation.test.cjs`.

## A0-09 re-check (renaming a live exam pauses answer saves)

Measured again with 393 tries: a detail-only save (rename, description) holds the exam row `FOR UPDATE` for a median 3.3 ms (max 28 ms), and
student saves take it `FOR SHARE`, so each save waits for it. Under 60 students saving without a pause one rename waited 2.0 s. Verdict: stays
**Low**. Fix as recommended in the row: `FOR NO KEY UPDATE` for the detail-only save (the student's `FOR SHARE` then becomes `FOR KEY SHARE`), which
removes the wait. The A0-09 row now carries this result.

## Checked and fine

Each check ran as role `authenticated` with Firebase-shaped claims, in its own transaction.

- **Grants, search path and tables.** All 14 private tables have row-level security on, no policy and no grant to any API role; `anon` and
  `service_role` cannot call or read anything. All `exam_*` functions are definer with `search_path=''`; no `LOCK TABLE`, no runtime DDL.
- **Before the window.** A student starting an exam that opens in 4 days got `PT409 not_open` with the opening time; `exam_get` of it showed the
  question count only, no questions, no keys. After the window: `PT409 deadline_passed`.
- **Keys, marks and results.** No try JSON, student read or paper sheet carries `correctOptionIds`, `modelText` or a mark before the review
  opens. Results show only after release. Staff `exam_get` shows keys; an assistant without rights does not get release or marking.
- **Starting.** Eight parallel starts by one student: eight `ok`, one try, one row. Two tabs cannot make two tries (advisory lock plus the unique
  open-try index). A suspended person or suspended enrolment is refused (`42501 Sign in required`).
- **Saving.** A save after the deadline and a submit after the deadline are refused. The question order is stored per try (shuffle) and never carries the key.
- **Photos.** Reads limited to the owner and staff (a classmate, an assistant of another run, a stranger and another space's owner saw 0
  rows); inserts only at the registered pending path of the caller; an insert after the deadline refused by row-level security; `complete`
  after the deadline refused (`Upload authorization expired`); a classmate cannot read the path (`exam_storage` returns false). There is no delete or update
  policy, so a student cannot remove or replace an object.
- **Staff and tenants.** Instructor, editor, assistant with and without rights, and the owner of another space were each refused or allowed as designed on
  `exam_get`, `exam_queue`, `exam_paper_sheet`, `exam_paper_mark` and `exam_release_many`. Paper marks for a student not enrolled, a student of another
  space, and a random id were refused. A student whose enrolment was suspended but who has a result row can still be corrected (kept on purpose).
- **Grading.** Single choice, multiple choice (exact set), numbers with tolerance, empty and blank essays, unanswered questions: as listed in A6a-13.
- **Time.** Cairo day starts are right across both daylight-saving changes (checked `2026-10-29/30` and `2027-04-29/30`, `2027-05-01`); windows are stored
  as UTC instants; a UTC server gives the same windows.
- **Windows.** Per-Group windows are created for a new Group and a new session (66, then 170 windows in the test); the freeze trigger stores the times
  when a window opens; a started try keeps its deadline when a session moves.
- **History.** Editing a published exam goes through a clone; submitted work is never rewritten.
- **Concurrency at 393 tries**, with a teacher renaming, reading the queue and releasing: no error, no deadlock.

## Could not verify

- **Hosted Storage.** The local `storage.objects` is a stub: the real bucket's 5 MB and type limits, signed-URL lifetime and the removal of
  files were not tested. The 45-photo proof used the row-level rules, not a real upload.
- **Hosted speed.** Numbers are from a 20-thread machine. On hosted (fewer cores, 60 connections) the 6 PM rush will be slower.
- **A real deadlock or lock chain beyond the ones shown** (session → start → rename): found no cycle, but only the paths above were driven with two or
  three sessions at once.
- **Notifications** beyond the event rows (no push worker locally). Daylight-saving behaviour of a window that spans the change itself was
  read, not driven in two sessions.
- **The A5-12 rule itself.** It is not built. A6a-01 was shown by moving windows and deadlines in the throwaway database, not by running new code.

## How the proofs were run

A disposable PostgreSQL 17.10 (`timezone=UTC`, port 55432) was built by replaying the bootstrap, seed and all migrations; synthetic users (owner,
instructor, editor, assistants, another-space owner, students s0–s400), 30 exams of 40 questions across 10 Groups, and 400 tries. Each check
ran in its own transaction as role `authenticated` with Firebase-shaped claims, as `supabase/tests/exams.sql` does. Locks were proved with
two to five sessions (held transactions and timed starts, renames and saves). The server and its data folder were stopped and deleted at
the end; the scripts lived in the git-ignored scratchpad and nothing was committed besides the three docs.
