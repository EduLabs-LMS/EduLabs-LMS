# Part 3: enrollment (course runs, run staff, join links, join requests, student administration)

Read-only audit. No code, migration, test or config was changed. Nothing ran against the VPS or any Supabase project. All evidence
comes from a disposable local PostgreSQL 17.10 on loopback (its own data folder, port 54873), started with `-c timezone=UTC`
(hosted runs UTC). It was built from the 52 migrations in this tree, as in the earlier parts, and deleted afterwards. Two prototypes
ran in a second throwaway copy (`audit3_proto`), also deleted. All people are seed or synthetic users. Branch
`claude/backend-audit`, head before this part `617c993520c01d3218b24670ebfe8b63965727cf`.

Findings are numbered `A3-nn` in [FIX_LIST.md](FIX_LIST.md). A0-10 was re-checked here and is now proven (its own section below).

**Two things the task named do not exist.** `student_administration` has no "move" and no "remove" action. Its write actions
are `link`, `revoke-link`, `request`, `accept`, `approve`, `reject`, `enroll`, `suspend` and `reactivate`. Taking a student out of
a course is `suspend`. Moving a student between Groups is `group_command` (Part 4). A join link has no use limit: a `request` link
works for any number of students until it expires (30 days at most) or is revoked, and each use only asks; a teacher approves.

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| A3-01 | Medium | A teacher of a run can change enrollments, the run and run staff by plain table writes that skip `student_administration`: enroll any person by id without a request (and then read that person's profile), suspend **all 2,000 students in one statement**, archive the run so that every student loses access at once, set any status or date. **No audit row is written.** The app uses none of these writes except creating a run. |
| A3-02 | Medium | Every student who uses a join link locks the whole run, and all users of one link wait for each other. 200 students in the same moment: 2.3 s in a queue (half wait 1.5 s or more), and meanwhile attendance saves and new homework, exams and Groups of that run wait up to 0.94 s. A prototype brings it to 0.87 s with other work unaffected, but only together with the A0-03/A0-04/A0-05 lock changes. |
| A3-03 | Medium (owner decision) | A rejected join request is final. The student cannot ask again, the teacher cannot undo it, and no function can enroll that student. The only way back in today is a direct table insert, which A3-01 removes. |
| A3-04 | Medium (owner decision) | Suspend then Reactivate changes the student's enrollment date to today and leaves the student out of their Group for good. Reports count homework only for students enrolled before its deadline, so the student's earlier homework drops out of the reports (read from the code, not run). |
| A3-05 | Medium | The read rules on `enrollments` and `enrollment_requests` run a permission check per row: 2.6 to 5.0 s for a run of 2,000 students, and any signed-in student can start a 4.4 to 4.9 s query. Same cause and same fix as A1-01. No screen reads these tables that way. |
| A0-10 (re-checked) | Low | Now proven: a direct `enrollments` update and a `student_administration` action on the same student deadlock (`40P01`). The fix is A3-01, because the A0-02 decision does not list `enrollments`. |
| A3-06 | Low | Two requests at once can create two active runs for one course (the course-run route reads, then inserts). The Students screen then shows the course twice, and a Group can land in a run the join link does not use. |
| A3-07 | Low | A seat in a full run stays taken by a student whose access has expired, and a refusal for a full run reaches the teacher as "Check the details and existing access". No screen sets a run's capacity today. |
| A3-08 | Low | The Students screen reads at most 1,000 students of a course, and the student page cannot open a student beyond the first 1,000 by name. Opening one student costs up to 40 calls. |
| A3-09 | Low | `student_administration` takes its locks before it checks the right to manage, and before refusals that need no lock. An assistant's refused call waited on the owner's action (779 ms). Refused calls are not counted by the rate limit. |
| A3-10 | Low | The database accepts a join link for an unpublished course (already listed in V1.md), and accepts any 43-character secret the caller chooses. |
| A3-11 | Note (owner decision) | The reason a teacher types when rejecting can be read by the student. The teacher is not told. |
| A3-12 | Note | Unused or dead: the actions `accept` and `enroll` and personal invite links (no screen), three enrollment statuses and the run's capacity and date columns (no writer once A3-01 is fixed), two repository reads with no caller, and command rows that are never pruned. |

**Sound:** links, approval, capacity under races, who can see whom, and staff of one run or space acting on another. Each was
proven with real sessions (details under "Checked and fine"). **Reads through the function are fast:** a roster page of a
2,000-student run takes 6 to 10 ms and the join-request queue 4 to 6 ms.

## Scope and live versions

**Tables** (`anon` and `service_role` have no grant on any of them; RLS is on for all eight)

| Table | Live file | Grants to `authenticated` | Policies and triggers |
| --- | --- | --- | --- |
| `public.course_offerings` (a course run) | 20261001230352_lms_schema.sql:37 | select; **insert**; **update**(name, delivery_mode, starts_at, ends_at, enrollment_opens_at, enrollment_closes_at, timezone, capacity, status) (20261001230357:161-163) | `course_offerings_select`, `_insert`, `_update` (20261001230357:155-159), restrictive `trusted_identity`; triggers `check_integrity` (`check_lms_integrity`, live in 20261001230955:3), `prevent_reparenting`, `touch_updated_at` |
| `public.offering_staff` (run staff) | 20261001230352:39 | select; **insert, delete; update**(role) (20261001230357:173-177) | `offering_staff_select`, `_insert`, `_update`, `_delete` (20261001230357:165-171), `trusted_identity`; `check_integrity`, `prevent_reparenting` |
| `public.enrollments` | 20261001230352:41 | select; **insert; update**(status, enrolled_at, expires_at, completed_at, source) (20261001230357:185-187) | `enrollments_select`, `_insert`, `_update` (20261001230357:179-183; caller rewritten to `current_app_user_id()` by 20261010100545), `trusted_identity`; triggers `enforce_capacity`, `group_enrollment_interval`, `enrollment_admin_version`, `notification_enrollment`, `prevent_reparenting` |
| `public.enrollment_requests` | 20261016053117_student_administration_workflows.sql:2 | select | `enrollment_requests_read` (:19) |
| `private.student_access_links` | 20261016053117:22 | none | RLS on, no policy |
| `private.enrollment_admin_versions` | 20261016053117:37 | none | RLS on, no policy |
| `private.student_admin_audit` | 20261016053117:41 | none | RLS on, no policy |
| `private.student_admin_commands` | 20261016053117:49 | none | RLS on, no policy |

**Functions** (all `security definer` with `search_path=''` unless marked; the caller is always `private.current_app_user_id()`;
no live function contains `auth.uid()`)

| Function | Live file:line | Callable by |
| --- | --- | --- |
| `private.student_administration` | **20261106120000_listing_performance.sql:148** (×2; the first version is 20261016053117:70; only `offerings` and `metrics` differ) | `authenticated` |
| `public.student_administration` (invoker wrapper) | 20261016053117:218 | `authenticated` |
| `private.student_link_issuer` | 20261016053117:64 | `postgres` only |
| `private.bump_enrollment_admin_version` (trigger) | 20261016053117:57 | trigger |
| `private.enforce_capacity` (trigger, before insert or update on `enrollments`) | 20261001230358_lms_integrity.sql:114 | trigger |
| `private.group_enrollment_interval` (trigger, after update of status, expires_at, enrolled_at) | 20261014054726_complete_group_attendance_workflows.sql:388 | trigger |
| `private.notification_business_event`, `enrollments` branch | 20261119120000_live_class.sql:190 (branch at :205) | trigger |
| `private.can_manage_offering`, `can_support_offering`, `is_enrolled` | 20261001230357:27, :31, :35 (bodies rewritten by 20261010100545) | `authenticated` (helpers) |

**Routes and callers**

| Route | Server code | Database |
| --- | --- | --- |
| `POST /api/student-administration` | `server/http/student-administration.ts:10`, `server/services/student-administration.ts:4`, contract `shared/contracts/student-administration.ts` | `student_administration` (every action) |
| `POST /api/study-groups/course-run` | `server/http/group-course-run.ts:11`, `server/services/group-course-run.ts:12` | direct `courses` and `course_offerings` selects, direct **`course_offerings` insert** (:23) |
| `/teacher/students`, `/teacher/students/invite`, `/teacher/students/<id>` | `frontend/features/teacher-students/*`, `shared/teacher-students.ts` | `offerings`, `roster`, `requests`, `links`, `link`, `revoke-link`, `approve`, `reject`, `suspend`, `reactivate` |
| `/join/<token>` (student) | `app/join/[token]/page.tsx`, `frontend/features/admin/users/student-access.tsx` | `inspect`, `request` |
| teacher Home | `server/services/teacher-home.ts:49` | `metrics` |
| every signed-in page and the student pages | `server/repositories/website.ts:28, :36-38`, `server/services/lessons.ts:43-44`, `server/services/student-academics.ts:14-17`, `server/services/teacher-homework.ts:38`, `server/services/teacher-exams.ts:46`, `server/http/homework.ts:23`, `server/repositories/exams.ts:52` | direct selects on `course_offerings`, `offering_staff` and the caller's own `enrollments`, always filtered by id, course or the caller |

## A3-01: Medium, security

**A teacher of a run can change enrollments, the run and run staff by plain table writes that skip every rule of
`student_administration`, and nothing is recorded.**

Who "a teacher of a run" is: the space owner or admin, the course owner or instructor, or the run's instructor
(`can_manage_offering`). The grants and policies are in the scope table. Proven as seed user 2 (run instructor) on the
2,000-student run, each probe rolled back:

| Direct call | Result | What the function does instead |
| --- | --- | --- |
| Insert an active enrollment for a person with no relation to the space, by profile id | **1 row** | `enroll` refuses: `42501 Use a student request or invitation first` |
| Read that person's profile before / after | 0 rows / **name, phone, photo path** | the read rule shows a profile to staff of a run the person is enrolled in |
| Set a student `cancelled`, or `completed` | 1 row each | no action sets these |
| Reactivate a suspended student | 1 row | `reactivate` checks the run, the course, the space, the person and the version |
| Move an enrollment date back a year | 1 row | never changes a date except on reactivate |
| **Suspend all 2,000 students in one statement** | **2,004 rows** (19.3 s locally) | one at a time, each with a version check and an audit row; 2,000 an hour at most |
| Audit rows written by all of the above | **0** | one per action |
| **Archive the run** (`update course_offerings set status='archived'`) | 1 row; students with access: **2,001 → 0** | no action changes a run |
| Set capacity 1 on a run of 2,000; close enrollment; end the run in the past | 1 row each | none |
| Rename the run to 1,000,000 characters | 1 row | none |
| Insert a new active run with a 200,000-character name; insert 500 more runs | 1 row; 500 rows | the app creates one run per course (A3-06) |
| Delete an enrollment or a run; move a run to another course | refused (no grant) | |

Run staff (`offering_staff`), as the space owner: adding the teacher as instructor of another run and removing a run's
instructor both succeed, unrecorded. The integrity trigger still refuses a non-member, a member of another space and an assistant
as instructor (proofs). A course instructor who is not the course owner is refused.

What this means:

- The audit trail of student administration can be bypassed by the people it is meant to record, or by anyone holding a teacher's
  token. One call suspends a whole run or archives it. Suspension also ends each student's Group membership (A3-04), so undoing
  it does not restore the Groups.
- "A teacher cannot look a person up outside their own courses" (DECISIONS.md, student entry model) does not hold for someone who
  has a profile id: one insert makes the profile readable.
- **Why Medium and not High:** the same people may suspend or reactivate each student through the function, the writes are
  reversible, and a profile id is not guessable. Nothing here crosses a space: another space's owner and a run assistant were refused
  on every one of these writes (proofs under "Checked and fine").

**What the app uses.** Only the `course_offerings` **insert**, in `server/services/group-course-run.ts:23`. No code in `server`,
`app`, `frontend` or `shared` updates a run, or inserts or updates `enrollments` or `offering_staff`.

**Fix (not done).** Revoke `INSERT` and `UPDATE` on `enrollments`, `UPDATE` on `course_offerings`, and `INSERT`, `UPDATE` and
`DELETE` on `offering_staff`; drop their policies. Move the run insert into a definer function (it also fixes A3-06) and then
revoke `INSERT` on `course_offerings`. The A0-02 decision lists the content tables only, so these three tables must be added to
it. Run staff changes, when they get a screen, go through an audited function (the A1-02 direction).

## A3-02: Medium, lock

**Every student who uses a join link locks the whole run.**

`student_administration('request')` takes, in this order (20261106120000:213-230):

1. a per-person advisory lock;
2. the run row `FOR UPDATE`;
3. the course `FOR SHARE`;
4. the profiles of the student and of the link's creator `FOR SHARE`;
5. the creator's membership, course-staff and run-staff rows `FOR SHARE`;
6. the space `FOR SHARE`;
7. the link row `FOR UPDATE`.

Then it inserts one row into `enrollment_requests`. Nothing it writes needs the run or the link exclusively: the unique key
`(offering_id, user_id)` and the per-person lock already stop a double request.

**Who waits.** Every other student using a link of that run. Every action that takes the run row: attendance saves and every Group
command (A0-04), approvals, and the capacity trigger. Every insert that names the run: a homework or exam draft, a Group, a media
row. A lesson save and every space command wait on the `FOR SHARE` of the course and the space.

**Measured** (`scratchpad/burst.cjs`; each call a PostgREST-shaped transaction as the signed-in student; probe connections take the
same lock the named action takes, every 5 ms):

| | Live | Prototype |
| --- | --- | --- |
| One join request alone (call and commit) | 6.2 ms | |
| 300 requests one after another, p50 / p95 | 5.2 / 6.1 ms | |
| **200 students use one link at the same moment: total** | **2,307 ms** | **865 ms** |
| … per student p50 / p95 / max | 1,518 / 2,233 / 2,305 ms | 691 / 860 / 864 ms |
| … an insert naming the run meanwhile, p95 / max (alone 1.0 / 2.9 ms) | **815 / 939 ms** | 13.5 / 32 ms |
| … an attendance save or Group command meanwhile (run `FOR UPDATE`), p95 / max | **815 / 940 ms** | 722 ms (starved); **16 / 21 ms** once it takes `FOR NO KEY UPDATE` (the A0-04 fix) |
| … a lesson save meanwhile (course `FOR UPDATE`), max | 345 ms | 722 ms (starved); **21 ms** with `FOR NO KEY UPDATE` (A0-05) |
| … a space command meanwhile (space `FOR UPDATE`), max | 345 ms | 722 ms (starved); **46 ms** with `FOR NO KEY UPDATE` (A0-03) |
| A join request behind a run row that someone holds for 3 s | waits 3,018 ms, then succeeds | |

**Worst realistic case.** A teacher posts the join link in a class chat at the start of term and 200 students open it within the
same seconds. On this 20-core machine the last one waits 2.3 s and the run's other work stalls for about a second. Hosted
hardware is slower and has 60 connections for everything, so the queue is longer there (not measured). With 2,000 students
arriving over an hour (one every 2 seconds) nothing queues. Because no lock timeout is set (A0-06), anything that holds the run row
longer makes every arriving student wait with it.

**Prototype** (`scratchpad/proto.cjs`, throwaway copy only):

- For `request`: the run, the course and the space `FOR KEY SHARE`, and a request link's own row `FOR KEY SHARE`.
- For every other action: the run `FOR NO KEY UPDATE`; `enforce_capacity` and `group_enrollment_interval` the same.
- All 200 requests were stored; approval and capacity are unchanged (they still take the run exclusively against each other).
- The first version changed only the run, course and space locks and gave **no gain** (2,031 ms): the students then queued on
  the link row instead. The link row must change too.
- **It only works together with A0-03, A0-04 and A0-05.** A `FOR KEY SHARE` holder still conflicts with `FOR UPDATE`. While 200
  students held their shared locks, a save that still takes `FOR UPDATE` waited for the whole burst (722 ms, the same starvation
  Part 2b measured). The same saves with `FOR NO KEY UPDATE` took 16 to 46 ms.
- What `FOR KEY SHARE` gives up: a request can be stored in the same instant the run is archived or the link is revoked. It grants
  nothing; an approval checks the run, the course and the space again.

**Fix (not done):** as prototyped, in the same change as A0-03, A0-04 and A0-05, plus the A0-06 `lock_timeout` on
`student_administration`.

## A3-03: Medium, correctness (owner decision)

**A rejected join request is final, for the student and for the teacher.**

`enrollment_requests` holds one row per student and run (`unique(offering_id, user_id)`). After a rejection:

| Step (proof, rolled back) | Result |
| --- | --- |
| The rejected student uses the link again | the same row comes back, still `rejected`; no new request is made (`insert … on conflict do nothing`, :251) |
| The teacher approves the rejected request | `PT409 Request already decided` (:259) |
| The teacher uses `enroll` | `42501 Use a student request or invitation first` (:264), unless the student already has an enrollment elsewhere in the space |
| The teacher inserts the enrollment directly | 1 row: **the only way today**, and A3-01 removes it |

A personal invite link (`accept`) would work, but V1 has no screen for it (DECISIONS.md, "No personal invitation"). So one wrong
tap on Reject locks that student out of that course until someone edits the database. Approval is the teacher's payment gate, so
rejecting and later admitting the same student is an ordinary case.

**Owner question:** after a teacher rejects a request, may the student ask again with the same link? And should the teacher be able
to undo a rejection? **Recommended:** both. A rejected student's new request sets the row back to `pending` (with the rate limit
that already exists), and the request list offers Approve on a rejected row.

## A3-04: Medium, correctness (owner decision)

**Suspend then Reactivate changes the student's enrollment date and leaves them out of their Group.**

- `reactivate` sets `enrolled_at = now()` (20261106120000:291). Proof: student 10's date went from 19:51:59 to 20:06:18; the audit
  row keeps the old date in `before_data`.
- **Reports use that date.** `report_facts` counts a homework for a student only if `enrolled_at <= ` its deadline, and joins
  hand-ins to that list (20261117120000_reports.sql:94). The same rule picks who counts as absent from an exam (:127, :133).
  After a reactivation the student's earlier homework, handed in or missing, is no longer in the Group report, the student page or
  "Needs attention". Exam results that exist stay. **This part was read from the code and not run** (it needs homework fixtures; Part 8
  should prove it).
- **The Group is lost.** Suspending ends the student's Group membership at that moment, which is right: the past interval stays
  (`group_enrollment_interval`, 20261014054726:388). Reactivating does not open a new one, because only memberships still open are
  re-created. Proof (rolled back): one open membership before; after suspend it is ended; after reactivate it is still ended and
  there is no new one. The teacher must add the student to the Group again. Nothing in the reply says so.

Suspending a student who has not paid and reactivating them later is the normal use of these two buttons.

**Owner question:** when a suspended student is reactivated, should they return to the Group they were in?
**Recommended (technical):** keep `enrolled_at` as the first enrollment date and record the reactivation separately (the audit
row already has it), so reports keep the student's history.

## A3-05: Medium, performance

**The read rules on `enrollments` and `enrollment_requests` check permission once per row.**

`enrollments_select` runs `is_active_user()` or `can_support_offering(offering_id)` for each row, and `enrollment_requests_read`
runs both (policy text in the scope table). One `can_support_offering` call costs 3.2 ms and `can_manage_offering` 2.8 ms; neither
can be inlined, and each resolves the caller again (the A1-01 cause).

| Direct read through the Data API | Time | `EXPLAIN (ANALYZE, BUFFERS)` |
| --- | --- | --- |
| Owner: the run's 2,000 enrollments | **2,576 ms** | seq scan, filter `… OR private.can_support_offering(offering_id)`, 170,919 buffer hits |
| Run instructor: the same | **4,999 ms** | |
| **A student: `select count(*) from enrollments`** (returns 1) | **4,382 to 4,894 ms** | 2,002 rows removed by the filter, 326,455 buffer hits |
| Owner: the run's 300 pending requests | 442 to 528 ms | 31,824 buffer hits |
| A student: `count(*)` on `enrollment_requests` | 732 ms | |
| Owner: all 2,607 profiles (`can_view_profile`, A1-01) | 4,105 ms | |
| A student: `course_offerings` / owner: `offering_staff` (a few rows) | 11.5 ms / 4.8 ms | |

- The student's query costs about 2.2 ms for **every enrollment on the platform**, not only their own. At about 3,500 enrollments it
  reaches the hosted 8 s limit; it is then cancelled, but it has used a connection and a CPU for 8 s, and any signed-in user can
  repeat it.
- **No screen does this.** The app reads `enrollments` only by the caller's own id (1.1 ms) or by run and caller. Teachers' lists
  come from `student_administration`, which authorizes once (next section). Two repository reads that would do it have no caller
  (A3-12).

**Fix (not done):** the A1-01 shared fix. Add `enrollments_select`, `enrollment_requests_read`, `course_offerings_select` and
`offering_staff_select` to the policies that use the once-per-statement "my scope" helper (for example
`offering_id in (select private.my_supported_runs())` or the caller's own row).

## Re-checked: A0-10, now proven (Low)

Part 0 reasoned that a direct `enrollments` update locks the enrollment and then the run (through its triggers), while
`student_administration` locks the run and then the enrollment. **Proof** (`scratchpad/races.cjs`, R6; real function on one side, a
direct update as the run instructor on the other; a third session held the course row for 600 ms only to widen the window):

- the function's `suspend` took the run and waited on the course;
- the direct `update public.enrollments set status='suspended'` took the enrollment row and waited on the run;
- when the helper let go, PostgreSQL reported a deadlock after 725 ms and aborted the direct update with **`40P01`**. The
  function's suspend went through.

The app never updates `enrollments` directly, so this needs a hand-made call. The FIX_LIST row said "removed by the A0-02 fix", but
the A0-02 decision does not include `enrollments`. **The fix is A3-01.**

## A3-06: Low, correctness

**Two requests at once can create two active runs for one course.**

`groupCourseRun` reads the course's runs, and inserts one when none is current (`server/services/group-course-run.ts:17-23`).
Nothing in the database limits a course to one current run. **Proof** (R8): two sessions as the owner each saw 0 runs and each
inserted one: **2 active runs**. The Students screen's course list then shows the course twice with the same name
(`offerings` returned `Fresh course / Fresh course` twice).

When it can happen: Create a Group and Invite students both call this route for a course with no run, so two tabs, or one tab
doing both at once, are enough. Afterwards the app always picks the same one (latest start, then lowest id, `currentRun` in
`shared/teacher-groups.ts:184`), but the Group made by the losing request sits in the other run: students who join by link are
enrolled in a run that Group does not belong to and cannot be added to it.

**Fix (not done):** one definer function `course_run(course)` that locks the course row, returns the current run or creates it,
and is the only writer (A3-01).

## A3-07: Low, correctness

**A seat stays taken by a student whose access has expired, and "run full" is not said.**

`enforce_capacity` counts enrollments with `status='active'` and ignores `expires_at` (20261001230358:118). Proof on a run with
capacity 2:

| Step | Result |
| --- | --- |
| Two students approved, then one's access expired yesterday; approve a third | `23514 Offering capacity exceeded` |
| Suspend one, approve the third | accepted |
| Reactivate the suspended one into the now full run | `23514 Offering capacity exceeded` |

The server maps 23514 to "Check the details and existing access." (`server/services/student-administration.ts:6`), so the teacher
is not told that the run is full; the request stays pending.

**Why Low:** no screen sets a run's capacity (DECISIONS.md), and the runs the app creates have none, so the rule is asleep in V1.
**Fix when run capacity gets a screen:** count only students who still have access, and give the refusal its own message.

## A3-08: Low, correctness at scale

**The Students screen stops at 1,000 students per course, and the student page cannot open the rest.**

- The list reads at most 40 roster pages of 25 per course (`MAX_ROSTER_PAGES`, `shared/teacher-students.ts:8`) and then says that
  more exist. Search by name still finds anyone, because the search runs in the database.
- The student page finds its row by reading roster pages in name order until it meets the student
  (`frontend/features/teacher-students/student-view.tsx:23`). A student after the 1,000th by name is **not found**, even when the
  teacher reached them through search. Each page is its own request: opening the 1,000th student costs 40 calls
  (340 ms of database time here; each is also an HTTP request with a sign-in check).

DECISIONS.md already records that the Students reads are derived and a dedicated read is a later optimisation.
**Fix (not done):** a `student` action that returns one student's row by id, and keyset paging (name, id) instead of page numbers.

## A3-09: Low, lock

**`student_administration` takes its locks before it knows whether the caller may act.**

- A run assistant passes the first check (`can_support_offering`, :192), takes the per-person lock and then the run row and
  the others, and is refused only afterwards (`Instructor required`, :233). Proof (R7): while the owner's approval was open, the
  assistant's `approve` **waited** (`Lock/transactionid`) and was refused after 779 ms. A student with no role is refused at once
  (19 ms, R7b).
- A `request` is refused for an existing enrollment (`Contact teacher about existing enrollment`, :249) only after all seven locks.
- A refused call rolls back, so it leaves no command row and **the rate limit never counts it**. One enrolled student repeating
  `request` from 20 connections made 1,355 calls in 5 s, with 0 command rows.

**Measured effect on others: none.** The per-person advisory lock comes first, so one account holds the run row from only one
connection at a time: during those 5 s every probe stayed at p50 0.6 ms, max 6.9 ms. This is why it is Low.

**Fix (not done):** check `can_manage_offering` before the first lock for staff actions, make the cheap refusals before locking
(and again after), with the A3-02 change.

## A3-10: Low, hardening

- **A link for an unpublished course is accepted** (proof: created; `inspect` then answers `Link unavailable`). V1.md already
  lists this under "Performance and hardening before V1"; the teacher screen offers only published courses.
  **Fix:** refuse `link` unless the course is published.
- **The link secret is whatever the caller sends.** The database checks only its shape (43 URL-safe characters). The screen makes
  it with `crypto.getRandomValues`, but a direct call may choose `AAAA…A` (proof: accepted). Only that caller's own run is
  affected. A second link with the same secret is refused with `23505`, which tells a teacher that a secret already exists; with
  256 random bits that is not a way in. **Recommended:** generate the secret in the database function (`gen_random_bytes`) and
  return it once.

## A3-11: Note (owner decision)

**The student can read the reason a teacher types when rejecting.** `reject` stores it in `enrollment_requests.reason`. The
student's own row is readable (`enrollment_requests_read`), and the `mine` action returns it (proof: `"reason":"not paid"`), with the
reviewer's profile id on the row. The teacher's field only asks "Why are you saying no?" (`ts.requests.reason`). The page that
would show it to students (`/access`) is not in the V1 route list, so today only a direct call reads it.

**Owner question:** should the student see the reason? If yes, the field should say so. If no, **recommended:** stop returning
`reason` and `reviewed_by` to the student.

## A3-12: Note, unused and dead

| Item | State |
| --- | --- |
| Actions `accept` and `enroll`, links of kind `invite` | no screen (DECISIONS.md); still reachable through `POST /api/student-administration`. They work as designed (proofs R5, S2) |
| Enrollment statuses `invited`, `completed`, `cancelled`; columns `completed_at`, `source` | no function writes them; only direct writes can (A3-01). The roster filter still offers them |
| Run columns `capacity`, `enrollment_opens_at`, `enrollment_closes_at`, `starts_at`, `ends_at`, `delivery_mode`, `timezone` | no screen and no function writes them; app-created runs leave them empty. The capacity rule and the enrollment window are checked but never set |
| `server/repositories/website.ts:56` `roster` and `:57` `enrollmentCount` | no caller. They are the direct reads of A3-05 |
| `server/repositories/lms.ts:40-41` `offerings`, `enrollments` | only the unused staging repository (A2a-12) |
| `private.student_admin_commands` | one row per write command, never removed (629 rows = 296 kB here, about 470 bytes each). The rate limit reads the last hour only. Recommended: delete rows older than a day when the function is next touched |
| `/join/<token>` | still the retired `StudentAccess` component (already in V1.md) |

## Checked and fine

**Definer, grants, caller.**

- Every function in scope is `security definer` with `search_path=''`, or an invoker wrapper. Triggers and `student_link_issuer`
  are executable by `postgres` only. `student_administration` is granted to `authenticated` only; `anon` and `service_role` cannot
  call it and have no table grant. Nothing in this part uses the service-role key.
- The caller is `private.current_app_user_id()` everywhere. A suspended profile resolves to nobody: `42501 Sign in required`
  (proof).

**Links.**

- The secret is 43 URL-safe characters (256 bits when made by the screen). Only its SHA-256 is stored. It is not in the audit or
  command rows (the command row keeps a hash of the whole payload).
- A random or malformed secret, an expired link, a revoked link, another person's invite and a link whose creator has since lost
  the teaching role all give the same `42501 Link unavailable` (proofs, including a 1.5 s link used before and after it expired).
- **A link decides its own run.** Used while naming another space's run as `p_offering`, the request was stored for the link's
  run (proof).
- Expiry is 30 days at most (`23514 Invalid expiry`). A request link used with `accept` is `23514 Wrong link type`.
- Another space's owner cannot revoke a link, by its id or by naming the run (proofs).
- An invite link is bound to one person and one use: the invited student accepting in two tabs at once got **one** enrollment
  (the second waited on the per-person lock and returned the same one); another student got `Link unavailable`.

**Nobody gets in without approval, or back in after suspension.**

| Attempt (proofs) | Result |
| --- | --- |
| A student calls `approve` or `enroll` on themself | `42501 Offering unavailable` |
| A student inserts their own enrollment or request, or sets their request approved | refused (RLS / no grant) |
| A **suspended** student uses the link again | `23514 Contact teacher about existing enrollment` |
| A student whose profile is suspended | `42501 Sign in required` |

**Who can see whom.**

- An enrolled student reads exactly: their own enrollment (1 row), their own profile (1), their own run (1), no run staff, no
  requests. `roster`, `requests` and `links` are refused; `offerings` and `metrics` are empty. A student with only a pending
  request reads that request and their own profile.
- A student cannot see other students of the run through anything in this part (Group lists are Part 4).

**Staff of another run or space.**

- The owner of space B on a run of space A: `roster`, `approve`, `suspend` and `link` are `42501`; direct reads return 0 rows;
  direct insert and update are refused.
- A run assistant (teaching assistant of run 1 only): reads run 1's roster with `manage: false`; is refused on run 2 and the big
  run; cannot list links, suspend or insert an enrollment in run 1.
- A person with roles in two spaces gets each space's rights separately.

**Races** (two sessions each; the second waited on the first, `Lock/transactionid`):

| Race | Result |
| --- | --- |
| Two staff approve the same request | one enrollment; the second gets `PT409 Stale request` |
| One approves, one rejects (both orders) | the second gets `PT409 Stale request` |
| **Last seat:** two staff approve two different students of a run with one seat left | one approved; the other `23514 Offering capacity exceeded`, 2 active enrollments, the refused request still pending |
| Two staff suspend the same student | the second gets `PT409 Stale enrollment` |
| The same command sent twice with one request id | the same answer, one audit row; another payload with that id: `23514 Request ID reused` |

**Capacity holds under races** because the function and the trigger both take the run row before counting. It also holds for a
direct insert (the trigger runs for every writer).

**Lock order** is the same everywhere in this part: person (advisory) → run → course → profiles (in id order) → membership →
course staff → run staff → space → link → request → enrollment; the triggers then ask for the run row the function already
holds. The two reverse orders are known: a direct enrollment update (A0-10) and `academic_command('course.assign')` (A2b-01).

**Rate limits.** A person who is not staff gets 100 commands an hour: a student repeating a pending request was accepted 99 more
times, then `PT429 Command rate limit` in 4 ms, before any shared lock. New requests are limited to 10 an hour per student,
links to 100 an hour per teacher, staff commands to 2,000 an hour.

**Cost through the function** (2,000 enrolled students, 300 pending requests, warm, median of 7; owner / run instructor):

| Read or write | Time |
| --- | --- |
| Roster page 1, page 41, page 80 (the last) | 5.8, 7.5, 7.6 ms / 9.7, 10.4, 10.0 ms |
| Roster search by name; filter Active | 5.9, 7.2 ms / 8.3, 9.6 ms |
| Join requests, pending, first and last page | 3.9, 4.2 ms / 6.0, 6.2 ms |
| Course list (`offerings`); Home numbers (`metrics`); links | 10.3, 9.4, 4.1 ms / 18.8, 11.9, 5.7 ms |
| All 80 roster pages one after another | 639 ms |
| Student: open a link (`inspect`); my requests (`mine`) | 2.2 ms; 1.0 ms |
| Approve, reject, suspend, reactivate, create a link | 6.7, 5.6, 5.6, 6.0, 5.8 ms |

`EXPLAIN (ANALYZE, BUFFERS)` of the roster's inner query, last page: hash joins over 2,000 enrollments and 2,607 profiles, a
564 kB in-memory sort, 79 buffer hits, **1.7 ms**. The queue's inner query: 46 buffer hits, 0.4 ms. No permission helper runs
per row: the function authorizes once (`can_support_offering` and `can_manage_offering`, about 3 ms each), which is most of each
call. Every page sorts the whole run again; at 2,000 students that is 1.6 ms.

**History.** Suspending ends a Group membership at the server's time and keeps the past interval (proof). The audit row of every
action keeps the row as it was before. The one thing that rewrites the past is the enrollment date on reactivate (A3-04).

**Time zones.** Every time is `timestamptz` and compared with `clock_timestamp()`. The route requires an offset on every expiry
(`shared/contracts/student-administration.ts:2`). A direct call without one is read in the server's zone, which is UTC on the
hosted project (proof: `2027-01-01 10:00` stored as `10:00+00`).

**NULLs and bad input.** Null data: `23514 Invalid input`. A page that is not a number: `22P02` (400 through the app). An unknown
action: `23514`. A write without a request id: `23514`. A null version never matches (`is distinct from`).

**Foreign keys and cascades.** A run cannot be deleted while it has enrollments, requests, links, audit rows, Groups, homework,
exams or media (all `RESTRICT`); only its staff rows cascade. An enrollment cannot be deleted while it has progress or Group
memberships; only its version row cascades. The API cannot delete an enrollment or a run at all (proofs: no grant).

**Notifications.** An approval sends one `account_approved` notice to the student, keyed by the enrollment and its update time.

## Could not verify

- **Hosted hardware and pool.** The burst used 200 direct connections on a 20-core machine. The hosted project has 60 connections
  in all and requests go through the API's own pool, so the same burst queues differently there. The lock scope is the same.
- **The report side of A3-04** (earlier homework leaving the reports after a reactivation): read from `report_facts`, not run.
  Part 8 should prove it with homework data.
- **"Move and remove at once."** `student_administration` has neither action. Suspend against a Group transfer or removal
  (`group_command`) was not run here; both take the run row first (read from the code). Part 4 should run it.
- **The demo functions' own enrollment and run writes** (`demo_fill_core`, `demo_clear_core`): Part 8.
- **Whether the Supabase API gateway limits direct Data API calls per user** (A3-05, A3-09).
- **Real data sizes.** Dev holds 5 spaces and 13 courses today (owner's chat, 2026-11-16); the 2,000-student run is synthetic.

## How the proofs were run

1. A separate server (`.local/step03a/pg-data-audit3`, port 54873, `timezone=UTC`, `max_connections=320`) and database `audit3`,
   built by replaying the bootstrap, the 52 migrations and the seed in the order `scripts/exam-sql-local.cjs` uses. A server from
   an earlier part was found still listening on port 54871 (`.local/step03a/pg-data-audit`); it was not used or touched.
2. Fixture: 2,600 synthetic people (through the `auth.users` trigger, as sign-up does), one run of seed course 1 with 2,000
   enrollments (written as `postgres`, triggers on), one real join link made by the owner, and 300 join requests made by 300
   students through the real function. Later proofs added 200 more requests, a run with capacity 2, and a course with no run.
3. Every call is one PostgREST-shaped transaction as the signed-in person: `begin; set local role authenticated; request.jwt.claims;
   call; commit`. Probes marked "rolled back" end with `rollback`.
4. Two-session proofs: session A calls and stays open 900 ms; session B starts 150 ms later; a third session reads B's
   `pg_stat_activity` row at 450 ms.
5. Scripts (scratchpad, not committed): `lib.cjs`, `build.cjs`, `fix.cjs` (fixture), `reads.cjs` and `explain.cjs` (timings and
   plans), `burst.cjs` (join burst, probes, rate limit), `races.cjs` (R1 to R8, A0-10), `sec.cjs` (links, access, direct writes,
   inputs), `more.cjs` (profile probe, two runs, write costs, the 3 s wait), `grp.cjs` (Group membership after reactivation),
   `proto.cjs` and `burst2.cjs` (the prototype in `audit3_proto`). The server, both databases and the data folder were deleted
   afterwards.
