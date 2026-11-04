# Decisions and deferred work

- Owner chose the pre-redesign student/core base fa67875, not post-merge d96c40e.
- Owner approved removing legacy teacher-facing presentation from this branch.
- Backend/API/security/schema/contracts and student functionality are preserved.
- Reliability logic is ported separately; no friend-design ancestry is imported.
- Firebase identity + Supabase/PostgreSQL/RLS is the NEW LMS. Clerk fallback remains
  buildable for student/legacy routes. Old teacher UI compatibility is intentionally
  retired here; do not claim full teacher-UI backward compatibility.
- Organizations are managed/provisioned by trusted EduLabs staff, not end-user signup.
- One teacher organization can have multiple programs/stages in one dashboard.
- Enrollment is offering-specific; publication alone does not grant access.
- No changes to the established enrollment-end policy, role grants or RLS.
- Jitsi backend tokens/privacy/attendance and DRM are deferred.
- PR #19 remains separate. Do not merge, retarget, cherry-pick or import it. Later
  email work must be reviewed and ported on its own without friend UI ancestry.
- Assistant permission expansion, roster email
  disclosure and a real waitlist add-on switch require product/backend decisions.
- Existing teacher API operations remain callable only under existing authorization;
  retiring forms does not disable the backend or change data.
- No migrations, connected fixtures, provider writes, staging or production deployment
  were authorized by this preparation. Local disposable PostgreSQL is test-only.
- Platform administration is a dedicated private registry (private.platform_admins) keyed to
  the verified Firebase identity; it is not a role, membership or claim. Initial admin is
  granted only by a trusted operator SQL procedure; there is no UI/API to grant it.
- Teacher provisioning is invitation-only. Educational structure stays tenant-owned (no global
  catalog): Education System = academic_programs (+ optional examination_board), Grade Level =
  academic_stages, Subject = new academic_subjects, Course.subject_id. Creating a portal does
  not grant ownership; a verified-email-bound, single-use, hash-only invitation does.
- Demo spaces: a platform administrator may mark a provisioned teaching space as a demo and fill/clear tagged synthetic data
  (migration 20261027120000, not applied anywhere by this change). Any new teacher-facing feature that stores data must extend
  the demo seed in the same change: new seed module, bump the seed version, add its tables to the demo_seed_rows allowed list in
  a new migration, and update docs/ai/DEMO_DATA.md. scripts/demo-spaces.test.cjs enforces that the SQL, the service constant and
  the document agree.

- Helper (owner decision): the teacher Helper is a spotlight tour (dimmed page, bright target, small box with Back/Next/Skip, Escape
  closes; bottom box on phone; mirrored in Arabic). It runs automatically on a new teacher's first sign-in, starting on Home, and
  every teacher page has a quiet "?" button in its header that starts that page's tour. Settings > My account gets "Show the
  walkthrough again". Tour steps are written per page after the final screens exist, in English and Arabic, and each points at a real
  element (new screens mark their tour targets). Open, not decided: where the "seen" flag is stored; preferred per teacher in the
  database, which needs a migration and owner approval before any migration is written or applied. Stored Helper data must extend the
  demo seed or be excluded with a reason. Details: V1.md and TEACHER_UI_SPEC.md.
- Helper animation (owner decision): soft, never harsh. Dim fades in over ~250 ms in a soft dark green (not black); the spotlight glides
  between targets over ~350 ms ease-out with a rounded cut-out and a thin green outline; the page scrolls smoothly to the target before
  the step box appears; the box fades in with an 8 px slide up over ~200 ms and on a step change the text cross-fades without the box
  jumping; progress dots fill softly; the first-run welcome card fades in. No confetti, bounce, sparkle, looping or pulsing animation,
  no sudden brightness change, never auto-advance. prefers-reduced-motion: plain fades only, no movement. RTL mirrors slide
  directions. Transform and opacity only. Details: TEACHER_UI_SPEC.md.
- Calm phone rule (owner decision): phone screens follow the calm style of the phone One Group design: list rows instead of boxed
  cards, one main action, generous spacing, 48 px+ touch targets. Details: TEACHER_UI_SPEC.md.
- Take attendance is flat and saves every tap (owner decision): no Save draft, no status bar, no boxed cards; one fixed Finish attendance button; the finished view is the same screen read-only with Edit attendance (reason of 3+ characters). Saves run as a queue through the existing `attendance` command.
- Home shows no courses (owner decision): no "Your courses" block and no "Create a course" header button; courses live in Settings > Courses. The first-visit card for a teacher with no course stays. The Next session card gets Take attendance once the session has started, and finished Sessions with unsaved attendance (max 3) lead Coming up with a yellow Finish button. The Mobile-Home-Today board is not approved and not built.
- The existing logo-grow loading screen is the only page transition (owner decision): it plays for every slow navigation, including teacher pages and Home. Pages with their own loading.tsx must render RouteLoadingSignal, router.push/replace go through useLoadingRouter, and a link whose own handler cancels the click carries data-loading-ignore. Values are unchanged: show after 120 ms, finish phase 650 ms, so fast pages never flash and a shown screen never flickers. No second animation was added.
- The loading screen plays once and lifts onto a finished page (owner report: it played, cut and restarted, and teacher data was still loading behind it). Every reason to keep it up is its own claim (`acquireLoading` in LoadingProvider returns a release function): each loading.tsx fallback via RouteLoadingSignal, and each teacher page's first browser read via `usePageLoadingSignal(pending)`, so stacked fallbacks cannot end it early. The lifecycle is one way (hidden, shown, finishing, hidden): a 60 ms grace lets one claim hand over to the next without finishing, and work that starts while it finishes begins a new cycle afterwards instead of rewinding the word. The page signal is released when the read succeeds or fails (the page then shows its own error) and by a 10 s cap, only counts the first load of a component (retry, filter or tab changes never bring the screen back), and is wired for Groups list (list and its cards' facts), Group page (Group and Sessions list), and Attendance (Session and sheet). Teacher Home and Courses read on the server, so they need no page signal. 120 ms show delay, 650 ms finish, reduced-motion and the student shell are unchanged. On a hard reload a loading.tsx fallback never runs its effects (React keeps the server fallback dehydrated), so on reload the page signals are what hold the screen.
- The teacher logo is one link to Home and uses the brand font (owner decision): mark, wordmark and the Learning Platform line are a single link with an aria-label, a 44px+ target and a focus ring; the wordmark is no longer hard-coded Times New Roman (student shell: same font, no link). The Next session card has no All sessions button and Home has no Homework card until the Homework build (it returns then). Demo seed version 3 adds five notifications for the teacher (draft migration 20261031120000, not applied).
- Create a Group picks the course's current run out of sight, and a course with none gets one (owner instruction, which settles the teacher self-service part of the earlier open item for this one case). Current means active and not ended; with several, the latest start, then the lowest id, so it is always the same one. `POST /api/study-groups/course-run` (new route with the same gates, because the Groups endpoint files are pinned to the baseline) inserts it as the signed-in teacher under the existing `course_offerings_insert` rule, with no new grant, function or migration. Space owners and admins and course owners and instructors may; others get 403 (`supabase/tests/group-course-run.sql`, including Firebase sign-in). The app sets the id and does not read the row back in that statement, because the read rule cannot see a row its own statement is adding. Date, capacity and enrollment settings of a run still have no teacher screen.
- Students are added to a Group only from people who already have access to the course, through the existing `add` and `remove` on `group_command`. A student in another Group of the course is refused and the message says so; moving them waits for transfer. Removing ends the membership and keeps history and course access. No second enrollment path.
- The owner accepted that a teacher's first Group quietly creates the course's active run (the `course-run` route from `claude/groups-create-edit`). That settles the earlier open item for this case; run dates, capacity and enrollment settings still have no teacher screen.
- Student entry model (owner decision): one join link per course, and the teacher approves each request. Approval is the teacher's payment gate. A space-wide link where the student picks education system, grade and course is deferred until after V1. A personal invitation for one named student is not offered: the existing flow needs that student's profile id, and no existing read lets a teacher look up a person outside their own courses without exposing other people's data.
- Students screen reads are derived, not new: the list merges the per-course roster pages, the Group column comes from the Groups overview plus each shown course's Group members, and the student page finds the row by scanning roster pages of the course given in `?course=`. A dedicated read would be cheaper at scale and is a later optimisation; no migration was needed.
- No personal invitation (`kind invite`) in V1: it needs the student's profile id, and there is no existing way to look a person up without exposing others' data. Join links are `kind request` only. Enrolling a student directly (`enroll`) is not used: approval is the one way in.
- Share on an invite link uses only the browser's native share sheet. A WhatsApp address (`wa.me/?text=...`) would put the secret in a URL the app navigates to, so it is not offered. The link secret is made with `crypto.getRandomValues`, shown once and kept nowhere (not in storage, logs or addresses); the middleware sends `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` for the Students pages.
- Inviting to a course that has no run yet creates the run through the `course-run` route, which extends the owner's decision that a first Group quietly creates the active run to a first join link. Flagged for owner confirmation.
- Demo Clear removes what the teacher's own use of the Students screen leaves in a demo space (join links, demo students' requests, audit rows) and refuses, naming it, when a real person created or is the subject of any of it. These tables are not append-only; the platform audit row records the removed counts (draft migration `20261104120000`, not applied).
- Invite links are for published courses only (found on staging: a link to a draft course made the student's page fail). The teacher screen offers only published courses and refuses a draft before calling the API. The database does NOT refuse `link` for an unpublished course (`student_administration('link')` checks only that the caller manages the offering); only `inspect`, `request` and `accept` refuse. Not changed in this task; recorded for the owner.
- The student `/join` failure text is one human sentence that does not say which reason applied ("This link isn't working. It may have expired or been turned off, or the course isn't open yet. Ask your teacher for a new link."), English and Arabic, for the refusals 400, 403 and 404. Outages and rate limits keep their own message.
- `private.group_view` section `summary` was O(all attendance rows in the database) and called `can_manage_group` per row three times; staging cancelled it every time the student Home loaded. Draft migration `20261105120000` resolves the managed groups once and reads only the caller's own rows and the rows of those groups' sessions, and limits the homework count to offerings the caller is enrolled in. Same signature, grants and results (proved by `supabase/tests/group-summary-performance.sql`). Timings: EXPLAIN (ANALYZE) on a local PostgreSQL 17 with 20,400+ attendance rows in six extra spaces: student 246,056 ms before, 4.2 ms after; teacher 231,080 ms before, 32.6 ms after; the answers were equal (`group-summary-performance-benchmark.sql`). The 8.7 s measured on the dev database had only 112 rows; the cost grows with the number of attendance rows in the whole database.
