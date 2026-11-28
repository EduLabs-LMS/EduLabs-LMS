# Fix track 2b: "my scope" for Groups, homework, exams and enrollments

Branch `claude/fix-02b-my-scope` (from `claude/fix-02a-my-scope` at `c479c71`). Status: **done in the branch (code commit `f57152d`), awaiting the dev
check.** Nothing was applied to any hosted project, merged or deployed. The owner's chat applies the migration to dev after review.

Findings: **A3-05** (Medium), **A4-01** (Medium), **A5-02** (Low), **A6a-05** (Medium). Reports (A8-02, A8-04) are track 2c. Locks, deadlines and the
exam rules are not touched.

Migration: `supabase/migrations/20261128120000_my_scope_groups_work.sql`
SHA-256: `0874efd63eaabb393f1635d35c835b0118c6a9363bb0180b3d1aa18f6453fb0c` (one new line in `scripts/migrations.sha256`, `-text` in `.gitattributes`).
No server, app or contract file changes: every fixed read is a database function or policy.

## What changed

The pattern is 2a's (see [TRACK-02a](TRACK-02a-my-scope.md)): each set is the exact set of rows an existing helper accepts, written out from the helper's
own rule, and a policy or read checks `… in (select private.…())`, which PostgreSQL computes once per statement. The migration's header lists every rule.

### New functions (security definer, `search_path=''`, stable, executable by `authenticated` only)

2a's `supabase/tests/my-scope.sql` checks that no `my_*` function exists beyond 2a's ten, and that suite had to pass unchanged, so the new sets are named
`caller_*`. 2a's `my_space_roles` and `my_supported_offerings` are reused.

| Function | What it returns | The helper whose rule it is |
| --- | --- | --- |
| `caller_managed_offerings()` | run ids | `can_manage_offering` |
| `caller_enrolled_offerings()` | run ids | `is_enrolled` (with `now()`, as the helper) |
| `caller_viewable_offerings()` | run ids | `can_support_offering or is_enrolled` |
| `caller_editable_courses()` | course ids | `can_edit_course` |
| `caller_managed_groups()` | Group ids | `can_manage_group` |
| `caller_visible_groups()` | Group ids | `can_view_group` (with `clock_timestamp()`, as the helper) |
| `caller_visible_homework()` | homework ids | `homework_visible` (= `homework_staff` 'view' or `homework_enrolled`) |
| `caller_offering_rights(run)` | `manage`, `support` for ONE run | `can_manage_offering`, `can_support_offering` |
| `caller_course_edit(course)` | boolean for ONE course | `can_edit_course` |

### Replaced policies (same name, command and role)

| Table | Policy | Before | After |
| --- | --- | --- | --- |
| `enrollments` | `enrollments_select` | `(user_id = me and is_active_user()) or can_support_offering(offering_id)` | `user_id = me or offering_id in (select my_supported_offerings())` |
| `enrollment_requests` | `enrollment_requests_read` | `is_active_user() and (user_id = me or can_support_offering(offering_id))` | `user_id = me or offering_id in (select my_supported_offerings())` |
| `course_offerings` | `course_offerings_select` | `can_support_offering(id) or is_enrolled(id)` | `id in (select caller_viewable_offerings())` |
| `offering_staff` | `offering_staff_select` | `can_support_offering(offering_id)` | `offering_id in (select my_supported_offerings())` |
| `homework_assignments` | `homework_read` | `homework_visible(id)` | `id in (select caller_visible_homework())` |

`is_active_user()` is dropped where it sat next to the caller: `current_app_user_id()` already returns only an active profile, so it was always true
when the caller was known. The restrictive `trusted_identity` policies stay.

### Helpers that answer the same, with the caller looked up once

`can_manage_group`, `can_view_group`, `homework_staff` and `homework_enrolled` keep their signatures, volatility (`homework_enrolled` stays VOLATILE),
grants and answers. Inside, they use `caller_offering_rights` / `caller_course_edit` / `caller_enrolled_offerings` instead of nesting
`can_manage_offering` → `has_org_role` → `is_active_user` …. One `can_view_group` call went from about 50 caller lookups to 3; one `homework_staff`
from about 15 to 2. Every other function that calls them (`group_command`, the homework and exam functions) gets the same answers, faster.

### Reads that took a helper per Group, course or run (create or replace; only the lines below differ)

- **`group_view`** (A4-01): `upcoming`, `list` and `offering:<run>` filter by `caller_visible_groups()` instead of `can_view_group` per Group;
  `staff` / `instructor` per row come from `caller_managed_groups()` / `caller_managed_offerings()`; `offerings` uses `caller_managed_offerings()`;
  `summary` uses `caller_managed_groups()`. The one-Group sections (`detail`, `sessions`, `members`, …) keep their single check, now through the
  faster helpers.
- **`homework_portal`** and **`exam_portal`** (A5-02, A6a-05): `eds` and `sups` come from `caller_editable_courses()` and `my_supported_offerings()`
  instead of `can_edit_course` per course and `can_support_offering` per run. The Home "Exams open now" card calls `exam_portal`, so it follows.
- **`exam_student_list`** (A6a-05): why the student list called `exam_settle` 25 times per read: it settled every listed exam on every read, and for
  almost all of them settling had nothing to do. It now calls `exam_settle` only for an exam meeting one of `exam_settle`'s own three conditions:
  a try of this student left open past its deadline; auto release with a corrected unreleased result on a closed exam; or a per-Group published
  exam with a Group window still to link. Those are the only cases in which `exam_settle` writes or locks anything. The calls happen in the list's
  order, as before, and `exam_settle` itself is unchanged.
- **`get_homework`** (A5-02) is unchanged; it gets faster through `homework_staff` / `homework_enrolled` (73 → 19 caller lookups for a student).
- **`homework_students`** and **`lesson_completion`** were checked: one authorization each, then the caller's id; no per-row helper, so no change.

Not in this track, same per-row pattern still in place: `lesson_progress_select`, `segment_progress_read`, `course_staff_select`,
`organization_memberships_select`, `media_assets_select`, the academic and website staff policies, and the closed legacy assessment tables. Reports
(2c) read `lesson_progress`/`lesson_segment_progress` through functions.

## Caching

No cache, as in 2a: the caller is resolved per statement. The suite proves that a suspension (enrollment and membership) and a token revocation inside
the transaction take effect at the next statement, for the sets and for the single-object helpers. It also proves that forged settings
(`request.jwt.claim.sub`, `lms.caller`, `app.current_user_id`) next to a student token change nothing, and that two tokens in one transaction each get
their own sets.

## Equivalence: 0 differences

### SQL suite `supabase/tests/my-scope-2b.sql` (28 checks, in the runner, about 145 s)

The old functions run side by side under `*_before` names. The four small helpers are copied verbatim. The four big reads are rebuilt from their live
definitions by undoing the migration's edits, and each must match the md5 of its pre-migration definition, byte for byte. `get_homework`,
`homework_students` and their sub-functions are re-pointed at the old helpers. 43 callers: 2a's 39, plus a student in two Groups of one course (two
runs: one active Group per run is enforced), a student transferred from G1 to G2, a student whose Group starts tomorrow, and a run instructor who is a
member. The fixture adds 9 Groups (active, archived, in an archived run, an archived course, a draft course, a suspended space, another space), sessions,
attendance, 10 homework (published, on a draft part, on a draft lesson, draft, closed, in other runs, a newer version), tries, 8 exams (per-Group open,
same-time closed with auto release, paper, draft, archived, other spaces), a try left open past its deadline, and join requests.

- 903 set, helper and policy comparisons (43 × 21): every set equals its helper on every row; `caller_offering_rights`, `caller_course_edit`,
  `can_manage_group`, `can_view_group`, `homework_enrolled` and `homework_staff` (7 capabilities) equal the old ones on every run, course, Group and
  homework, and on unknown ids; the five policies return exactly the rows of the old expressions.
- 6,192 reads as JSON, old vs new, each in its own rolled-back subtransaction, with a digest of the rows it wrote (tries, results, linked windows,
  audit, notices, sessions, attendance): `group_view` (summary, upcoming, list, offerings, history, a search, `offering:` for 5 runs, and 8 sections
  for each of 9 Groups, plus an attendance session), `get_homework` (every homework, every try), `homework_students`, `homework_portal` (3 tabs × all
  and 4 courses), `exam_portal` (4 tabs × all and 4 courses), `exam_student_list`.
  - The attendance-session read snapshots the roster at call time, so the old function differs from itself in `roster_at` and the rows'
    `updated_at`. The suite proves exactly that, and compares that one read without those two keys.
  - `serverNow` and `secondsLeft` (clock values) are left out everywhere.
  - A result a settle creates gets a random id, so results are compared by exam and student.
- The old list settles every listed exam; the new one only those with something to do. The rows written are equal.
- EXPLAIN: each of the five policies evaluates its set once (hashed SubPlan), no per-row helper.

### Large fixtures, `scripts/my-scope-2b-proof.cjs` (on demand)

Fixture: the suite's role matrix, a demo fill, 2a's Part 1 platform (200 spaces through the real provisioning; the big space with 2,000 students in two
runs), plus a run instructor and 300 pending join requests there. Space X: one owner, one assistant on every run, 1 course and then 200 more with 400 more
runs, each with a homework and an open exam; a student enrolled in 25 of them, 24 per-Group. Groups grow 11 → 31 → 61 → 111 → 211: the big space's
students in 10 Groups (the assistant in two), then Groups in other spaces. 206 spaces, 2,009 courses, 2,012 runs, 2,614 profiles, 4,071 enrollments
before the growth. The old database is re-cloned from the new one after every growth and given the old rules (`supabase/tests/my-scope-2b-before.sql`,
the old policies and functions verbatim), so the rows are identical.

| Check | Result |
| --- | --- |
| Migration on the filled database: 111 tables keep their counts; second run changes nothing; catalog equals a full replay | pass |
| `group_view` old vs new at 11, 31, 61, 111, 211 Groups (8 callers at 11 and 31, 54 callers at 61+; 23 reads each) | 4,054 reads, **0 differences** |
| Portals and homework in space X, 1 course and 201 courses (54 callers: portals by tab and course, the exam list, get_homework and homework_students on 40 homework, the lesson list) | 7,884 reads, **0 differences** |
| Row sets: 54 callers × 5 tables, every row (count and md5 of every id), no time limit | 270 pairs, 13,905 rows, **0 differences** |
| EXPLAIN (`.local/my-scope-proof/explain-2b.txt`) | every set once (hashed SubPlan, or a hash semi join for the Groups set), the set function `loops=1`, no helper |

## Before → after (local PostgreSQL 17, 20 cores; a fresh connection per call, statement_timeout 8 s; call counts from pg_stat_xact_user_functions)

**A4-01, `group_view`** (ms; `can_view_group` calls old → new; new is 0 everywhere):

| Groups on the platform | student Home "upcoming" | student Groups list | owner Groups list (big space) | assistant Groups list (2 Groups) | assistant Home |
| --- | --- | --- | --- | --- | --- |
| 11 | 56 → 9 (11 calls) | 45 → 14 | 40 → 4 | 44 → 4 | 56 → 15 |
| 31 | 119 → 11 (31 calls) | 110 → 20 | 100 → 12 | 145 → 12 | 119 → 9 |
| 61 | 23 → 9 (1) | 15 → 12 | 44 → 19 (10) | 85 → 12 (10) | 47 → 9 |
| 111 | 23 → 10 | 13 → 16 | 42 → 12 | 83 → 14 | 45 → 9 |
| 211 | 33 → 9 | 16 → 18 | 42 → 19 | 90 → 12 | 45 → 15 |

At 11 and 31 Groups the old read checked every Group on the platform, as the audit found. From 61 the planner chose "candidates first" in this run
(fresh statistics), which the audit warned is a planner choice and not a guarantee: its run saw 1.1 s at 61 Groups. The new read takes the caller's
Groups as one set, whatever the plan; caller lookups per read went from up to 538 to at most 15.

**A6a-05** (space X):

| Read | 1 course | 201 courses, 401 runs |
| --- | --- | --- |
| `exam_portal` open, owner | 18 → 11 ms | **581 → 56 ms** (2,008 → 6 caller lookups) |
| `exam_portal` open, assistant | 16 → 10 ms | **1,419 → 51 ms** (6,220 → 6; audit 1,513 ms) |
| Student exam list (25 exams, 24 per-Group) | 4 → 5 ms (1 → 0 settles) | 23 → 15 ms (**25 → 0 `exam_settle` calls**; audit: 55 ms) |

The rest of the exam list's time is the exam's own window computation (`exam_student_window`), which the owner asked to leave as it is.

**A5-02:**

| Read | 1 course | 201 courses |
| --- | --- | --- |
| `get_homework`, student with a handed-in try | 35 → 19 ms (73 → 19 caller lookups; audit: 193 lookups, 53 ms) | 30 → 19 ms |
| Lesson homework list (7 homework), student | 30 → 6 ms (84 → 5) | 29 → 10 ms |
| Lesson homework list (7 homework), owner | 11 → 13 ms | 9 → 20 ms (see below) |
| `homework_portal` open, owner / assistant | 16 → 13 / 13 → 12 ms | **541 → 22 / 1,383 → 18 ms** |
| `homework_students`, assistant | 14 → 8 ms | 20 → 7 ms |

One read got slower: a space owner's direct lesson homework list. With 201 courses the owner's visible-homework set covers all 400+ homework once, where
the old rule checked the 7 rows (9 → 20 ms). It stays small and flat; a student's list, the common case, went from 29 ms to 10 ms.

**A3-05** (the big space, 4,071 enrollments on the platform):

| Read | Before | After |
| --- | --- | --- |
| A student's `count(*)` on `enrollments` | **5,114 ms** (20,469 caller lookups; audit 4.4–4.9 s) | **6.6 ms** |
| Signed-in person with no space, the same | 5,091 ms | 3.9 ms |
| A student's `count(*)` on `enrollment_requests` (305) | 447 ms | 3.6 ms |
| Owner reads the 2,000-student run (1,000 rows) | 1,072 ms (audit 2,576 ms for 2,000) | 5.2 ms |
| Run instructor reads the same | 2,289 ms (audit 4,999 ms) | 4.4 ms |
| Owner reads the 300 pending join requests | 382 ms | 3.9 ms |
| A student reads `course_offerings` (2,012 runs) | 3,862 ms | 4.4 ms |
| Owner reads `offering_staff` | 553 ms | 3.7 ms |

## Tests

- New: `supabase/tests/my-scope-2b.sql` (listed after `my-scope` in `scripts/exam-sql-local.cjs`; `LMS_SQL_ONLY=my-scope-2b`),
  `supabase/tests/my-scope-2b-before.sql` (the old rules, for the proof only), `scripts/my-scope-2b-proof.cjs` (`MY_SCOPE_ONLY=build,apply,groups,space,
  enrol,rows,explain`, `MY_SCOPE_LEVELS=11,31`, `MY_SCOPE_PART=k/n` for `rows`, `MY_SCOPE_REUSE=1`, `MY_SCOPE_KEEP=1`). The fresh run used:
  `build,apply,groups,space,enrol,explain` (178 s), then `rows` in four parts (126–165 s each). Results in `.local/my-scope-proof/result-2b-*.json`.
- Unchanged and passing: 2a's `my-scope` (32), Track 1's `direct-access-closed` (149), batch 2's `homework-marks` (71), and every Group, homework, exam,
  student-administration, reports and live-class suite with their races.

## What the owner's chat must check on dev after applying

1. A student: Home ("upcoming" sessions and Exams open now), the Groups list, one Group's page and sessions, the lesson page's homework list, a
   homework page (questions, tries, marks, answers), the Exams page (open, coming up, results). Same content as before.
2. A student in two runs of one course and a transferred student see the Groups they saw before; a suspended or expired student sees none.
3. A teacher (owner), a run instructor and an assistant: the Groups list with Staff/Instructor badges, a Group's members, eligible students, staff and
   audit; the teacher Homework page (open, closed, drafts, the students list) and the Exams page (each tab, the live Group counts).
4. An assistant who is group staff of one Group manages that Group and not the others.
5. An exam with a try left open past its deadline: the student's exam list still auto-submits it (the try shows handed in).
6. Speed in the dev logs: the Groups list, Homework page and Exams page in tens of milliseconds; a student's `select count(*) from enrollments` through
   the Data API answers quickly with their own count.
7. The five policies' text matches the "After" column above.
