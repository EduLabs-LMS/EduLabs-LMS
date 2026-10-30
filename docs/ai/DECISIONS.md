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
- Teacher self-service offering setup, assistant permission expansion, roster email
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
- The teacher logo is one link to Home and uses the brand font (owner decision): mark, wordmark and the Learning Platform line are a single link with an aria-label, a 44px+ target and a focus ring; the wordmark is no longer hard-coded Times New Roman (student shell: same font, no link). The Next session card has no All sessions button and Home has no Homework card until the Homework build (it returns then). Demo seed version 3 adds five notifications for the teacher (draft migration 20261031120000, not applied).
