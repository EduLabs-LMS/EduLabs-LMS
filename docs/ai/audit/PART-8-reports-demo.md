# Part 8: reports and demo data

Audit only. Branch `claude/backend-audit`, started at `5e89d7d` (2026-11-18). No code, migration, test or config was changed. No
connected Supabase project, VPS, Firebase, Brevo or push service was touched. Every proof ran on a disposable local PostgreSQL 17.10 on
loopback (`timezone=UTC`, all 52 migrations of this tree replayed), with hosted-like limits (`authenticated` statement and lock timeout 8 s,
`anon` 3 s, `max_connections` 60, `idle_in_transaction_session_timeout` 0, `service_role` none). The server and every database were
stopped and deleted at the end. All people and numbers below are synthetic.

## Summary

- 14 findings: 0 High, 3 Medium, 8 Low, 3 Note. Two carry an **Owner question** (A8-03, A8-05).
- **The reports are correct where it matters.** Every number I worked out by hand matched: not-marked is never counted as absent, cancelled
  and not-yet-finished sessions are skipped, a student who joined mid-term is not charged for earlier work, a draft lesson and an open
  homework are not counted, only released exam results show (the report asks the same rule as the student, 8 cases), the Cairo month and the
  October 2026 clock change are exact (4 boundary sessions, 4 session time zones, identical output), and nothing divides by zero.
- **Nobody outside the course team can read a report.** 9 callers × 15 calls, every parameter: a teacher, assistant or owner of space B gets
  `42501` on space A and the other way round; a student, anon and a suspended teacher get `42501` on all of them. The reads take no row locks
  and cannot block a save.
- **The weak spots are three.** (1) A student who is suspended and reactivated loses their earlier homework and exams from every report
  (A8-01, the same root as A3-04). (2) A Group read costs the whole course run, so a big, old Group times out on "Whole course" (A8-02).
  (3) A homework that is still open counts only the students who already handed in, so it shows 100% and then drops at the deadline (A8-03).
- **Demo data is well fenced.** Only a platform administrator can run mark, fill, clear; a real space, a random id, a space with a real
  student, a space with an enrolled student at Clear time are all refused with nothing changed; two clears at once are safe; a fill cut off
  halfway leaves zero rows; demo students have no sign-in, no email, no push. The problems are small and cosmetic (dead notice links, photo
  rows with no file, data that ages) and are listed so the planned "realistic demo" starts from facts.
- Speed for the stated size (1 teacher, 3 Groups × 30 students, one year) is fine: the slowest report read is 172 ms. It grows with the size
  of the whole space for some reads (A8-04) and with history for the whole-course views (A8-02).

## Inventory

### Migrations and live files

| What | Live file : line |
| --- | --- |
| `report_caller`, `report_pct`, `report_sessions`, `report_homework`, `report_exams`, `report_facts`, `report_stats` | `20261117120000_reports.sql:22, 53, 65, 75, 104, 151, 160` |
| `report_bounds`, `report_reasons`, `report_reason_count` (replaced: last 4 weeks, attention is a count) | `20261118120000_reports_last_4_weeks.sql:12, 24, 33` |
| `report_groups`, `report_group`, `report_attention`, `report_student`, `report_course` | `20261117120000_reports.sql:178, 209, 254, 286, 316` |
| Grants (all 5 public wrappers: `authenticated` only; the 12 private helpers: nobody) | `20261117120000_reports.sql:349-370` |
| Demo registry, mark, fill, clear, status (platform administrator only) | `20261027120000_demo_spaces.sql:12-224` |
| Live `demo_fill_core` (seed version 9), `platform_demo_status` | `20261119120000_live_class.sql:337, 609` |
| Live `demo_clear_core` | `20261114120000_exams.sql:1454` |
| Demo homework and exam helpers | `20261109120000_homework_teacher_rules.sql` (`demo_homework_make/try`), `20261115120000_exams_drafts_and_demo_v7.sql:215-290` |
| Five seeded notices | `20261116120000_demo_seed_8_and_notice_links.sql:122-135` |
| Allowed table list of the registry | `20261119120000_live_class.sql:330-331` |

### Server and frontend

| File | Role |
| --- | --- |
| `server/http/teacher-reports.ts`, `server/services/teacher-reports.ts`, `shared/contracts/teacher-reports.ts` | five GET routes, `month` is `YYYY-MM` or `all`, nothing means last 4 weeks; Groups list sends up to 100 ids per call (`GROUPS_PER_READ`) |
| `server/services/teacher-home.ts`, `teacher-course-page.ts` | Home and the course page do not call any report function; they use `group_view`, `student_administration('metrics')`, `homework_portal`, `exam_portal`, `space_is_demo` |
| `server/services/course-statistics.ts` | legacy Prisma code, not a report read (Part 9) |
| `server/services/demo-space.ts`, `platform-demo.ts`, `server/http/platform-admin-demo.ts` | the demo routes: status, mark, fill, clear; the database refuses anyone who is not a platform administrator |

## Findings (worst first)

### A8-01 Medium, correctness: Suspend then Reactivate makes every report forget the student's earlier homework and exams

`report_homework` keeps a student only if `e.enrolled_at <= the homework's date` (`20261117120000_reports.sql:94`), and `report_exams` the same
(`:127, :133`). Reactivating an enrollment sets `enrolled_at = now()` (`20261106120000_listing_performance.sql:291`; this is A3-04).

**Proof** (real `student_administration` suspend then reactivate, Student A, 6 sessions, 5 homework):

| Student page, whole course | Before | After reactivate |
| --- | --- | --- |
| Homework done / given / average | 3 / 4 / 80% | **1 / 1 / none** |
| Homework list | 4 items | **1 item** |
| Attendance | 4 of 6 | 4 of 6 (sessions use the Group membership, not the enrollment date) |

So the same student page shows all their sessions but only one homework. The Group page, the Students screen and the attention rule use the
same facts, so a student who stopped doing homework before the pause is no longer flagged.

**Impact.** A teacher sees a clean record after a pause; "Needs attention" misses the student.
**Fix.** The A3-04 fix (keep the first enrollment date; a reactivation must not move it). Add one test: suspend, reactivate, the student page
keeps the same homework list. Group: A3-04.

### A8-02 Medium, performance: a Group read costs the whole course run, so "Whole course" times out for a big, old Group

`report_group` builds the facts of the **whole run** and filters afterwards (`:216` `where group_id=p_group`); `report_student` and
`report_course` read the whole run too, and "Whole course" (`month=all`, a choice in the screen: `frontend/features/teacher-reports/parts.tsx:34`) removes the
date window.

**Proof** (teacher's own calls, hosted limits, median of 3):

| Size | Last 4 weeks | Whole course |
| --- | --- | --- |
| 3 Groups × 30 students, 72 sessions, 40 homework, 8 exams per Group (the stated size) | `report_group` 42 ms | **172 ms** |
| same, 20 teachers in the space (23 runs, 130k attendance rows) | 42 ms | 108 ms |
| 1 run, 10 Groups × 200 students, 72 / 40 / 8 (144k attendance rows) | `report_group` 153 ms | **2,276 ms**; student page 921 ms; Results 1,084 ms |
| same, 3 years of history per Group (216 / 120 / 24; 432k attendance rows) | `report_group` 229 ms | **timeout (57014 at 8 s)**; student page 3,758 ms; Results 4,242 ms |

At the stated size nothing is slow. A big school with three years in one run fails the "Whole course" tab.

**Impact.** The tab shows an error exactly for the teachers with the most history.
**Fix.** (recommended) Pass the Group (or the student) into `report_sessions`, `report_homework`, `report_exams` so the read touches only that
Group's students and sessions; limit "Whole course" to the run's current school year if it is still above 1 s afterwards. Keep the last-4-weeks
window as is. Group: "my scope".

### A8-03 Medium, correctness and product: a homework that is still open counts only the students who already handed in

`report_homework` marks a student `done` as soon as a submission exists, `missing` only after the deadline, otherwise `open` and **not counted**
(`:96`); the percentage is `done / (done + missing)` (`report_stats`, `:165-168`). So before the deadline the Group's homework percentage is
"of those who handed in, how many handed in": always 100%.

**Proof** (Group of 5, one open homework, 1 hand-in; Groups list, last 4 weeks): `homework {"pct":100,"done":1,"given":1}`. At the deadline the
other 4 become `missing`: 1 of 5 = 20%. The student page for the one who handed in shows "done"; the same percentage jumps for everyone at the deadline.

**Impact.** A teacher looking at last night's homework sees 100% and a few hours later 20%.
**Owner question.** Should a homework that is not yet due count in the Group's homework percentage?
- (a) **Recommended:** no. Count a homework only after its deadline; show the open one as "3 of 30 handed in so far" next to it. No jump.
- (b) Keep as is (it counts only students who handed in early).
- (c) Count it from the start with everyone who has not handed in as "not yet" (the percentage then rises until the deadline).

**Fix.** With (a): a handed-in open homework gets `state='open'` in the percentages and stays visible in the list as "handed in".

### A8-04 Low, performance: some reads grow with the size of the whole space and are over 1 s in a big space

Teacher's own reads, hosted limits, median of 3 (ms). Spaces of 1, 20 and 50 teachers, each teacher with 3 Groups × 30 students, one year:

| Read | 1 teacher | 20 | 50 |
| --- | --- | --- | --- |
| Home / Groups overview `group_view()` (teacher) | 41 | 385 | **995** |
| Home upcoming `group_view(upcoming)` (teacher) | 15 | 371 | **965** |
| `report_attention`, all courses (teacher) | 34 | 80 | 173 |
| `homework_portal`, `exam_portal`, `student_administration('metrics')` (teacher; owner at 50) | 14 / 20 / 17 | 89 / 84 / 60 | owner: 345 / 599 / 76 |
| `report_groups`, 3 Groups (teacher) | 51 | 46 | 52 |
| Space **owner**: `report_groups` with 100 Groups | | 750 (60 Groups) | **2,018** |
| Space **owner**: `report_attention`, all courses | | 280 | 760 |

The Home reads cost the size of the space, not the teacher's own data: the "my scope" pattern (A0-01). The group reads are already in A4-01. The
two report reads that are new: the owner's `report_groups` (100 Groups per call, `GROUPS_PER_READ`) and `report_attention` for all courses (it
works out every active student in every run, then keeps 25). `report_groups` and `report_attention` are not slow for one teacher.

**Fix.** The A4-01 / A0-01 "my scope" fix covers `group_view`. For the owner's list: send 25 Groups per call (the list page size), not 100.
For attention: filter by the run first (the Students screen already can). Group: "my scope".

### A8-05 Low, product: suspended and removed students stay in the Group's totals and in "Everyone", with no status

`report_sessions` has no enrollment filter at all (`:65-73`), so every attendance mark counts, whatever the student's status is now.
`report_homework` and `report_exams` include `status in ('active','completed','suspended')` (`:94, :127, :133`). The "Needs attention" list
skips non-active students (`where active and n>0`, `:244`), but the Group payload carries no status field for a row.

**Proof** (September, Group One; C suspended, D removed): the Group page lists 5 students, C and D among them with no label; Group attendance
60% = 9 present of 15 marks, which includes C (2 of 5) and D (2 of 3). C and D are never flagged. The student page of D is refused
(`42501 Student unavailable`), so clicking a removed student's name in "Everyone" fails.

**Impact.** A paused or removed student's past absences pull the Group's percentage down, and the teacher cannot tell why or who they are.
**Owner question.** How should a suspended student show in the Group's numbers?
- (a) **Recommended:** they stay listed in "Everyone" with a "Suspended" or "Removed" label, and their marks are left out of the Group's
  percentages from the day they stop being active.
- (b) Keep as is (all past marks count, no label).
- (c) Hide suspended and removed students completely.

### A8-06 Low, correctness: "Missed N sessions" on the Students screen adds up Groups, the Group pages do not

`report_attention` works out one row per student across the whole run (`report_stats(...,false)`, `:271`); `report_group` and `report_groups` work
out one row per student **per Group** (`true`). A student who changed Group has their absences split.

**Proof** (Student R2: absent once in Group One, then moved and absent once in Group Three, last 4 weeks):

| Screen | What it says |
| --- | --- |
| Students screen (`report_attention`) | **flagged "Missed 2 sessions"** |
| Student page | attendance 1 of 3 (agrees: 2 missed) |
| Group One page | attendance 1 of 2; R2 not flagged |
| Group Three page | attendance 0 of 1; flagged only for the exams (`exam_absent`), not for missing |
| Groups list | Group One: 1 flagged (R1), Group Three: 1 flagged (R2, exams) |

**Impact.** A teacher clicks "Missed 2" and finds one miss on each Group page.
**Fix.** (recommended) Say on the Students screen which Group each miss belongs to ("Missed 2 sessions: 1 in Group One, 1 in Group Three"), or
count attention per run on every screen. Group: reports (small).

### A8-07 Low, drift risk: `report_exams` repeats the release rule instead of calling `exam_released`

`report_exams` writes the rule again: `r.status='corrected' and r.score is not null and (r.released_at is not null or (auto_release and
lastclose<=now))` (`:140`) while the student's own rule is `private.exam_released` (`20261114120000_exams.sql:446`: corrected, and released or
`auto_release and exam_closed`). Today they agree (proved on 8 results: released by hand, auto release after the close, unreleased, paper
unmarked, absent, retake; the report showed `marked` exactly where `exam_released` was true). The A5-12 / A6a-01 / A6a-15 group changes
`exam_released` and `exam_closed`; a report that keeps its own copy would then show scores the student cannot see, or hide ones the student can.

**Fix.** Call `private.exam_released(r.rid)` in the report (one definition). Add it to the A6a-01 group. Group: A5-12 + A6a-01.

### A8-08 Low, dependency: a homework turns "missing" at the deadline even though the A5-12 rule lets a student who started before it keep writing

`:96` uses `deadline_at <= clock_timestamp()` only. After the A5-12 decision (a student who starts before the deadline gets their full time) a
student who is still writing would be counted missing, and flagged, until they hand in.

**Fix.** In the A5-12 group: a draft started before the deadline and still inside its time is `open`, not `missing`. Group: A5-12.

### A8-09 Note: small behaviours of the numbers

- There is no "excused": a session mark is `attended`, `absent` or `not_marked` (`session_attendance_status_check`). Not-marked is never counted.
- A late hand-in counts as done and is not flagged; the student page shows only done, missing, open.
- The exam percentage is points-weighted (sum of scores over sum of maximums), so one 50-point paper outweighs a 12-point quiz; the summary
  "exams" count is exams, the student line counts results. `report_student` and `report_group` agree with each other (checked).
- "Needs attention" is a count: 2 or more absences, 2 or more missing homework, exams under 50%, or one absent exam
  (`20261118120000_reports_last_4_weeks.sql:26-29`). Two absences flag a student with 28 sessions at 93%. It is stable (same inputs, same
  flags), explainable (the reason is shown with its number) and agrees with the student page, except for A8-06.
- Lists are capped: "Everyone" 300 (`:246`), attention 25 a page; the totals are sent so the screen can say so.
- A student in two Groups of the same course is not possible at the same time (`group_memberships_one_active`); one who moved is A8-06.

### A8-10 Low, correctness: three of the five seeded notices have a Group id as their target, and all five land in the real owner's bell

The fill inserts five notices for the space owner directly (`20261116120000_demo_seed_8_and_notice_links.sql:122-135`, still in the live
fill). `support_reply`, `exam_released` and `homework_released` get `g1`/`g2` (Group ids) as `resource_id`; no ticket, result or submission has that id.

**Proof** (local, filled space): `notification_link` is NULL for all five for the owner; the owner's bell lists 5 notices, 0 with a link; the
three resources match only a Group. Nobody else receives them (0 for any other real user); Clear removes them (0 left). No push is queued
(`deliveries` 0; the fill bypasses `emit_notification`).

**Impact.** The teacher who is shown the demo opens a notice and nothing happens (same class as A7-10).
**Fix.** Point the notices at real demo rows (a demo ticket, result, submission) or take the three out of the seed. Group: notification read.

### A8-11 Low, correctness: 22 demo photo answers have a database row but no file

The demo homework adds 22 `homework_uploads` rows with status `ready` and a path (`<assignment>/<upload>/resource.jpg`, sizes about 1 MB);
`storage.objects` holds 0 files after the fill. Opening such a photo would find nothing. The paths are generated from the demo assignment ids, so
they cannot collide with a real space's files, and Clear removes the rows (0 left), so no storage cleanup is needed.

**Fix.** Either ship one small shared demo image per space and store it under the demo path, or mark the demo photo answers as text-only. This is
part of the "realistic demo".

### A8-12 Low, product: the demo ages; after 7 days there is no upcoming class and homework turns "missing"

All dates are relative to the moment of the fill (`now()` 39 times in `demo_fill_core`, 0 fixed calendar dates): sessions from 9 days before to
7 days after (local run: 2026-11-09 → 2026-11-25 on 2026-11-18, 4 past, 6 future), homework deadlines the same. After a week "Upcoming" is empty;
after 4 weeks every last-4-weeks report is empty. The status reports the seed version, not the age. Refresh needs two clicks (Clear, then Fill).

**Fix.** Show "filled N days ago" in the demo status; add one "Refresh" action that clears and fills in one transaction. Group: demo.

### A8-13 Note: demo students are real `profiles` rows with no identity

28 demo students per space: rows in `profiles`, enrollments and Group memberships; **0** external identities, **0** auth users, **0** push
subscriptions, so none can sign in, receive mail or push (119 in-app notices are written for them through the real events; 85 events; no delivery
row). They appear in any count of `profiles` (42 in the test: 28 demo, 14 real). No platform total or limit exists that counts students
(no seat or quota column anywhere in the migrations), so nothing is distorted today. A future platform total must filter on `demo_seed_rows`.

### A8-14 Note: a real student enrolled in a demo space blocks Clear

Clear refuses while a real student is enrolled in the space (409 "enrolled students"; the demo rows stay: 996). Fill is refused too ("already
present") and so is turning demo off ("clear the demo data first"). Correct as a guard; the way out is to remove the real student first.

## Fix groups

| Group | Findings | Ships with |
| --- | --- | --- |
| Reactivation date | A8-01 | A3-04 |
| "My scope" and run-scoped reads | A8-02, A8-04 | A0-01 / A1-01 / A4-01 |
| Release and grace rules in the numbers | A8-07, A8-08 | A5-12 + A6a-01 group |
| Product rules for the numbers | A8-03, A8-05 (owner questions), A8-06 | reports (small) |
| Demo polish | A8-10, A8-11, A8-12 | the "realistic demo" task |

## Checked and fine

- **Attendance** (hand-computed, September 2026, 5 students): present 4/5, 1/2, 2/5, 2/3, none; a cancelled session, a draft (not
  finalized) session and a future session are not counted; a session at 00:30 Cairo on 1 September counts in September although it is 21:30
  UTC on 31 August; a student who joined on 15 September is charged only from then; a suspended or removed student's past marks still count (A8-05).
- **Homework**: a draft lesson, a draft homework and a homework of an unpublished course are not counted; a legacy homework with no deadline
  uses its creation date; a homework nobody handed in is `missing` after its deadline; graded and released shows the score (8/10), handed-in
  and ungraded shows "waiting"; a later hand-in replaces the earlier one (one per student).
- **Exams**: only released results count (8 cases match `exam_released`); a student who did not take it is `absent` after the last window,
  `pending` while a try is in progress; a re-take shows one result (the final try); a paper exam unmarked is `waiting`; an unreleased score never
  appears in any report field; and a student cannot call any report function (all 5 give `42501`).
- **Time**: month bounds are Cairo calendar months; the October 2026 change (+03 to +02 on 2026-10-29) put 4 boundary sessions in the right
  month; the last 4 weeks is 28 Cairo days ending tomorrow 00:00 (2026-10-22 00:00 +03 → 2026-11-19 00:00 +02 today); output identical under four
  session time zones (UTC, Cairo, Kiritimati, Los Angeles).
- **Edge maths**: a student with no sessions shows no percentage, not 0 or an error; 0 given homework gives no percentage; all percentages are 0
  to 100; a Group with no students and a course with no run return empty lists; a month `2026-13`, `2099-01`, text with a quote, 0 or 101 Groups,
  a negative or huge page, a null student: refused with `23514`/`42501`, no SQL error; duplicate Group ids are accepted once.
- **Tenant isolation** (E5, 9 callers: owner, assistant of the run, teacher without the run, course editor, owner of another space, student,
  removed teacher, suspended teacher, signed-in user without a profile × 15 calls: Groups of A, B and mixed, one Group, an unknown Group,
  attention for a run, for another space's run, for all my runs, student of A or B in a run of A or B, course A and B): only the intended
  rows answer; anon: `42501` on all; the 12 private helpers are not callable by any user. Authorization is run-level
  (`can_support_offering`): an assistant of the run sees every Group of that run; `group_staff` narrows only who may change a Group, not who may read
  its report. This matches the product (assistants help the whole run); it is listed so nobody assumes Group-level read scoping.
- **Locks** (E8): all 17 stable report functions contain no `for update`, no insert, update or delete; a heavy report transaction (300 ms, left open)
  held only `AccessShareLock` on 122 relations, and 3 writes to the same attendance, session and submission rows finished in 15 ms with
  `lock_timeout` 500 ms while it stayed open.
- **Demo** (E9, E10): who: platform administrator only; teacher, owner of the space, assistant, student, an administrator with `active=false`
  and anon all refused (`42501`), `service_role` without a user refused; a random id, `null`, a real unmarked space: `409`; marking a space without
  an invitation: `404`; with a real student: `409`; the real space's courses, runs, Groups, enrollments and members hash the same after every
  refused call; Clear removed 1,568 rows and 267 support rows and left a real course inside the same space; two Clears at once: the second
  waited 275 ms and removed 0; a fill cut off at 60 ms left 0 rows (one transaction); a second Fill is refused; Fill 396 ms, Clear 22 ms, 996
  tracked rows; nothing in `storage.objects`; no impossible states (0 attendance on a future session, 0 future hand-ins or attempts, 0 members
  before their enrollment, 0 results released in the future, 0 results on an unpublished exam); the 2 unfinalized past sessions, 22 corrected-
  unreleased results and 4 late hand-ins are intended seed content.

## Facts for the planned "realistic demo" (question 17)

What helps:
- Every row is tracked in `private.demo_seed_rows` and Clear deletes by that registry, so any new seed content is removable if it is tracked
  (`private.demo_track`, `20261027120000_demo_spaces.sql:48`).
- The seed uses the real functions' tables, so every screen (reports included) works on it; dates are relative to now (A8-12).
- Fill and Clear are one transaction each and refuse a space that is not marked or holds a real student; Fill 0.4 s, Clear 0.02 s.

What blocks or costs:
- The size is hard-coded: 2 Groups, 14 students each (`for n in 1..14`, `20261119120000_live_class.sql:425`), 28 students everywhere, 10 sessions
  (`1..10` at :469), 5 homework, 5 exams; the notes mention "students 1-14 / 15-28" so a different number means editing many lines.
- The whole seed is one 23 KB function that each migration replaces (`create or replace` in 20261027, 20261030, 20261031, 20261104, 20261113,
  20261115, 20261116, 20261119): a change is a new migration that copies the whole body.
- The registry has a fixed table list and a unique `(table_name,row_id)` (`20261027120000_demo_spaces.sql:26-28`, widened in
  `20261119120000_live_class.sql:330-331`): a new kind of row needs a new migration to be allowed.
- `demo_exam_try` cannot add a second try for the same student and exam: it writes the result row again and hits the unique key (proved: the
  second call fails with a duplicate); my proof had to delete the tracked result rows between calls.
- Dead notice targets and file-less photos (A8-10, A8-11) must be solved with the seed, not after it.
- A student can be in only one Group at a time (`group_memberships_one_active`), so a realistic "student changed Group" story needs a closed
  first membership (exactly what A8-06 needs for a test).
- Names are `Demo Student N` and `Demo Group N`; there is no list of realistic names.

## Could not verify

- Behaviour on the hosted database (plan choices and speed). Numbers are from the local replay, in the same order of magnitude; the hosted limit
  is the same 8 s.
- Whether the demo photo link shows an error or an empty frame in the browser (the row exists, the file does not; I did not open a browser).
- Whether the platform-admin demo route's HTTP layer refuses a non-administrator before the database does (the database refuses in every case;
  the route code is Part 9).

## Seen, belongs to Part 9

- `server/services/course-statistics.ts` is legacy Prisma code with no report callers left (confirm and delete in the cleanup).
- The demo routes' HTTP authorization (`server/http/platform-admin-demo.ts`) and their origin check.

## How the proofs ran

A disposable PostgreSQL 17.10 (embedded binaries from `.local/step03a/runtime`, data directory in the session's scratchpad, port 54898,
`timezone=UTC`, `max_connections=60`, `idle_in_transaction_session_timeout=0`). The 52 migrations were replayed in file order exactly as
`scripts/exam-sql-local.cjs` does and kept as a template database; each experiment ran in a database cloned from it. People were created
through the real `onboard_firebase_profile()` as role `authenticated` with synthetic claims (`example.test` addresses). Fixtures were inserted
as the superuser; every measured call ran as `authenticated` (or `anon`) with 8 s statement and lock timeouts inside the transaction. Expected
numbers for the correctness fixture were worked out by hand before the run. The speed fixtures were generated in SQL (triggers off only while
building); times are the median of 3 runs. Reactivation used the real `student_administration`. The platform administrator row was inserted
directly (no function creates one). No real key, token, address or customer record was used. The server and all databases were stopped and
deleted at the end.
