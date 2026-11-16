# Part 0: map, lock scan across the whole database, shared security helpers

Branch `claude/backend-audit`, from `claude/online-class` at `6e747bcb9b6fbdf6ec70f31547de6f48c96b811d`. Read-only: no code, migration,
test or config changed; nothing touched the VPS or any Supabase project. Earlier reports read first: `docs/ai/audit/` was empty, so the
predecessors are `HOMEWORK_DB_AUDIT.md`, `EXAMS_DB_AUDIT.md`, `REPORTS_AUDIT.md`, `ONLINE_CLASS_AUDIT.md` and `PASSWORD_RESET_AUDIT.md`
in `docs/ai/`.

**The owner's question:** is there anything like the earlier project, where one lesson save locked a whole organization? **No**, not in
that form:

- No function takes a table lock, runs DDL at runtime, or holds a lock across HTTP requests.
- Every RPC is a single autocommitted statement.
- No trigger makes child writes queue on a parent row.

There are smaller versions of the pattern, and they are worth fixing before launch:

- A student choosing a stage locks the whole space row.
- Every attendance save locks the whole run row.
- Every lesson save locks the whole course row.

All three were proven with two sessions. Each holds its lock for 5 to 25 ms, so today they serialize; they do not freeze.

The finding that comes closest to "the database is effectively locked" is a read, not a lock: a student opening one lesson costs
seconds of database time (finding 1).

## Scope

- **Every table** (111), function (382), trigger (108), policy and foreign key (240): the lock scan, the grant scan and the RLS scan
  cover all of them. The full list, grouped into parts 1 to 9 with each function's live migration, is the map in
  [README.md](README.md).
- **Shared security helpers** (the Part 0 group in the map), all `security definer`, `search_path=''`, `stable`, SQL:
  - `current_app_user_id` and `is_trusted_identity_token`: `20261010123515_firebase_identity_resolution.sql:42` and `:31`.
  - `is_active_user`, `has_org_role`, `is_org_member`, `is_course_staff`, `can_edit_course`, `can_manage_offering`,
    `can_support_offering`, `is_enrolled`, `can_view_course`, `can_view_lesson`, `can_manage_course_staff`, `can_view_profile`:
    `20261001230357_lms_authorization.sql:3-60`.
  - `is_platform_admin`: `20261024120000_platform_admin_teacher_provisioning.sql:22`.
  - `can_view_segment`: `20261013141230_complete_lesson_workflows.sql:53`.
  - `can_manage_group` and `can_view_group`: `20261014054726_complete_group_attendance_workflows.sql:98`, `:103`.
  - Triggers `touch_updated_at`, `reject_reparenting` and `check_lms_integrity`.
- **Lock-taking statements:** all 174, in 75 functions (the global inventory in README.md). The ones on shared rows were run for
  real; the rest were read.
- **Server boundary, at the level needed for locks:** `server/integrations/supabase.ts` (how a request reaches the database), and
  every `client.rpc(...)` and direct table write in `server/`, `app/`, `frontend/` and `shared/`.

## Findings, worst first

### 1. High · performance: a student opening a lesson costs seconds of database time (per-row RLS helpers)

- **Where:**
  - Policies `lessons_select` and `lesson_blocks_select` (`20261001230357_lms_authorization.sql:127`, `:141`), `segments_read` and
    `resources_read` (`20261013141230_complete_lesson_workflows.sql:60-61`).
  - They call `private.can_view_lesson` (`20261001230357:43`) and `private.can_view_segment` (`20261013141230:53`) for every row.
  - The caller is `tree()` in `server/services/lessons.ts:32-39`. The student lesson page and the lesson overview call it on every
    open (`app/(dashboard)/_components/secure-lesson-page.tsx:19`, `secure-lesson-overview.tsx:20`).
  - `tree()` reads every chapter, lesson, part, resource and block of the whole course, not just the lesson opened.
- **Why it is slow:** `can_view_lesson` calls `can_view_course`, which calls `can_support_offering`, which calls `can_manage_offering`;
  `has_org_role`, `is_org_member`, `is_enrolled`, `is_active_user` and `current_app_user_id` are called along the way. They are all
  security-definer SQL functions, which PostgreSQL cannot inline, so each nested call is planned and run on its own, for every row.
  Owners and editors are fast because `can_edit_course` answers first. Students go down the whole chain.
- **Evidence** (local PostgreSQL 17.10, 20 cores, almost empty database):

  | Read | Student | Owner |
  | --- | --- | --- |
  | `can_view_lesson` alone | 39.6 ms | — |
  | `can_view_segment` alone | 20.3 ms | — |
  | One lesson's 31 blocks | 634 ms | 41 ms |
  | `tree()` on a 20-lesson course (10 blocks and 1 part each): lessons | 21 rows, 394 ms | 27 ms |
  | `tree()`: parts | 21 rows, 429 ms | 13 ms |
  | `tree()`: blocks | 201 rows, **3,806 ms** | 246 ms |
  | `tree()` total | **4.6 s** | 0.29 s |

- **Failure scenario:**
  - 30 students open the lesson when class starts. That is about 140 s of database CPU in a few seconds, on the one database every
    space shares, so every other request slows down with it. That is the "whole database locked" symptom, caused by CPU instead of
    a lock.
  - A course with about 40 lessons of 10 blocks puts close to 500 rows in one blocks query (the service batches up to 501). That is
    roughly 10 s, longer than the per-role statement timeout Supabase documents for `authenticated` (8 s, not verified on this
    project). The student lesson page would then fail outright.
  - Hosted hardware is slower than this machine.
- **Already known?** `V1.md` lists per-row RLS on these tables as a risk; this is the first measurement of it.
- **Suggested fix (not done):**
  - Authorize once per request, not once per row. Either add one security-definer read RPC (for example `course_tree(course,
    offering)`) that checks access once and returns the published tree, or change the policies to the form
    `lesson_id in (select private.visible_lesson_ids())`, with one set-returning helper evaluated once per query.
  - Have the lesson page read only the opened lesson's blocks.
  - Re-measure with `reports-scale`-sized data.
  - Part 2 should own it.

### 2. High · security: a course editor can delete a whole course, with its chapters, lessons and blocks, by a plain table DELETE

- **Where:**
  - `grant delete on public.courses to authenticated` (`20261001230357_lms_authorization.sql:93`).
  - Policy `courses_delete using (private.can_edit_course(id))` (`:91`). `can_edit_course` includes course staff with role `editor`.
  - Foreign keys `courses → course_modules` and `course_modules → lessons` are `ON DELETE CASCADE`, and so is
    `lessons → lesson_blocks`.
  - The same holds for `lesson_blocks` (direct `DELETE` and `INSERT` grants, policy `can_edit_course`).
- **Failure scenario:**
  - An editor calls the Data API directly: `DELETE /rest/v1/courses?id=eq.<id>`, with the public publishable key and their own
    token. It could also be someone holding a stolen editor token.
  - The course and every chapter, lesson and block go with it. No audit row is written.
  - This skips everything `edit_course_structure` enforces: the delete blockers, the "list every lesson you were shown" rule, the
    stale-edit check and the course lock (DECISIONS.md, "Course content tree").
  - A course that has a run, a part, student progress or homework survives, because those foreign keys are `RESTRICT`. So the
    exposure is courses still being built, which is exactly what a teacher is writing before V1.
- **Evidence** (rolled back):
  - The owner made a course with `create_teacher_course`. It got 1 chapter, 2 lessons and 10 blocks, and user 4 became its
    `editor`.
  - As user 4: `delete from public.courses where id=$1` → 1 row.
  - After: modules 0, lessons 0, blocks 0, course gone.
- **Same class, for Parts 2 and 3** (direct table writes that skip the RPC rules; the server makes some of them itself, see
  README.md):
  - `courses` update of `status`/`visibility` by an editor.
  - `enrollments` insert/update by run managers. This skips `student_administration`'s audit and versioning; the capacity and
    interval triggers still run.
  - `lesson_progress` insert/update by the student. They can write `status='completed'` for any lesson they can see
    (`server/repositories/lms.ts:59` does this on purpose).
  - The legacy `assessments*` writes.
- **Suggested fix (not done):**
  - Revoke `delete` on `courses` and direct writes on `lesson_blocks`/`lessons` from `authenticated`, and keep the writes behind the
    audited RPCs.
  - Decide per table which direct writes the app still needs. The owner must approve any grant change.

### 3. Medium · lock: a student choosing a stage locks the whole space

- **Where:** `set_student_stage_preference`, `perform 1 from public.organizations where id=org for update`
  (`20261018203119_academic_programs_stages.sql:227`).
- **Who waits:**
  - Every other student choosing a stage in the space.
  - Every action in the space that takes the space row `FOR UPDATE`: the academic commands, the website commands, renaming the
    space, accepting an invitation, and the last-owner trigger.
  - Because `FOR UPDATE` conflicts with the `FOR KEY SHARE` that every foreign-key check takes, every insert of a row that names
    the space waits too: creating a course, a media upload, a membership, a support ticket, and **every notification event in the
    space**.
- **Evidence:** two sessions; the real functions as signed-in users. B waits with `wait_event=transactionid` and
  `pg_blocking_pids = {A}`, then finishes as soon as A commits (about 2,020 ms, because A was held open for 2 s on purpose).
  - P2a: student 5 picks a stage; student 6's pick waits.
  - P2b: student 5's pick blocks the owner's `create_teacher_course` (B holds a `tuple` lock on `organizations`).
  - P2c: student 5's pick blocks the `notification_events` insert that a homework release makes for that space.
  - Hold time of one pick: 4.8 ms.
- **Worst realistic case:** the first week of term, when hundreds of students pick their stage at once. Their picks queue one by one,
  and while they queue, each one makes the space's notifications, uploads and course creation wait its turn. In milliseconds per pick
  this is tolerable. The danger is that the space row is the most shared row in the system: anything that ever holds it longer
  (finding 6) stalls the whole space.
- **Justified?** Only partly. The code locks the space so that a suspension cannot race a preference grant. Nothing about a student's
  own preference row needs the space row exclusively.
- **Suggested fix (not done):**
  - Take the space row `FOR KEY SHARE` (or `FOR SHARE`), and let the admin-side commands keep `FOR UPDATE` (or `FOR NO KEY
    UPDATE`).
  - Across findings 3, 4 and 5: none of these functions changes a key column, so `FOR NO KEY UPDATE` would keep them serialized with
    each other without blocking foreign-key inserts.

### 4. Medium · lock: every attendance save locks the whole run (every Group of the course run)

- **Where:** `group_command` takes `perform 1 from public.course_offerings where id=target for update` before every action except
  `create` (`20261018100132_group_presentation_and_session_summary.sql:26`). That includes `attendance`, `finalize`, `reopen` and
  `session`, which change only one session of one Group.
- **Who waits:**
  - Attendance and edits in every other Group of the same run.
  - Every insert that names the run by foreign key: a homework or exam draft created in that run, an enrollment, a Group, a join
    request, an access link, a media row.
  - `student_administration` (accepting a student).
- **Evidence:**
  - P1a: attendance in Group 1 holds; attendance in Group 2 of the same run waits (`transactionid`, blocked by A).
  - P1b: `save_homework` in that run waits on the run row before its own checks run.
  - P1c (good news): while the attendance is open, a student's lesson-progress save in the same run finishes in 40 ms. Students are
    not blocked.
  - Hold times: one attendance save 21 ms; a 14-slot weekly schedule edit, which creates 182 sessions, 25 ms; archiving that Group
    25 ms.
- **Worst realistic case:** a big run with several Groups and assistants, everyone tapping attendance at the start of class. Each tap
  waits for the others in turn, about 20 ms each.
- **Justified?** For membership changes, yes: add, remove and transfer need the run lock for capacity and the one-Group-per-student
  rule (comment at `:25`). For attendance and session changes, no: the Group and session rows are already locked `FOR UPDATE` right
  after.
- **Suggested fix (not done):** take the run lock only for `add`, `remove`, `transfer`, `edit` and `archive`, and use
  `FOR NO KEY UPDATE`. Part 4 should check the order with `group_enrollment_interval` when doing this.

### 5. Medium · lock: every lesson, part or block save locks the whole course

- **Where:**
  - `edit_learning_content`, `perform 1 from public.courses c where c.id=p_course_id for update`
    (`20261110120000_lesson_publish.sql:21`), for every action including `edit_block`, `edit_segment` and `edit_lesson`.
  - `edit_course_structure` (`:118`) does the same for renames, moves, publish and delete.
- **Who waits:**
  - Every other editor of the same course.
  - Every insert that names the course: a new run, chapter, exam, homework or staff row.
  - `student_administration` (it takes the course `FOR SHARE`).
  - A student's stage pick does not wait: it **fails** (finding 8).
- **Evidence:**
  - P4a: a block save holds; a second teacher renaming another lesson of the course waits on a `courses` tuple lock.
  - P4b: an exam draft created in that course waits.
  - P4c (good news): a student progress save in the course is not blocked (55 ms).
  - Hold time of a block save: 3 to 19 ms.
- **Worst realistic case:** two assistants editing different lessons of one course take turns, a few ms each. Students only notice
  through finding 8.
- **Justified?** It makes renumbering and reordering safe, and the stale checks on each row already protect single-item edits. Locking
  the course for a text change inside one block is more than that needs.
- **Suggested fix (not done):** lock the course only for structural actions (create, reorder, move, delete, publish). For
  `edit_block`, `edit_segment` and `edit_lesson`, lock just that row with its `updated_at` check, and use `FOR NO KEY UPDATE`.

### 6. Medium · lock: no lock timeout or statement timeout is set anywhere

- **Where:** none of the following sets `statement_timeout`, `lock_timeout` or `idle_in_transaction_session_timeout`:
  - the migrations;
  - function `SET` clauses (every function sets only `search_path`);
  - role config (`anon`, `authenticated`, `service_role` have none in the replayed database);
  - `supabase/config.toml`;
  - `server/`, `scripts/lib`.

  The local server has all of them at 0 (unlimited).
- **Failure scenario:**
  - Every shared-row lock above is safe only because it is held for milliseconds.
  - If anything ever holds one of those rows longer, every waiter queues for as long as it is held. Examples: a slow future function;
    a person in the Supabase SQL editor running `begin; update organizations ...` and leaving the tab open; a slow trigger added
    later.
  - Each waiting request keeps a PostgREST database connection, so the pool runs out and every space's API stops, not just the one
    space.
  - On Supabase the only stop is the per-role statement timeout, if the project keeps the documented defaults (not verified).
  - The service-role push worker may have no limit at all.
- **Suggested fix (not done):**
  - Put `set lock_timeout = '3s'` on the functions that lock shared rows (function-level `SET`, so nothing else changes).
  - Or set role-level `alter role authenticated set lock_timeout = '5s'`, which needs owner approval.
  - Map 55P03 to "busy, try again" the way `server/services/academics.ts:11` already does.

### 7. Medium · performance: a lesson-progress save costs about 23 ms of database CPU

- **Where:** `save_segment_progress` (`20261013141230_complete_lesson_workflows.sql:173`) calls `can_view_segment` (20 ms; see finding 1)
  and `is_enrolled`. The video player debounces saves by 300 ms (`frontend/features/courses/lesson/video-player.tsx:78-104`).
- **Evidence:**
  - One student alone: p50 22.8 ms, p95 25.5 ms. An exam answer save is 1.6 ms.
  - 40 students at the same moment, 15 rounds: p50 89 ms, p95 139 ms.
  - Wait sampling during those 40 showed CPU 1,567 samples against `LWLock:LockManager` 82, and no heavyweight lock waits.
  - So this is cost, not locking: each student locks only their own enrollment, progress row and advisory key.
- **Suggested fix (not done):** the same as finding 1 (authorize once). Part 2 should also confirm how often the player calls it during
  playback.

### 8. Low · correctness: a student's stage pick fails if a teacher is saving a lesson or taking attendance at that moment

- **Where:** `set_student_stage_preference` takes `... for share of e,o,c nowait` on every enrollment, run and course row of the
  student in the space (`20261018203119:233`).
- **Evidence:**
  - P5: while a block save is open (course `FOR UPDATE`), the student's pick fails in 16 ms with
    `55P03 could not obtain lock on row in relation "courses"`.
  - The student sees "Permissions or enrollment are being updated. Please retry shortly." (`server/services/academics.ts:11`).
  - An attendance save in any of the student's runs does the same, through the run row.
- **Suggested fix (not done):** lock those rows `FOR KEY SHARE`, which does not conflict with an edit, or not at all. The suspension
  race the comment guards against needs only the enrollment rows.

### 9. Low · lock: renaming a live exam makes every student's answer save in it wait

- **Where:** `exam_save` takes the exam `FOR UPDATE` (`20261115120000_exams_drafts_and_demo_v7.sql:48`); every answer save takes it
  `FOR SHARE` (`exam_work`, `20261114120000_exams.sql:912`).
- **Evidence:** P3: the owner renames a published exam that a student is taking; the student's answer save waits on it. Hold: 14 ms.
  A save of questions on a started exam is refused in 2 ms.
- **Justified?** Yes. The wizard never autosaves a started or published exam (`frontend/features/teacher-exams/exam-wizard.tsx:123-125`),
  so this happens only on an explicit save of the details. Load test: 40 students saving answers in one exam at once gives p50 7.6 ms,
  so the shared `FOR SHARE` itself costs nothing noticeable.

### 10. Low · lock order: a direct `enrollments` UPDATE reverses `student_administration`'s order

- **Where:** a direct `UPDATE` locks the enrollment row, then its triggers lock the run (`enforce_capacity` at `20261001230358:117`,
  `group_enrollment_interval` at `20261014054726:392`). `student_administration` locks the run, then the enrollment
  (`20261106120000:219`, then `:273` and `:284`).
- **Failure scenario:** two run managers act on the same student at the same moment, one through `student_administration` and one
  through a hand-made `PATCH /rest/v1/enrollments` (allowed by `enrollments_update`). PostgreSQL's deadlock detector aborts one
  after 1 s.
- **Not proven; reasoned from the code.** The app never updates `enrollments` directly, so only a crafted call can trigger it. Finding
  2's fix (no direct writes) removes it.

### 11. Note · security: trusted token issuers are hard-coded, and every environment trusts the same Firebase project

- **Where:** `private.is_trusted_identity_token` (`20261010123515_firebase_identity_resolution.sql:31`) accepts:
  - `https://securetoken.google.com/diagonproduction` with audience `diagonproduction` and `email_verified=true`;
  - the native Supabase issuer of one project (`gmvouqgjbtbkbhrdruzu`).
- **What it means:** dev, staging and production databases all trust tokens from the same production Firebase project. A person's
  production token is accepted by the dev database, mapped to whatever profile has that `iss`/`sub` there.
- **No cross-tenant hole:** identity is the `(issuer, subject)` mapping, permissions are per database, and PostgREST still checks the
  signature.
- **But:** environments are not separated by the identity provider, and a new environment needs a migration to change the issuer.
- **Suggested:** an owner decision (separate Firebase projects per environment, or record that one project is intended); Part 1.

### 12. Note · testing: the local test server runs in Cairo time; hosted Supabase runs in UTC

- **What:** `show timezone` on the disposable server is `Africa/Cairo`, which `initdb` took from this machine.
- **Checked today:** every date path in the live code names the zone (`at time zone 'Africa/Cairo'`): `report_bounds`,
  `homework_week_start`, `materialize_group`, `demo_fill_core`, `exam_day_start`. The other `::date` casts are of text.
- **Risk:** a future `::date` or `date_trunc` on a `timestamptz` without a zone would pass every local test and be wrong by 2 to 3
  hours in production.
- **Suggested:** start the test server with `-c timezone=UTC` (a tooling change for the owner to approve).

### 13. Note · cleanup: two exam systems are both live

- **What:**
  - The legacy `assessments` / `offering_assessments` family is still called by the server: `save_exam_definition` v1 and v2,
    `get_exam_*`, `start/submit_assessment_attempt` and others (`server/repositories/exams.ts`, `server/services/exam-runner.ts`).
  - Its six `*_v17` inner functions are kept under new names, executable by `postgres` only.
  - Its locks (`lock_exam`, the `assessments` / `offering_assessments` `FOR SHARE` / `FOR UPDATE`) are in the inventory.
- **Suggested:** Part 6b decides what still needs it.

### 14. Note · correctness: `is_enrolled` uses `now()`, the other checks use `clock_timestamp()`

- **What:** `20261001230357:35`. `now()` is the start of the transaction. Every RPC is one statement, so today the two agree to the
  millisecond. Recorded only so later parts do not mix them inside long functions.

## Checked and fine

- **Locks**
  - No `LOCK TABLE`, runtime DDL, `TRUNCATE`, `REFRESH MATERIALIZED VIEW` or session-level advisory lock anywhere in the live code.
    `platform_audit` even has a no-truncate trigger.
  - The only dynamic SQL (`edit_learning_content`) uses `%I` with table names from fixed literals.
  - All 20 advisory locks are transaction-scoped, keyed per person, per person and item, or per item. None is per space or global.
  - No trigger serializes child writes on a parent row: no counters, no `updated_at` cascade.
  - The two deferred constraint triggers take only `FOR KEY SHARE` on the exam at commit (`SKIP LOCKED` for sessions).
  - The push worker claims deliveries with `FOR UPDATE SKIP LOCKED` and leases, so two workers never fight over a row.
  - Demo fill (308–377 ms, about 1,000 rows) and demo clear lock only that demo space's own `demo_spaces` row.
  - Student frequent writes lock only their own rows plus `FOR SHARE` on the shared parent: lesson progress, homework start, save
    and submit, and exam answer saves. A teacher's attendance save or lesson save does not block them (P1c, P4c), and 40 concurrent
    exam savers do not slow each other (p50 7.6 ms).
- **Transactions:** the server reaches the database only through PostgREST with the publishable key and the caller's token
  (`server/integrations/supabase.ts:37-48`). Every RPC is one autocommitted transaction, so no code path can hold a database
  transaction open between two requests.
- **Security definer:** all 254 `security definer` functions in `public` and `private` set `search_path=''`. The 128 non-definer ones
  are invoker wrappers or pure helpers.
- **Grants**
  - `anon` can execute exactly three functions, all invoker: `public_teacher_catalog`, `resolve_teacher_website` and
    `public_teacher_asset`. It has no table grants.
  - `private` grants `usage` to `authenticated` and `service_role` only. PostgREST exposes only `public` and `graphql_public`
    (`supabase/config.toml:13`).
  - `service_role` has no table grants. Its only functions are the worker and maintenance RPCs.
  - Internal functions (`emit_notification`, `demo_fill_core`, `demo_clear_core`, the `*_v17`) are `postgres` only. Calling
    `emit_notification` as a user is refused.
- **RLS**
  - Every table in `public` and `private` has RLS on. `private` tables have no policies and no grants.
  - Every `public` policy is `TO authenticated`.
  - The 19 original `public` tables also carry a restrictive `trusted_identity` policy.
  - Every policy on the other 31 `public` tables calls a caller-dependent helper, except `homework_options_read`, which goes
    through `homework_questions` and its RLS.
- **Caller resolution**
  - `current_app_user_id` requires a trusted issuer and audience, an active identity and an active profile.
  - For Firebase it also requires `auth_time` newer than `tokens_valid_after`, so a revocation works.
  - A suspended profile resolves to no one, so every helper and every RPC refuses it.
  - `has_org_role` also requires an active space; `is_platform_admin` requires an active admin row and profile.
- **Cascades:** only content and staff cascade: course → chapters → lessons → blocks; question → options and keys; space →
  memberships; person → staff, membership and profile rows. Student work, enrollments, attendance, homework, exam results and
  notifications are all `RESTRICT`, so a delete cannot wipe them. The one cascade that bites is finding 2.
- **Time zone:** see finding 12. The live code is explicit everywhere.

## Could not verify

- **Hosted Supabase settings:** the per-role `statement_timeout` and `lock_timeout` (finding 6), the PostgreSQL major version, the
  PostgREST pool size, and the hardware. They change how long finding 1 takes and when it hits a timeout. Checking needs read access to
  the connected project, which this audit does not have permission to use.
- **Real data sizes:** the lesson-tree timings use a synthetic 20-lesson course. A real course may be larger.
- **How often the video player saves progress during playback** (finding 7): browser behaviour, left for Part 2.
- **Deadlocks:** not searched for empirically beyond the cases above. Lock order was read from every live function (README.md,
  "Lock order").
- **Firebase third-party auth configuration on the hosted project** (finding 11).

## How the proofs were run (for repeating them)

1. Build: start the disposable server (`bash .local/pg17.sh start`, loopback port 54871), create an empty database, run
   `supabase/tests/local-bootstrap.sql`, then every migration in order with `seed.sql` before `complete_lesson_workflows`, as
   `scripts/exam-sql-local.cjs` does.
2. Fixtures go through the real functions as signed-in seed users: `begin; set local role authenticated;
   set_config('request.jwt.claims', {iss, aud:'authenticated', role:'authenticated', sub, auth_time}, true)`. Used: two Groups in run
   `60000000-…01` with students 5 and 6, a one-off session, a program and stage, and a published same-time online exam with a started
   try. Three fixtures were written directly as `postgres`: student 6's enrollment in that run, the run's capacity lifted, and 40
   load-test students.
3. Each proof uses two connections. A runs the holder and stays open; 700 ms later a third connection reads B's row in
   `pg_stat_activity` (`wait_event`, `pg_blocking_pids`) and B's ungranted `pg_locks`. After 2 s A commits, and B's finish time is
   recorded.
4. Hold times are each call alone in its own transaction. The database was dropped afterwards.

Raw results (B blocked by A in every case except P1c, P4c and P5):

| Proof | A holds | B | B after 700 ms | B result |
| --- | --- | --- | --- | --- |
| P1a | attendance, Group 1 | attendance, Group 2, same run | Lock/transactionid, blocked by A | done at 2,029 ms |
| P1b | attendance, Group 1 | `save_homework` in the run | Lock/transactionid | waited 2,029 ms, then its own validation error |
| P1c | attendance, Group 1 | student progress save | not blocked | 40 ms |
| P2a | stage pick, student 5 | stage pick, student 6 | Lock/transactionid | 2,024 ms |
| P2b | stage pick, student 5 | owner `create_teacher_course` | Lock/transactionid (tuple on `organizations`) | 2,014 ms |
| P2c | stage pick, student 5 | `notification_events` insert for the space | Lock/transactionid | 2,012 ms |
| P3 | owner renames live exam | student answer save | Lock/transactionid | 2,023 ms |
| P4a | block save | second teacher renames a lesson | Lock/transactionid (tuple on `courses`) | 2,034 ms |
| P4b | block save | exam draft in the course | Lock/transactionid (tuple on `courses`) | 2,021 ms |
| P4c | block save | student progress save | not blocked | 55 ms |
| P5 | block save | student stage pick | — | fails in 16 ms, 55P03 |
| Course delete | — | editor `delete from courses` | — | 1 row; chapter, 2 lessons, 10 blocks gone (rolled back) |
