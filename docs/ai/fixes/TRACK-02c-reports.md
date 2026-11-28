# Fix track 2c: reports read only what they show

Branch `claude/fix-02c-reports` (from `claude/fix-02b-my-scope` at `13b07fa`). Status: **done in the branch (code commit `f80c608`), awaiting the dev
check.** Nothing was applied to any hosted project, merged or deployed. The owner's chat applies the migration to dev after review. This is the last
part of Track 2 (2a, 2b, 2c).

Findings: **A8-02** (Medium) and **A8-04** (Low). Every number and rule is unchanged: "not marked", draft-lesson homework, open homework, Cairo
months and Last 4 weeks, released exam marks, and the 2026-11-27 homework rules (a self-marked mark counts at hand-in, through `released_at`).
**"Whole course" is not capped** to a school year or any other window.

Migration: `supabase/migrations/20261128130000_reports_scope.sql`
SHA-256: `7d0005d96beaa5502cadb0eace249f24b4e6ec9bc1b943f364600937036e1aa5` (one new line in `scripts/migrations.sha256`, `-text` in `.gitattributes`).
Read-only: no table, no column, no index, no write.

## What changed

### Database

**The fact functions take a scope.** `report_sessions`, `report_homework`, `report_exams`, `report_facts` and `report_stats` get a second signature
with `(p_groups uuid[], p_user uuid, p_active_only boolean)`. With a scope, each returns exactly the rows of the unscoped read that match it:
- `p_groups`: the rows whose `group_id` is one of these Groups (the student's Group at the time, decided as before);
- `p_user`: the rows of this student;
- `p_active_only`: the rows of students whose enrollment in that run is active now.

A student can be in a Group's numbers only if they were ever a member of it, or took an exam in its window. Only those students are read, the
Group is then decided per fact by the old rule, and the rows of other Groups are dropped. The scoped functions are PL/pgSQL with
`plan_cache_mode=force_custom_plan`, so a scope is planned as an index lookup.

The old signatures stay, because `homework-marks.sql` and the old callers use them. They now call the new function with no scope, so there is one
rule, not two copies.

Inside, four places work out the same value with less reading. Each is marked in the migration:
- **The homework's points** (`tot`) are summed once per homework version, not once per hand-in. The per-hand-in sum was 1.3 s of a big run's
  Whole course.
- **`exam_last_close`** runs only for the exams that reach the last step. Before, it ran for every online exam of every run, even when no exam
  was in the range: 189 ms of the owner's Needs attention at 50 teachers.
- **The exam results** (`res`) are read only for exams with a window in the range or whose last window is in it. Those are the only places
  `res` is read.
- **A Group window's no-shows** are read from that Group's members at the time, then their enrollment. Before, every enrolled student's
  memberships were probed once per window, and on the bigger platform the planner chose an index that scanned the whole Group per probe (the
  old function slowed from 3.7 s to 6.2 s the same way).

**The five reads pass their scope** (`create or replace`; only these lines differ):

| Read | Before | After |
| --- | --- | --- |
| `report_group` (Group Report tab) | facts of the whole run, then `where group_id=p_group` (twice: facts and stats) | facts and stats of `array[p_group]` |
| `report_groups` (Groups list line) | facts of every run of the Groups, then filter; `can_support_offering` per Group | facts and stats of `p_groups`; `offering_id not in (select my_supported_offerings())` |
| `report_student` (Student page) | facts of the whole run, then `where user_id=p_student` | facts of `p_student` |
| `report_course` (Course Results) | `report_facts` of every run (sessions included, never used), then filter; `can_support_offering` per run | `report_homework` and `report_exams` only; `my_supported_offerings()` |
| `report_attention` (Needs attention) | stats of every student of every run, then `where active`; `can_support_offering` per run | stats with `p_active_only`; `my_supported_offerings()` for all courses |

`report_group` and `report_student` check one run and keep their single `can_support_offering` call; `report_attention` for one run does too.
Grants: the scoped functions are granted to nobody, like the ones they extend. The five reads keep theirs (authenticated only).

**Not changed:** `report_bounds`, `report_reasons`, `report_reason_count`, `report_pct`, and `report_caller`. A `report_groups` call may still send
1 to 100 Groups, so an older page keeps working. "Whole course" is not capped.

### The Groups list (A8-04)

`GROUPS_PER_READ` goes from 100 to 25, the list's page size (`shared/contracts/teacher-reports.ts`). `useGroupNumbers`
(`frontend/features/teacher-reports/groups-numbers.tsx`) reads the first page of 25 at once. Each next page is read when one of its cards comes
within 600 px of the screen (`useNearScreen`, an IntersectionObserver; where there is none, at once).

The cards look as they did: a skeleton line until their page arrives, then the line. A failed page shows the error with Retry on that page's cards
only. The route and its contract are unchanged.

### Needs attention: why it does not "stop early"

The answer has `total`, the number of students who need attention. That needs every active student's numbers, so the read cannot stop after 25
without changing what it returns. It now reads only active students and the range's exams, and checks the runs with the set. Which students it
returns, and their order, are unchanged.

## Equivalence: 0 differences

### SQL suite `supabase/tests/reports-scope.sql` (12 checks, in the runner after `my-scope-2b`, about 200 s)

The ten replaced functions run side by side under `*_before` names. They are taken verbatim from `20261117120000` by the same generator that
writes `supabase/tests/reports-scope-before.sql`, which the proof checks against the migration file.

Fixture:
- a demo fill;
- school S (2 runs × 3 Groups × 8 students, 14 sessions, 9 homework, 6 exams over 120 days) with:
  - a suspended student;
  - a reactivated one, as `student_administration('reactivate')` writes it (status active, `enrolled_at` = now);
  - one transferred from Group 1 to Group 2 halfway;
  - one who joined halfway;
  - three students in no Group;
- another space S2;
- S3 with 30 Groups, so the owner's list takes two pages.

The school's homework and exams cover every state:
- homework on a draft lesson, a draft, a newer version, no marks, self-marked released at hand-in, released by the teacher, waiting, and open;
- exams that are paper, same time, per Group, per Group with auto release, archived, and ahead.

Comparisons:
- **Facts, 3,936 comparisons** (as the table owner). Every run × 4 ranges (Last 4 weeks, this month, last month, Whole course) × the three fact
  functions and `report_facts`: unscoped (old signature and new), all of a run's Groups at once, each Group, each student, and active only.
  `report_stats` by Group and active only, also for every run of a space at once.
- **Reads, 8,190 comparisons**, as JSON or the same refusal, for 18 callers:
  - the callers: owner, admin, teachers, an assistant with a Group and one without, course editor, course assistant, a student, other spaces'
    owners and teachers, the demo owner, a platform admin, a person with no space, and no token;
  - the reads: `report_group` (every Group, 4 ranges), `report_student`, `report_course` (every course, 4 ranges), `report_attention` (all
    courses and each run, 3 pages), and the Groups list in pages of 25 joined back, equal to the old single read and to the same single call.
- Structure: the scoped functions' language, settings and grants. `report_groups`, `report_attention` (all courses) and `report_course` use the
  set; only `report_attention`'s one-run check calls `can_support_offering`, once.

### Large fixtures: `scripts/reports-scope-proof.cjs` (on demand)

Old database vs new on the same rows (the old one is the new one plus `reports-scope-before.sql`). Fixture: the suite's demo fill and its school
builder at Part 8's sizes, 1,035,884 attendance rows in all:

| School | Size | Attendance rows |
| --- | --- | --- |
| A | 1 teacher, 3 Groups × 30, 72 sessions, 40 homework, 8 exams, one year (the stated size) | 6,444 |
| T20 | 20 teachers with that | 129,564 |
| T50 | 50 teachers | 323,964 |
| B | 1 run, 10 Groups × 200, 72 / 40 / 8 (the big school) | 143,964 |
| C | the same with 3 years: 216 / 120 / 24 (the big old school) | 431,892 |

| Check | Result |
| --- | --- |
| The old database has the ten functions exactly as `20261117120000` defines them | pass |
| The migration on the filled database: 111 tables keep their counts; a second run changes nothing; catalog equals a full replay | pass |
| A: every Group, every student of run 1, the course, attention and the Groups list, 4 ranges, 9 callers | 3,546 reads, **0 differences** |
| T20, T50: Groups of runs 1, 2 and the last; the special students; the owner's list of 60 and 150 Groups | 738 + 744 reads, **0 differences** |
| B: all 10 Groups, the special and sampled students, Results, attention, the list (old reads with no time limit) | 882 reads, **0 differences** |
| C: the same at 3 years | 882 reads, **0 differences** |

The callers in each school: owner, admin, teacher, assistant of the run with a Group and without, course editor, course assistant, a student
(refused), and another space's owner (refused).

## Before → after

Local PostgreSQL 17, a fresh connection per call, 8 s statement limit, median of 3; teacher's own calls unless named. "Audit" is Part 8's machine.

**A8-02, one Group** (`report_group`):

| Size | Last 4 weeks | Whole course |
| --- | --- | --- |
| A: 3 × 30, 72 / 40 / 8 | 47 → 25 ms | 163 → 60 ms (audit 172) |
| T20: same, 20 teachers | 43 → 23 ms | 163 → 57 ms (audit 108) |
| B: 10 × 200 | 147 → 48 ms | **1,722 → 274 ms** (audit 2,276) |
| C: same, 3 years | 127 → 38 ms | **5,267 → 784 ms** (audit: timeout at 8 s; this machine 5.3–7.6 s) |

**A8-02, Student page and Results**:

| Read | B: 10 × 200 | C: 3 years |
| --- | --- | --- |
| Student page, Whole course | 685 → 24 ms (audit 921) | 2,047 → 38 ms (audit 3,758) |
| Student page, Last 4 weeks | 69 → 18 ms | 59 → 16 ms |
| Results, Whole course | **1,671 → 510 ms** (audit 1,084) | **5,154 → 1,744 ms** (audit 4,242) |
| Results, Last 4 weeks | 113 → 38 ms | 85 → 29 ms |

**Whole course and 1 s:** every Whole course read is under 1 s at the big-school size (B). At the big old size (C), the Group Report tab
(784 ms) and the Student page (38 ms) are under 1 s, but **Course Results is 1,744 ms**. Results is the whole run by definition: every student's
homework (236,180 student-homework rows over 3 years) and exams (48,066). Within the current rules it can't read less. Whether to limit "Whole
course" there is the owner's decision; nothing is capped.

**A8-04** (owner unless named):

| Read | 20 teachers (T20) | 50 teachers (T50) |
| --- | --- | --- |
| Owner's Groups list, old single read of 60 / 100 Groups | 686 ms (audit 750) | 1,692 ms (audit 2,018) |
| Owner's Groups list, one page of 25 (old → new) | 230 → 119 ms | 241 → 120 ms |
| Owner's Groups list, every page of 25 (sum; read as the owner scrolls) | 285 ms | 483 ms |
| `report_attention`, all courses, owner | 187 → 129 ms (audit 280) | 464 → 229 ms (audit 760) |
| `report_attention`, all courses, teacher | 91 → 23 ms | 157 → 23 ms |

The owner first waits for one page (about 120 ms), not 100 Groups (1.7 s). A single read of 100 Groups is still 1.3 s with the new functions,
because the per-Group sums are counted over the whole read. The list no longer sends one.

**`group_view` after 2b** (new only; 1 / 20 / 50 teachers):

| Read | 1 teacher | 20 | 50 |
| --- | --- | --- | --- |
| summary, teacher | 62 ms | 61 | 63 (audit 41 / 385 / 995) |
| upcoming, teacher | 9 ms | 13 | 14 (audit 15 / 371 / 965) |
| sessions (the Groups list page), teacher | 14 ms | 18 | 15 |
| sessions, owner | 15 ms | 14 | 14 |

`group_view` no longer grows with the size of the space.

## Tests

- **New:**
  - `supabase/tests/reports-scope.sql` (`LMS_SQL_ONLY=reports-scope`);
  - `supabase/tests/reports-scope-before.sql` (the old functions, for the proof);
  - `scripts/reports-scope-proof.cjs`:
    - steps (`REPORTS_ONLY`): `build`, `apply`, `equiv`, `time`;
    - `REPORTS_SCHOOLS=A,T20`, `REPORTS_PART=k/n` (callers), `REPORTS_REUSE=1`, `REPORTS_KEEP=1`;
    - the run used `build,apply`, then `equiv` for A, T20+T50, B in 2 parts, C in 4 parts, then `time`; each step under 10 minutes;
    - results in `.local/reports-proof/result-2c-*.json`.
  - `scripts/teacher-reports-browser.cjs`: a new step with 60 Groups. Only the first page (25) is read before scrolling, the next pages (25, then
    10) as the list scrolls, and every card gets its numbers. The browser checks pass, 20 groups.
- **Unchanged and passing:** `reports`, `reports-scale`, `reports-demo`, `homework-marks` (it calls the old fact
  signatures), 2a's `my-scope`, 2b's `my-scope-2b`, and Track 1's `direct-access-closed`.

## What the owner's chat must check on dev

1. **Apply** `20261128130000_reports_scope.sql` after `20261128120000`. The SHA-256 is above.
2. **Same numbers.** Before applying, note a few numbers. After, compare them:
   - a Group's Report tab in Last 4 weeks, this month, last month and Whole course;
   - a Student page;
   - Course Results;
   - the Students screen's Needs attention (all courses and one course);
   - the Groups list line.
   Every number, reason and list order should be the same. Include a student who was suspended and reactivated, one moved between Groups, and
   one in no Group.
3. **Groups list with more than 25 Groups** (an owner): the numbers appear on the first cards at once, and on later cards as you scroll. In the
   browser's network tab, each `/api/teacher/reports/groups` request carries at most 25 ids. Try airplane mode for one page: its cards show the
   error with Retry, and Retry fills them.
4. **Refusals unchanged:**
   - a student gets "unavailable" on every report;
   - an assistant sees their run's Groups;
   - a course editor sees Results but not a Group report;
   - another space's teacher is refused.
5. **Speed in the logs:** the Group Report tab's Whole course and the Student page answer in well under a second. Course Results, Whole course,
   of a big run with years of history may still take about 2 s: that is the open product question above.
6. Policies are not touched. Only the ten report functions changed (`select proname from pg_proc where proname like 'report_%'`): 20 before,
   25 after (the five scoped signatures).
