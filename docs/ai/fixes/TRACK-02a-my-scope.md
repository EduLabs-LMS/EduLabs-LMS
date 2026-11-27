# Fix track 2a: "my scope" for the page context and lesson content

Branch `claude/fix-02a-my-scope` (from `claude/ui-batch-2` at `059d394`). Status: **done in the branch (code commit `8c2e229`), awaiting the dev check.**
Nothing was applied to any hosted project, merged or deployed. The owner's chat applies the migration to dev after review.

Findings: **A0-01** (High), **A1-01** (High), **A2a-01** (Medium), **A0-07** (Medium). Track 2b (Groups, homework, exams, enrollments: A3-05,
A4-01, A5-02, A6a-05) and 2c (reports: A8-02, A8-04) are not part of this track.

Migration: `supabase/migrations/20261127140000_my_scope_content.sql`
SHA-256: `623c52b784fa9e4ddb234c8af9fece350bd6228464fac233e6fbb9b79bcbd1c7` (one new line in `scripts/migrations.sha256`, `-text` in `.gitattributes`).

## The rule this track makes true

A read policy never runs a permission helper once per row. Each of the eight content and account read policies checks the row against a set of ids the
caller may see, and PostgreSQL computes that set **once per statement** (an uncorrelated `IN (select private.my_…())`, planned as a hashed SubPlan).
Each set is written from the existing helpers' own rules, so who may see what is unchanged. The existing helpers are unchanged as well: every function
that calls them keeps its meaning.

## What changed

### Database (the migration)

New functions, all `security definer`, `stable`, `search_path=''`, executable by `authenticated` only (revoked from `public`, `anon`, `service_role`):

| Function | Returns | Old helper whose rule it is |
| --- | --- | --- |
| `private.my_space_roles()` | the caller's active spaces with the role in each | `has_org_role`, `is_org_member` |
| `private.my_course_access()` | every course the caller may view, with `staff` | `can_view_course` (staff = `can_edit_course` or `is_course_staff`) |
| `private.my_viewable_courses()` | course ids | `can_view_course` |
| `private.my_staff_courses()` | course ids | `can_edit_course` or `is_course_staff` |
| `private.my_visible_lessons()` | lesson ids | `can_view_lesson` |
| `private.my_visible_segments()` | part ids | `can_view_segment` |
| `private.my_viewable_organizations()` | space ids | the old `organizations_select` expression |
| `private.my_supported_offerings()` | run ids | `can_support_offering` (ready for track 2b) |
| `private.my_visible_profiles()` | profile ids | `can_view_profile` |
| `private.my_scope()` + `public.my_scope()` (invoker wrapper) | `{organizations, courses}` with the fields the page context reads, first 101 of each by id | the old unfiltered `order by id limit 101` reads under RLS |

Every true branch of the old helpers names a row that points at the caller (a membership, a `course_staff`, an `offering_staff` or an enrollment row),
so the sets start from those rows. The rules are listed at the top of the migration.

Replaced policies (same name, command and role; `alter policy … using`):

| Table | Policy | Before | After |
| --- | --- | --- | --- |
| `courses` | `courses_select` | `can_view_course(id)` | `id in (select private.my_viewable_courses())` |
| `organizations` | `organizations_select` | `is_org_member(id) or exists(course … can_view_course)` | `id in (select private.my_viewable_organizations())` |
| `profiles` | `profiles_select` | `can_view_profile(id)` | `id in (select private.my_visible_profiles())` |
| `course_modules` | `course_modules_select` | `can_view_course(course_id)` | `course_id in (select private.my_viewable_courses())` |
| `lessons` | `lessons_select` | `can_view_lesson(id)` | `id in (select private.my_visible_lessons())` |
| `lesson_blocks` | `lesson_blocks_select` | `can_view_lesson(lesson_id)` | `lesson_id in (select private.my_visible_lessons())` |
| `lesson_segments` | `segments_read` | `can_view_segment(id)` | `id in (select private.my_visible_segments())` |
| `lesson_resources` | `resources_read` | `can_view_segment(segment_id)` | `segment_id in (select private.my_visible_segments())` |

The restrictive `trusted_identity` policies stay. No grant on an existing object changes; nothing is dropped; no `CASCADE`.

**A0-07.** `private.save_segment_progress` no longer calls `can_view_segment`. It already refused an unpublished part, a caller not enrolled in an active
run of a published course (`is_enrolled`) and a run of another course. Given those, `can_view_segment` reduces to "the lesson is published, or the
caller is staff of the course". The new check is exactly that. The staff helpers run only for a draft lesson, so a course editor enrolled in their own
course can still save a published part of a draft lesson, as before. Everything else in the function is unchanged (including the `FOR SHARE` on the
part, A2a-08, and `now()`, A0-14, which are other findings).

### Server

- **Page context (A1-01).** `server/repositories/website.ts` `scope()` calls `my_scope` once; `getWebsiteContext` (`server/services/website.ts`) uses it in
  place of the unfiltered `organizations` and `courses` reads, then reads the courses' runs by course id as before. `repository.organizations()` is gone
  (it had no other caller). The context's shape is unchanged.
- **Student lesson page (A0-01, A2a-01).** `learningService` (`server/services/lessons.ts`) no longer has `tree()`. It has:
  - `outline()`: chapters (`id,title,group_type,position`), lessons (`id,module_id,title,position,status`) and parts (`id,lesson_id,title,position,status`),
    published only for a student. No content.
  - `lesson(outline, id, segmentId)`: the parts, content items and the one part's attachments of ONE lesson of that outline (refused with 403 for an id
    that is not in it).
  - Every read pages 1,000 rows at a time (PostgREST's `max_rows`) in a stable order, ids grouped 100 per request. The old 50-lesson batches with their
    500-row limit are gone. Past 20,000 rows a read answers 413 "This lesson is too large to show".
- Callers of the old `tree()`, each showing exactly what it showed before:
  - `secure-lesson-page.tsx` renders `studentLessonPage` (new, `server/services/student-lesson-page.ts`), which is the page's old logic on the outline
    and the opened lesson. The enrollment check still runs first.
  - `secure-lesson-overview.tsx` uses `outline()` (it never showed content).
  - `learning-part-page.tsx` (teacher) checks the part against `outline()` for staff (every part, draft or not, as before).
- **Too large is never "unavailable".** A 413 shows "This lesson is too large to show. Please tell your teacher." (`lesson_page.too_large` in English and
  Arabic for the lesson page; the part page's own English text), not "unpublished, unavailable or your enrollment has expired".
- `continuePart` is generic over the fields it reads (`id`, `position`, `status`), so the outline's parts can be passed to it; `lessonBlockViews` takes
  anything with `blocks`. `shared/contracts/database.types.ts` gains `my_scope` (additive).

## The caching decision: no cache

The caller is **not** cached across statements. Reasons:

1. A transaction-local cache (`set_config(…, true)`) would keep answering with a profile that the same transaction has just suspended, or whose token it
   has just revoked (`revoke_my_firebase_identity` moves `tokens_valid_after`). Today the helpers see those changes at the next statement; a cache would
   not. Keying the cache to the token's `iss`/`sub` does not help, because the token stays the same while the profile or identity changes under it.
2. PostgreSQL has no reliable per-statement key. `statement_timestamp()` is shared by every statement of one multi-statement message and by everything
   inside one `DO` block, which is exactly how the SQL suites and the demo functions run.
3. It is not needed. Each my_* function resolves the caller once (a materialized CTE), and the policy runs each function once per statement. A statement
   now resolves the caller a handful of times (about 0.3 ms each), instead of thousands of times.

The tests prove that no setting a client could set changes who the caller is, and that nothing carries over between transactions:

- `supabase/tests/my-scope.sql` section 4: a suspension, then a token revocation, inside the same transaction take effect at the next statement; another
  token in the same transaction gets its own rows; `request.jwt.claim.sub`, `lms.caller`, `app.current_user_id` and a session-level `my_scope.caller`
  change nothing.
- `scripts/my-scope-proof.cjs` "isolation": on ONE connection, consecutive transactions as the owner, a student, no token, the owner, the student each
  get exactly their own rows; after commit no token setting is left on the connection; forged settings (transaction and session level) next to a student
  token change nothing.

## Equivalence (old rule vs new rule)

### SQL suite `supabase/tests/my-scope.sql` (32 checks, in the regular runner)

The role fixture: a space with an owner, an admin, a teacher with no course, assistants with and without a run, course staff owner, instructor, editor
and assistant, an offering-staff member who left the space, students active, suspended, cancelled (removed), expired, future, invited, completed, in an
archived run, in a draft course, of another space, in two spaces, a signed-in person with no space, a platform admin, a suspended profile, a suspended
and an invited membership, a suspended space with its teacher and student, a revoked token, an enrolled course editor; plus the 7 seed users, an
unmapped token and no token: **39 callers**. Courses published, draft and archived; runs active, archived and draft; lessons, parts, items and attachments
published and draft.

- 312 caller × table pairs (39 × 8): the rows each policy returns equal the rows the OLD policy expression accepts. **0 differences**; 149 pairs non-empty.
- 351 set comparisons (39 × 9): each my_* set equals its old helper applied to every row of its table, and `my_scope()` equals the old reads.
  **0 differences.**
- Anonymous: 42501 on every table and on `my_scope`, as before.
- 312 progress saves (13 callers × 4 runs × 6 parts): the new `save_segment_progress` gives the same answer as the old one (kept in the suite as
  `save_segment_progress_before`). **0 differences.** A student cannot save a published part of a draft lesson; an enrolled course editor still can.
- The plan: a student's block read and an unfiltered course read show a hashed SubPlan and no per-row helper.

### Large fixtures, `scripts/my-scope-proof.cjs` (run on demand)

One database holds all fixtures: the role fixture above, a demo fill (`demo_fill_core`), Part 2a's course (10 chapters × 6 lessons, 10 text items of
~400 characters and one published video part each, one active run, seed student 5 enrolled), and Part 1's platform (200 spaces made with the real
`platform_provision_teacher` and accepted with the real `accept_teacher_invitation`, 10 published courses with one run each; one space with 2,000
students in two runs each, 4,000 enrollments, and 20 staff). In all 205 spaces, 2,009 courses, 2,287 profiles, 4,048 enrollments, 85 lessons, 633 items.
`myscope_old` is a clone with `supabase/tests/my-scope-before.sql` (the eight old policies and the old function, byte for byte), so rows are identical
and only the rules differ.

| Check | Result |
| --- | --- |
| Migration on the filled database (a third clone): every one of 111 tables keeps its row count; a second run changes nothing; policies and functions equal a full replay | pass |
| Row sets: 47 callers (the role matrix, seed users, the demo owner and admin, Part 1's student, the big-space owner, a small-space owner, a big-space teacher and assistant, anonymous) × 8 tables, every row (count and md5 of all ids) | 376 pairs, 6,178 rows in 170 non-empty pairs, **0 differences** |
| Server: the OLD code (git `059d394`) on the old rules vs the NEW code on the new rules, through a PostgREST-shaped client (one transaction per request, the caller's token, role `authenticated`, `max_rows` 1000), as JSON | **0 differences** in 45 page contexts, 68 Home scopes (Home and one space), 106 lesson part pages (19 shown, the rest unavailable or refused for both), 66 lesson pages, 210 teacher part checks |
| Caller isolation on one connection (above) | pass |
| A2a-01: one more item per lesson (660 items in 60 lessons) | old page: 413, which the page showed as "unpublished or expired"; new page: the lesson with its 11 items |

The old lesson part page is replayed line for line from `secure-lesson-page.tsx` at `059d394` (`oldLessonPage` in the script). The old course tree is
read once per caller and course (nothing writes in between) because it is the slow part.

## Before → after (local PostgreSQL 17, 20 cores, warm, each request its own transaction with `statement_timeout` 8 s)

Measured on the combined fixture, so the Part 2a numbers also carry the 200-space platform. The old numbers here are lower than the audit's for the
lesson page because this client sends typed ids, which lets the old reads use their indexes too.

| Read | Before | After |
| --- | --- | --- |
| Student lesson part page, total (14 → 12 statements) | **5,905 ms** (the 60-lesson items read alone 4,017 ms; audit: 11,485 ms) | **42 ms** (slowest statement 7 ms) |
| Owner reading the course (old: the whole tree; new: outline + the opened lesson) | 691 ms (audit: 857 ms) | 22 ms |
| Student Home: page context | 11,618 ms | 11 ms |
| Student Home: context + `loadWebsiteScope` | 18,721 ms (audit, Home only: 2,135 ms on a smaller platform) | 33 ms |
| Part 1, spaces and courses for the page context (student, big-space owner, small-space owner) | 12.2–12.4 s (two reads of 6.1–6.2 s; audit 7.4–7.6 s each) | 3.5–4.3 ms (one `my_scope` call) |
| Part 1, page context total (same three) | 12.2–12.5 s | 9–23 ms |
| Part 1, the old unfiltered `organizations` / `courses` reads, sent directly | 6.1–6.2 s each | 2.5–4.8 ms |
| Direct `select count(*)` on `courses`, `organizations`, `profiles` (student; signed-in person with no space) | 6.1–6.3 s each (audit 6.7–7.7 s) | 2.2–4.7 ms |
| Big-space owner reading their 2,000 students' names from `profiles` | 3,444 ms (audit 4.2 s) | 6.5 ms |
| One progress save (median of 7) | 17.2 ms (an earlier run: 12.8 ms; audit 20.6 ms) | 6.4 ms (an earlier run: 3.2 ms) |

EXPLAIN (ANALYZE, BUFFERS) of the new student block read of one lesson (`.local/my-scope-proof/explain-blocks-new.txt`): index scan on `lesson_id`,
filter `ANY (lesson_id = (hashed SubPlan 2).col1)`, `SubPlan 2` runs **once** (`loops=1`, 61 visible lessons), 5.8 ms; no `can_view_lesson`.

## Tests

- New: `supabase/tests/my-scope.sql` (in `scripts/exam-sql-local.cjs`; `LMS_SQL_ONLY=my-scope`, about 60 s because it runs the old per-row rules too),
  `supabase/tests/my-scope-before.sql` (the old rules, used only by the proof), `scripts/my-scope-proof.cjs` (`MY_SCOPE_ONLY=<steps>`, `MY_SCOPE_PART=k/n`,
  `MY_SCOPE_KEEP=1`, `MY_SCOPE_REUSE=1`; each step fits the 10-minute foreground limit; results in `.local/my-scope-proof/`).
- Changed: `scripts/teacher-homework-correct.test.cjs` (the "enrollment check before the read" source check names `service.outline()` instead of
  `service.tree()`, and the same check now covers the part page); `scripts/teacher-foundation.test.cjs` (a `track02a` pin table: the SHA-256 of the
  new content of the 7 baseline files this track changed; it supersedes Track 1's pin for the two website files); `scripts/exam-sql-local.cjs` (the
  suite is listed before `live-class`, which a test pins as last).
- Unchanged and passing: Track 1's `direct-access-closed` (149) and batch 2's `homework-marks`.

## What the owner's chat must check on dev after applying

1. A student opens a lesson part and the lesson page of a course with several chapters: chapter label, part list, previous/next, items, attachments, video,
   homework section; progress saves while the video plays.
2. A student who is suspended, removed, expired or not yet started sees "unavailable"; a draft lesson is unavailable.
3. Home and Continue Learning for a student; the teacher Home, Courses, a course page and Settings for an owner, a teacher and an assistant (the menu's
   spaces and the course list are the same as before).
4. A teacher opens `/teacher/courses/<course>/chapters/<part>` for a draft part and gets the editor frame, not 404.
5. Timings in the dev logs: a lesson page and the page context in tens of milliseconds, not seconds.
6. `select count(*) from courses` as a student through the Data API answers quickly with their own count.
7. The policy text of the eight tables matches the "After" column above.
