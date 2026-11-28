# Fix track 3: the full-time rule and Protect answers

Branch `claude/fix-03-full-time` (from `claude/fix-02c-reports` at `edb029d`). Status: **done in the branch (code commit `9877bf8`), awaiting the dev
check.** Nothing was applied to any hosted project, merged or deployed. The owner's chat applies the migration to dev after review.

Findings: **A6a-01** (High), **A5-12**, **A6a-02**, **A6a-03**, **A6a-15** (exams), **A5-03**, **A6a-04** (Medium), **A6a-10**, **A8-07**, **A8-08**
(Low). Owner decisions of 2026-11-17 and 2026-11-28: `docs/ai/DECISIONS.md`, "Full-time rule and Protect answers".

Migration: `supabase/migrations/20261128140000_full_time_rule.sql` (after `20261128130000_reports_scope.sql`)
SHA-256: `92126e501afd9560ec2b257e848c7477e1e280c989d2d5323e96b096c5a867c1` (one new line in `scripts/migrations.sha256`, `-text` in `.gitattributes`).
One transaction. One new column (`private.exams.protect_answers boolean not null default true`: every existing exam reads ON the moment it is applied;
no backfill). No new table, index, policy or trigger. Nothing new is writable by the browser.

## What changed

### Exams

1. **Deadline (A5-12, A6a-02).** `exam_work` start and retry: deadline = start + time limit (no limit: the window close). It is no longer cut at
   the close. A start or retry at or after the close is refused exactly as before (`deadline_passed`), before the opening `not_open`.
2. **One "over" gate (A6a-01).** New `private.exam_over_at(exam)`: the later of the last window close and the latest deadline of a try still in
   progress (null while the last close is unknown). `private.exam_closed` now means "over" (`exam_over_at` has passed). Everything that asked
   "closed" follows it with no copy of its own: `exam_review_open`, `exam_released` (auto-release), `exam_settle`, `exam_queue`, `exam_release_many`,
   `exam_portal`'s tabs, `exam_student_list`, `exam_get`'s `closed`.
   - `exam_last_close` is unchanged: it stays the window close shown on screen (`lastClose`) and used by the reports to place an exam in time.
   - A result released by the rule (not stored yet) shows `releasedAt` = the moment the exam was over (`exam_over_at`), not the window close.
   - **Why a new helper and not `exam_last_close` itself** (Part 6a suggested that): `exam_last_close` is also the date students and the reports
     see. Moving it with every late try would move the exam's displayed close and its report month while students write. The gate needs the
     later moment; the screen needs the window. Two names, one rule each.
3. **Manual release (`exam_release_check`, the queue's `readyToRelease` through `exam_user_windows`).**
   - Old: the student's own window has closed and the student has no try in progress.
   - New: the same, **and** no try of that student's Group (same `window_group_id`; a same-time exam is one group) is still being written.
     A teacher can still release a whole Group that finished while another Group is still writing.
   - A released result is final for the student: `exam_work` refuses a new try (`no_tries_left`) once the result has `released_at`. So
     `exam_mark_try` (which clears `released_at` when a try's mark changes) is never reached by a student's later hand-in after a release: it
     cannot un-release or notify twice. Proof a checks one notice per result after every later read.
4. **Protect answers (A6a-15, decisions 4 and 6).** `private.exams.protect_answers` (default ON). Saved by `exam_save` (`protectAnswers`, a
   boolean rule like `autoRelease`: online only, refused on a paper exam, locked once a student started), read back by `exam_settings_json`
   (`exam_get`), copied by clone.
   - ON: the review (right answers, model text and picture, the marker's note) opens once the exam is over.
   - OFF: it opens for a student right after their own hand-in, never while that student has another try in progress.
   - The marker's note now shows with a released mark only while the review is open (it is part of the review).
   - The fix-mistakes try 2 keeps showing the kept answers whatever the setting (decision 6; unchanged code).
5. **Archive and unpublish (A6a-03, decision 3)** are refused with `PT409 {"reason":"students_writing"}`, "Students are still writing", while a
   window is open (same time: between opening and close; per Group: from the first opening to the last close) or a try is being written
   (`private.exam_writing`). Archive settles first, then checks. Upcoming exams can still be unpublished. **There is no exam delete action**
   (`exam_lifecycle` has publish, unpublish, clone, archive, reschedule; only the demo Clear deletes exams), so there was nothing to guard.
6. **Settle (A6a-10).** A student's read or write settles only that student's overdue try, under the (exam, student) lock their writes take,
   with `for update skip locked` (a try the batch is finishing is left to the batch). The exam-wide batch (every overdue try, then the
   auto-release with its notices and one audit row) runs on a staff read at any time, or on a student's read once the exam is over, under
   `pg_try_advisory_xact_lock`: one reader does it, every other reader skips it instead of queueing. Before releasing, the batch takes the exam
   row with `for no key update skip locked` (a start in flight holds it `for share`) and re-checks the gate. No worker or cron is involved
   (the notification worker is not running; nothing depends on it).

### Homework

7. **Grace (A5-12, decision 1).** A try created at or before the deadline may be saved and handed in until deadline + 30 minutes, on time
   (`missed_deadline` false). One constant: `private.homework_grace()`. The rule: `private.homework_is_late(at, deadline, started)`; the
   two-argument `homework_is_late` is unchanged and still decides "has the deadline passed" (solutions, start, retry). A start or retry after the
   deadline is refused as before. No homework time limit was added.
   - **The start time.** `homework_submissions.created_at` is the try's start: the browser cannot write the table (no grants; Track 1), and only
     `homework_work`'s start and retry insert rows (and the demo seed, with synthetic times). The insert now writes `created_at` from the same
     clock the deadline is checked with (`at_`), so a start a millisecond before the deadline is exactly "before". No new column was needed.
   - `get_homework` adds `graceUntil` (only while the caller's draft is inside its grace) and counts that draft as the try left. The student page
     shows "You have until HH:MM (Cairo time) to hand in." (en, ar).
   - `homework_students` (the teacher's list) needs no change: it reads `missed_deadline`, which the grace sets correctly.
   - **Edge left as is:** the teacher's "Delete images" (`homework_delete_images`) is allowed after the deadline and removes photos of handed-in
     tries only, so a draft in its grace keeps its photos.
8. **Solutions (decision 5).** Never while the caller's own try is a draft that can still be handed in (`private.homework_draft_open`), added
   to `homework_solutions_rule` and to `homework_unlocked` (the one gate of every solution read: `get_homework`, `homework_upload` get and
   Storage). `stop` already refused while the latest try is a draft. A classmate who handed in sees the solutions at the deadline even while
   another student is in grace. There is no homework Protect setting.

### Uploads (A5-03, A6a-04)

9. At most `private.upload_cap()` (40) ready photos nothing references, plus live pending ones, per student per homework and per student per
   exam. The 41st intent is refused `23514 {"reason":"too_many_uploads","max":40}`; both student pages say so (en, ar).
   - `private.expired_homework_uploads` (same columns) also lists ready unreferenced files older than a day.
   - New `private.expired_exam_uploads(id, exam_id, uploaded_by, path, status, expires_at)`: expired pending files, and ready files older than a
     day that no answer, question picture or model picture references. Closed to every role but its owner.
   - Both views are `with (security_invoker=true)`, like every private view (follow-up, 2026-11-28: the first version of this migration, sha256
     `794cfff3…`, replaced the homework view without the option, which `create or replace view` then drops).
   - **Listing only.** `scripts/lms-storage-maintenance.cjs` deletes only rows of `expired_homework_uploads` with `status='deleted'`; the new
     ready rows are never `deleted`, so it deletes nothing more than before. It does not read the exam view. Deleting is a later decision.

### Reports

10. `report_exams` (scoped) shows a mark exactly when `private.exam_released` says so (A8-07); `released_at` set is kept as a fast first case.
    The `lc` (last close) step is gone. `report_homework` (scoped) counts a draft started before the deadline and inside its grace as open,
    not missing (A8-08).

### App

- Wizard: the time-limit cap, its hint (`ex.w.limit_cap`), its issue (`limit_long`, `ex.w.issue.limit_long`) and `limitCap` are removed;
  `clampLimit(n)` keeps 1 to `TIME_LIMIT_MAX` (1,440). A **Protect answers from sharing** switch with an ON / OFF hint in the rules card, and on
  the review step. The auto-release hint and the release refusal say "once every student has finished".
- New words (en, ar): `ex.fail.students_writing`, `se.fail.too_many_uploads`, `homework.err.too_many_uploads`, `homework.grace_until`,
  `ex.w.protect`, `ex.w.protect_hint_on`, `ex.w.protect_hint_off`, `ex.w.r.protect_on`, `ex.w.r.protect_off`.
- The exam countdown already reads `deadlineAt` (`exam-screen.tsx`), so it shows the full time.
- Demo seed: unchanged. `demo_exam_try` already writes deadline = start + limit with no cut, so it never relied on the cap.

## Proofs

### Two sessions: `scripts/full-time-rule-concurrency.cjs` (in the runner, `LMS_SQL_ONLY=full-time-rule-concurrency`, about 17 s)

Real separate connections with Firebase identities; the close passes in real time (a 3 to 4 second window); times of 20 to 60 minutes are set
on the synthetic rows. All pass:

- **a.** A starts 10 minutes before the close with 60 minutes (deadline 59 minutes after the close). B hands in before. After the close B gets
  `closed: false`, `reviewOpen: false`, no right answers, the result `waiting`; a staff read releases nothing; 0 releases, 0 notices, 0 audit
  rows. A saves after the close, then hands in on one connection while B reads on another: still no review. Once A commits, B and C read at the
  same moment: B sees the review; 2 results released, 1 audit row, 2 notices; later reads (B, A, teacher) add none. The second half: A never
  hands in; once A's deadline passes, the next two simultaneous reads hand A in (`auto_submitted`) and release once.
- **b.** Protect OFF: B's review opens right after B's own hand-in (window still open). A sees try 1's review after handing it in, and not
  while A's try 2 is in progress.
- **c.** The fix-mistakes try 2 keeps the right answer of try 1, Protect OFF and ON.
- **d.** Archive and unpublish refused `students_writing` while E writes (window open, and after the close while E's try runs); archive accepted
  after E hands in. An exam nobody started: unpublish refused while open, accepted after the close. An archive waiting (a real lock wait) on
  the last hand-in is accepted when it commits.
- **e.** A start and a retry after the close: `deadline_passed`; a start before the opening: `not_open`; no try written.
- **f.** Homework: started 5 minutes before the deadline, saved and handed in at + 20 minutes (the hand-in waits on a real row lock): on time,
  `graceUntil` = deadline + 30 minutes. At + 31: save and hand-in refused `deadline_passed` (late off); handed in, flagged late (late on); no
  grace line. A start after the deadline refused. B (handed in before) sees solutions at the deadline while A is in grace; A does not; D (try 1
  handed in, try 2 a draft in grace) does not, cannot `stop`, and does once the grace ends.
- **g.** 40 ready unreferenced photos: the 41st intent refused `too_many_uploads` (homework and exam); a pending photo counts; after a day
  they appear in the expired views (39 homework ready, 40 exam); a referenced photo is never listed.

### One session: `supabase/tests/full-time-rule.sql` (33 checks, `LMS_SQL_ONLY=full-time-rule`)

The six new private helpers are definers with `search_path=''` and no grant to authenticated, anon or service_role; the replaced private
functions keep definer, empty search path and exactly their old grants (`create or replace` keeps ACLs: only the bodies behind the public
wrappers and `homework_unlocked`, used by Storage policies, are callable by authenticated, as before); the public entry points stay security
invoker, authenticated only; both cleanup views are closed; **every view in schema `private` has `security_invoker=true` in its reloptions** (fails on the first version of
the migration, passes now); the column is `boolean not null default true`; the grace is 30 minutes and the cap
40; six lateness cases; **every demo-fill exam reads back Protect answers ON** (column and `exam_settings_json`); save OFF, back ON, publish,
OFF again before anyone started; a clone copies it; a paper exam refuses it; a non-boolean is refused; the gate on synthetic rows (over at the
close, not over while a try runs past it, over when its deadline passes; `exam_last_close` unchanged).

### Old vs new: `scripts/full-time-rule-proof.cjs` (on demand)

`ftr_new` = the migrated template + `reports-scope.sql`'s demo fill and school A (13 exams, 530 tries, 631 results, 46 homework, 2,926
submissions, 123 active enrollments), every person a synthetic Firebase identity. `ftr_old` = a copy + `supabase/tests/full-time-rule-before.sql`
(the replaced definitions as the database had them, then the additions removed). Hosted limits: statement and lock timeout 8 s, UTC.

- **apply:** the migration on a copy of `ftr_old` gives exactly `ftr_new`'s functions (md5 of each definition and its ACL), views, columns with
  types and defaults, view options (`reloptions`) and policies. 28 catalog lines change; no policy. Also: no view loses an option it had before
  the migration, and every private view has `security_invoker=true`.
  - Why the first version passed it: the new database is built from the migration and the old one from that copy plus the before file, so
    the equality can never flag a property the migration itself drops; the before file had the same omission and `reloptions` was not
    compared. Now the before file keeps the option, `reloptions` is compared, and the two checks above compare old with new (on the first
    version they fail: `expired_homework_uploads` `[security_invoker=true]` → `[]`).
- **equiv: 10,965 reads compared, 0 differences.** Every student: `exam_student_list` (123), `exam_get` of each exam of their runs (876) and of
  each own try (524), `get_homework` (3,792) and with each own submission (2,824), `homework_submission_json` (2,824); and every row of
  `report_exams` (883 rows) and `report_homework` (3,592 rows) for all runs. Each read in its own rolled-back transaction; compared as JSON
  without `serverNow` and the new `protectAnswers`. One normalization: some fixture exams have an auto-release that is due but not stored, so
  the read itself stores it (old and new alike) at its own clock; a `releasedAt` later than the start of the comparison is compared as
  "released by this read" (without it, the 298 such fields differ by 30 to 50 ms and nothing else differs).

### Before → after

| Finding | Before | After |
|---|---|---|
| A6a-01 (Part 6a's evidence: s8 on try 2 past the close, two more writing, auto-release on) | s8's `exam_get(try 1)`: `reviewOpen true`, `closed true`, right answers and `modelText`; a classmate's result released (score 4 of 4); 6 results stored released while 3 write | `reviewOpen false`, `closed false`, no right answers or model text; the classmate's result `waiting`; 0 released |
| A6a-10 (400 students, 392 tries open at the close, auto-release on): first reader alone (a teacher queue read) | 459 ms, 400 released, 400 notices | 450 ms, 400 released, 400 notices |
| A6a-10: 20 students reading at the same moment (fresh copy) | one after the other: 84, 105, 125 … 537 ms; afterwards 372 tries still open, 28 released, 20 auto-release audit rows (each reader released what was corrected so far) | 19 readers 51–75 ms, the one that took the batch 452 ms; afterwards 0 open, 400 released, 400 notices, 1 audit row |
| A6a-02 / A5-12 exam deadline | `least(close, start + limit)` | start + limit (proof a: 59 minutes past the close) |
| A5-12 homework | a save or hand-in after the deadline refused (late off) or flagged late | on time until deadline + 30 min for a try started before it |
| A6a-03 archive / unpublish while writing | accepted; the writing student's save and hand-in then refused | refused `students_writing` |
| A5-03 / A6a-04 photos | unlimited ready unreferenced photos; never listed | the 41st refused; listed after a day |
| A8-07 | `report_exams` repeated the release rule (window close) | calls `exam_released` |
| A8-08 | a draft in grace counted `missing` at the deadline | `open` until the grace ends |
| One student exam read (`exam_get` of a released exam), median of 15, fresh connection | 31 ms | 25 ms |
| One student homework read (`get_homework`), same | 23 ms | 19 ms |

The A6a-10 numbers are on this machine; Part 6a measured 785 ms and 746–1,286 ms on its own run, so compare old with new within the table.

## Tests

- **New:** `supabase/tests/full-time-rule.sql`; `scripts/full-time-rule-concurrency.cjs` (mapped to `exams`, `exams-student`, `homework-rules`,
  `full-time-rule`); `supabase/tests/full-time-rule-before.sql` and `scripts/full-time-rule-proof.cjs` (steps `FTR_ONLY=build,apply,equiv,a6a10,a6a01,time`,
  `FTR_KEEP=1`; results in `.local/full-time-proof/result-<steps>.json`; each step under 10 minutes).
- **Changed on purpose (the rule changed, not to make a test pass):**
  - `scripts/homework-rules-concurrency.cjs` steps 5 and 6 ("a hand-in that waits past the deadline") now set the try's start an hour back and
    the deadline 30 minutes minus 1.5 seconds back, so the wait passes the end of the **grace**. Same assertions (refused / flagged late).
  - `scripts/teacher-exams.test.cjs`: the cap assertions (`limitCap`, `clampLimit(45, 30)`, `limit_long`) are replaced by: a limit longer than the
    window is no issue, `limitCap` is gone, `clampLimit` keeps 1 to 1,440; `limit_long` leaves the words list.
- **Unchanged and passing:** `exams`, `exams-student`, `exams-demo`, `exams-concurrency`, every `homework*` suite and race, `reports`,
  `reports-demo`, `reports-scope`, `my-scope-2b` (its `get_homework` comparison still matches: `graceUntil` is only there inside a grace),
  `direct-access-closed`, `scripts/direct-access.test.cjs` (allow-list still empty).

## What the owner's chat must check on dev

1. **Apply** `20261128140000_full_time_rule.sql` after `20261128130000`. The SHA-256 is above.
2. **The column:** `select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='private' and
   table_name='exams' and column_name='protect_answers'` → `boolean`, `NO`, `true`; `select count(*) filter (where not protect_answers) from
   private.exams` → 0.
3. **Function hashes** (`select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='private'::regnamespace
   and p.proname in (…)`):

   | Function | md5 |
   |---|---|
   | `exam_over_at(uuid)` (new) | `b30c6cae1960bffdeb89a62187831b3b` |
   | `exam_writing(uuid)` (new) | `30c3cf31332011be8de4cc9b6f622e6c` |
   | `homework_grace()` (new) | `be47fd7940b7789b72076d18a69272f1` |
   | `upload_cap()` (new) | `e2bdf3680337245a7606344b743e77e2` |
   | `homework_is_late(timestamptz,timestamptz,timestamptz)` (new) | `f6c1c5ad95bdae8d1672a14dcda43381` |
   | `homework_draft_open(uuid,uuid)` (new) | `61db9b7de6275b0289607e23478e7603` |
   | `exam_closed(uuid)` | `a6c0f84e75318369ae3d8cc8b6b994b8` |
   | `exam_review_open(uuid)` | `8e343ae9f65620b91c6be3d8c7b33caf` |
   | `exam_release_check(uuid,uuid)` | `8dca40211f310bf554c4a8e76185c737` |
   | `exam_user_windows(uuid)` | `cadb09dc47a6928ee25680d9312f235d` |
   | `exam_settle(uuid,uuid)` | `f4869c3c7867c128d62797728064aa1e` |
   | `exam_settings_json(uuid)` | `ab2b8a4b44356f326a0613f9d20957b7` |
   | `exam_save(uuid,uuid,bigint,jsonb)` | `971f69aea1ce5ccd547cd9ba0295a509` |
   | `exam_work(uuid,text,bigint,jsonb)` | `d06208dbef6f44a1531649c7ec23465c` |
   | `exam_get(uuid,uuid)` | `22f18090670e8ccc563d5ee2f162ef04` |
   | `exam_attempt_json(uuid)` | `116674d01be2d256454e57b537533692` |
   | `exam_lifecycle(uuid,text,bigint,jsonb)` | `8fa93f4efc91794aef33957a61a6e537` |
   | `exam_upload(uuid,text,uuid,jsonb)` | `184822b0c6f765cb6f7d35f042d71400` |
   | `homework_solutions_rule(uuid,uuid)` | `5be0334cf5f7a1b4ea254428c3b3e18c` |
   | `homework_unlocked(uuid)` | `ece521a22e653a0c98ae18235cecd5cb` |
   | `homework_work(uuid,text,uuid,bigint,jsonb)` | `488a75ae7650ffa4b6fc44275409447e` |
   | `homework_upload(uuid,text,uuid,uuid,jsonb)` | `f7e456b67c85d0d6ccc4ffac752ee78a` |
   | `get_homework(uuid,uuid)` | `5e7161f53a3f18bde416b8da8aa7e748` |
   | `report_homework(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)` | `a778f1da1db59a8b9781bcf8a3a50d38` |
   | `report_exams(uuid[],timestamptz,timestamptz,uuid[],uuid,boolean)` | `d4e71a6b43bcd48f123d825aaa64cf89` |

   Views (`md5(pg_get_viewdef(…))`): `private.expired_homework_uploads` `e76ffff9c717dd368e1d5b43f81e921f`, `private.expired_exam_uploads`
   `05c3c5b718770be5247b83a268d66676`. **Both views have `reloptions` `{security_invoker=true}`** (`select oid::regclass, reloptions from
   pg_class where relnamespace='private'::regnamespace and relkind='v'`: all three private views, with `expired_media_uploads`). Hashes are of this local PostgreSQL 17; if dev's server prints a definition differently, compare the text.
4. **Grants:** the six new functions have `proacl = {postgres=X/postgres}`; the replaced ones keep their ACL; `select has_table_privilege(r,
   'private.expired_exam_uploads','select')` is false for `authenticated`, `anon`, `service_role`. Policies: `select count(*) from pg_policy` is the
   same before and after (none touched). `scripts/direct-access.test.cjs` stays green.
5. **On dev, with demo or synthetic people (never a customer's):**
   - An exam closing while a student writes: a classmate who handed in sees no right answers and no mark until the last student hands in;
     then once (one notice each).
   - Protect answers OFF on another exam: right answers right after hand-in.
   - Archive or unpublish a live exam: "Students are still writing" (en and ar).
   - The wizard: no "At most … the shortest window" hint; a 90-minute limit on a 60-minute window saves; the switch is ON for every existing
     exam.
   - Homework: start before the deadline, hand in within 30 minutes after it: on time, and the line "You have until HH:MM (Cairo time) to hand
     in." shows in the grace.
6. **Speed in the logs:** a student exam read and a homework read unchanged; at the close of a big exam, one student read pays for the batch
   and the others answer at the usual speed.
