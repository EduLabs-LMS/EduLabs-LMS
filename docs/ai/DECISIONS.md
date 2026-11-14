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
- Home shows no courses (owner decision): no "Your courses" block and no "Create a course" header button; courses live in Settings > Courses. The first-visit card for a teacher with no course stays. The Next session card gets Take attendance once the session has started, and finished Sessions with unsaved attendance (max 3) lead Coming up with a yellow Finish button. The Mobile-Home-Today board is not approved and not built. **Courses moved (2026-11-05):** the list is now `/teacher/courses`, a main menu item; `/teacher/settings/courses` redirects to it.
- Loading (owner decision, `claude/speed`, replaces the earlier "overlay for every slow navigation" rules): the EduLabs logo overlay plays only on the first load after sign-in, under one second (shown at once, at least 250 ms, capped at 400 ms, then a 200 ms finish and fade). The sign-in code calls `beginFirstLoad()`; a `sessionStorage` mark (`edulabs-first-load`, no user data) lets a Google-redirect page load count and is cleared once played and on sign-out. In-app navigation never shows the overlay: the app frame (sidebar, header) stays and the content area shows a skeleton of the real layout from the route's own `loading.tsx` (every teacher route has one). `usePageLoadingSignal`, `RouteLoadingSignal` and link-click detection are removed; the blocking overlay for saves and uploads (`startLoading`, 120 ms delay, 650 ms finish) is unchanged. **Replaced in part (2026-11-05):** "under one second" gave way to owner decision (c) below: the logo plays to its full end.
- Stale-while-revalidate (`frontend/lib/swr-cache.ts`, `use-swr.ts`): memory only (never storage), scoped to the signed-in Firebase uid, emptied on sign-out or user change (mounted screens are told), never decides access (every shown copy is read again; 401/403/404 drop it and show the refusal), failures are never stored, answers read for a previous owner are never stored, copies expire after 10 minutes, and changes (`groupCall`/`groupSave`/`adminCall` non-reads) drop the affected copies. The attendance sheet never uses it. Server side nothing is cached across requests: the Firebase token check (revocation included) runs once per request, memoised per request and credential (`server/request-scope.ts`).
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
- New SQL must resolve the caller with `private.current_app_user_id()`, never `auth.uid()`. `auth.uid()` casts the token subject to uuid; a Firebase subject is not a UUID, so it raises 22P02 for every Firebase user (found in review of the draft `20261105120000` migration before it was applied; fixed there). Tests for SQL that depends on the caller must also run under a Firebase-style identity (`supabase/tests/group-summary-performance.sql` and `group-course-run.sql` do).
- A teaching space has a real name, chosen where it is created (platform admin form, required, same text rules as other names) and renamed by the platform admin or by its owner only. Every dev space was "Pending teacher portal". `organizations_update` also lets an admin write, so the owner-only rename is a database function (`rename_my_teaching_space`, active owner of an active space, else 403), reached through the new `PATCH /api/teacher/space`; `POST /api/teacher/organizations` is a closed stub and was not reused. Draft migration `20261105130000`, not applied. Names are not unique. A teacher never sees the word "organization"; the create-course space picker is hidden with one space.
- The course page is `/teacher/settings/courses/<id>` and reuses `PATCH /api/teacher/courses/<id>` and `GET /api/teacher/academics?kind=classification`; no new endpoint. Publish/Unpublish asks first and sends the `updated_at` it read. The database enforces only row-level security and column grants for publishing (no minimum-content rule), so the page adds none. Chapters and lessons are not part of V1 yet.

## Owner decisions from two external UX reviews (2026-11-05)

Only the attendance-trust items are implemented on `claude/attendance-trust`; the rest are recorded here and in V1.md as checklist items.

- **Logo overlay (owner decision):** the EduLabs logo overlay shows only on the first load after sign-in, for under one second. In-app navigation keeps the app frame and shows skeletons instead. Real page and data speed must be fixed too (a separate next track); a skeleton is not a cure for a slow page. This replaces the earlier "the logo-grow loading screen is the only page transition" decision. **Replaced in part (2026-11-05):** see owner decision (c) under "Design foundation": it plays to its full end instead of under one second. **Widened again (owner feedback on the New look, below):** every fresh opening of the site as well.
- **Navigation (owner decision):** Courses becomes a main menu item; a header bell opens notifications; Settings lives inside the main shell; the phone gets bottom tabs Home / Groups / Students / More. This replaces the earlier "Home shows no courses; courses live in Settings > Courses" and "Courses and Settings are not menu items" decisions. Not built yet. **Built on `claude/design-v2-foundation`** (see "Design foundation").
- **Deferred until after V1 (owner decision):** parents' phone numbers, WhatsApp messages to parents, and fee tracking.
- **Home after attendance (`claude/speed` fixes):** on Home's live-class card, a FINALIZED attendance sheet shows "Attendance taken" (تم تسجيل الحضور) with an "Edit attendance" link instead of "Take attendance"; a draft (even with marks) or a reopened sheet keeps "Take attendance" and continues. A finished class leaves the "attendance not saved" rows as soon as it is finalized. After attendance is saved, finished or reopened the attendance screen calls `router.refresh()` (finish/reopen at once, saves grouped) so no cached or prefetched Home, Groups or Group page shows the old state; the stale-while-revalidate copies of Groups are dropped by the same actions.
- **First-load overlay survives the sign-in remount (`claude/speed` fixes):** the app tree is keyed on the signed-in user (`FirebaseBridge`), so signing in mounts everything again, `LoadingProvider` included, in the middle of the sign-in handler. The first-load mark is therefore announced on `window` (`edulabs:first-load`) and whichever provider is mounted starts the overlay; do not rely on a callback captured from an earlier provider.
- **Live class buttons (owner decision):** during a live class, "Take attendance" is the primary (dark) button on Home and "Open this Group" is the secondary one. This replaces the earlier order.
- **Attendance trust (owner decision, built on `claude/attendance-trust`):** "Mark the rest present" changes only students still not marked and never overwrites a mark. Saving is visible (Saving / Saved / Couldn't save, Retry), retries by itself with backoff, and every way of leaving the page while a save is pending is guarded. A page load always shows what the server holds. Students are listed alphabetically (Arabic-aware) like the Group's Students tab.

## Design foundation, Classic and New (owner decisions, 2026-11-05, branch `claude/design-v2-foundation`)

- **(a) Two looks.** "Classic" (today's original EduLabs style) and "New" (the approved Teacher UI v2 boards in `docs/design/teacher-ui-v2/`) coexist behind a per-person switch. **Changed (owner decision, below):** both looks stay permanently and the switch is a lasting personal preference, not a comparison.
- **(b) The switch changes only the visual layer.** The structure changes (the frame, Courses in the menu, Settings in the main shell, the rebuilt Home) apply to both looks. A browser test compares tags, data attributes and words between the looks.
- **(c) First load.** On the first load after sign-in the EduLabs logo animation plays to its full end, then the page shows. This replaces "under one second". It never plays on in-app navigation. Reduced motion shows the still logo for a moment. A page that takes more than 5 seconds after the animation does not hold the logo: the frame and a skeleton take over. **Widened (owner feedback, below):** the logo now also plays on every fresh opening of the site, on any route. After sign-in it stays as written here.
- **How the switch works:** Settings > Language and appearance > Design. A plain cookie `edulabs_design` holds only the word `classic` or `new`, per browser, with no user data. It stays after sign-out, and it is not a security setting: nothing about access reads it. The root layout reads it on the server and writes `data-design` on `<html>`, so there is no flash. Anything other than those two words is Classic, which is also the default.
- **Tokens:** `frontend/styles/design-tokens.css`, two sets chosen by `data-design`, each with light and dark. The Classic set is the snapshot of today's values, with each token's source named beside it. Fonts are declared on `body` because next/font declares its variables there.
- **Existing screens are bridged, not rebuilt.** Only Home and the frame use the new components. In New, the other teacher screens get the look from `frontend/styles/design-bridge.css`. Every rule there starts with `html[data-design="new"]:has([data-teacher-shell])`, so it can never reach a student page or the Classic look. Rebuilding those screens is later work and needs owner approval per screen.
- **Students are untouched.** Only staff get `TeacherFrame`, so a student keeps the student frame in either look. A staff member who can open a teacher page but has no staff organization in the navigation read sees the student frame there (an edge case, kept as it was).
- **Home tile "attendance this month" is left out.** No existing read gives a monthly figure, and the owner's rule is to leave a tile out rather than invent a number. It needs a new read, and owner approval, to come back.
- **The progress ring reads `groupService().view(group, session)`,** only for a session that has already started. That read runs `private.snapshot_group_roster`, the same idempotent snapshot the attendance page takes when it opens, so opening Home during a live class can create the roster snapshot slightly earlier than opening attendance would. No marks are written. If the read fails or is refused, the ring is left out and the rest of Home stays.
- **"N sessions today" is left out when uncertain:** it shows only when the list of upcoming sessions is complete for today.
- **Course page URL is unchanged:** `/teacher/settings/courses/<id>`, with its existing allowlist entry. It belongs to Courses in the menu and has no Settings sub-navigation.
- **Both looks stay,** so nothing is planned for removal (owner decision, below). A bridged screen leaves `design-bridge.css` when it is rebuilt with the design components.

## Owner feedback on the New look (owner decisions, 2026-11-05, branch `claude/design-v2-foundation`)

The owner tested New on staging. These replace the matching parts of "Design foundation" above.

- **New is an evolution of Classic, not a different product.** New takes Classic's personality and keeps its own calm surfaces, thin borders, icons, status pills and layouts.
  - Carried from Classic: the lime-filled rounded active pill; the offset edge down and to the right on the active item and the primary button, in deep green `#2B6416` where Classic has black; lime primary buttons that press onto that edge; the phone tab's lime pill; Classic's exact radii (controls 16, fields 12, cards 24, hero 24, menu items 16, badges 12); the Caprasimo wordmark at Classic's 24 px.
  - Not carried: black outlines and hard black shadows on cards and controls (the owner keeps New's thin borders and calm surfaces); Classic's hover lift (the owner asked that hover lightens); the black primary button on Home (lime, as the owner asked); an offset edge on secondary buttons and cards (only the active item and the primary keep it, so they stand out, and secondary buttons keep a 2 px neutral bottom edge); black underlined links, Classic's slate text and larger menu text (New's calm type and colours stay); the black shadow of the tree in the frame (New has no hard black shadow, and `public/edulabs-logo.svg` has none).
- **The logo has no box, anywhere.** The boards' green square was a placeholder. The sidebar and phone header use the real tree mark and wordmark at their natural shape, with nothing behind them. **Sign-in:** the green panel behind the logo is gone in both looks, and the tree is its own lime with its usual black offset. The opening logo and sign-in keep that offset because they are shared with Classic and drawn the same in both looks.
- **Homework, Exams and Reports are visible with a "Soon" tag (Arabic "قريبًا"), in both looks.** This replaces "hidden until built". They are in the desktop sidebar and the phone's More sheet: `aria-disabled`, not links, not focusable, tooltip "Coming soon". Each becomes a real link when it is built (move it from `teacherNavSoon` to `teacherNav`, `shared/teacher-home.ts`). V1 still requires none to be left (V1.md).
- **Motion, New only.** Classic is unchanged, and reduced motion turns all of it off. 120 to 250 ms, ease-out, on transform and opacity: button hover and press, the sliding menu pill and tab underline, cards and rows rising with a 30 ms stagger on a page's first render only (`main[data-enter]` exists for that moment, so a data refresh cannot animate), the ring and numbers on first show, dialogs and phone sheets, skeleton shimmer, a short toast. Exceptions, each because the owner asked for the effect itself: the pressed button's edge shrinks (box-shadow), the ring draws (stroke-dasharray), the numbers count up (text), and the shimmer repeats for as long as a skeleton shows, the only thing that loops.
  - Numbers count up behind the opening logo and on in-app navigation. After a same-tab reload they do not: the server has already painted them, and counting from zero would show them twice.
  - The toast is an addition to the screen's own confirmation and is hidden from screen readers. It fires for renaming a space, a new invite link, answering a join request, finishing attendance and publishing or unpublishing a course. Screens that navigate away with no message of their own (creating a Group) get none, and neither does "Approved, but not added", which still asks for something.
- **The EduLabs logo plays on every fresh opening of the site, on any route:** the first full page load in a browser tab. Not on in-app navigation and not on a reload in the same tab. Still after sign-in, as before.
  - A small constant script in the root layout's `<head>` decides before anything paints and sets `data-first-open`. `sessionStorage` holds `edulabs-opened = 1` and no personal data. The logo is in the server's markup, shown only by that attribute, outside the part of the tree keyed on the user, so restoring a session cannot restart it.
  - It cannot block: the stylesheet lifts it after about 6 seconds even if the app's JavaScript never arrives (1.5 seconds with reduced motion, which shows the still logo). With storage blocked or JavaScript off it is skipped, never repeated.
  - **This replaces the older landing splash** (`intro-splash.tsx`, on `/` only, replayed on every reload, with the "Empowering Modern Education" tagline and tap to skip): two opening animations would run over each other. The tagline and tap to skip went with it.
  - **Not covered: a teacher's public website (`/t/<slug>`).** It is its own document with a strict `default-src 'none'` policy and no script, and it carries the teacher's own branding. Adding the logo would mean weakening that policy, so it was left alone. Opening EduLabs after it in the same tab still counts as a fresh opening.
  - A duplicated tab, and a tab opened by a link from an EduLabs tab that keeps its opener, inherit session storage from the browser, so they do not play it.
- **Countdown on Home's Coming up rows and on the next-session hero when nothing is live, in both looks:** "in 2 d 5 h", "in 3 h 20 min", "in 25 min", "starting now"; Arabic "بعد يومين و5 ساعات" with real plural forms. Minutes round up, so it reaches "starting now" exactly at the start. It updates once a minute with tabular figures. It reads the server's time: the page's `now` plus what has passed on the device, so a wrong device clock changes nothing. The words are in `shared/home-countdown.ts`, not the locale files, because Arabic's dual forms hold no number and the locale tests require the same placeholders in both languages.

## Owner feedback after testing New (owner decisions, 2026-11-06, branch `claude/design-v2-foundation`)

- **Both looks stay permanently.** The Classic / New switch in Settings > Language and appearance is a lasting personal preference, not a temporary test. Nothing is deleted. **Every screen must work in both looks from now on,** in light and dark, and a new screen is not done until it does.
- **Footer credits:** "Made by: Mohamed Tamer Mohamed & Mohamed Ahmed Yehia", in that order. The second name is a little greyer (`--d-credit-2`, New's meta colour; Classic has no lighter meta, so it gets the same grey), both AA. The names are one left-to-right run, so the order holds in Arabic. The footer is shared, so students see the same credits.
- **Footer text for teachers:** "Need help? Contact EduLabs support", linking to `/support`, which the middleware already allows. `Footer` takes `audience="teacher"` from the teacher frame only; students keep their text. The two Soon items stay as they are. A phone has no such line: it has the one-line credits, and Help is in More.
- **The menu changes in place.** The new active pill fades and scales in very slightly (120 ms, from 0.97) where it is and the old one fades out; nothing travels. Reduced motion and Classic change at once.
  - In New with motion on, the pill is a `::before` layer, because an element's own background cannot fade out on its own with transform and opacity. Everywhere else it stays on the item itself.
  - **The phone's bottom tabs changed the same way,** because they are the same idea. The owner named the sidebar; this is our reading of "no travelling indicator".
  - **The Settings tab underline still slides.** The owner asked for that separately and did not retract it. To be judged on staging.
- **The logo stands out at 3:1 or more on what is behind it, everywhere it appears,** in both looks and themes: deep green `#2B6416` on light, light green `#7ED957` on dark. One mark from the same paths, its colour from `--d-logo-tree`; only the colour changed. This reaches every place the mark is drawn, **student shell included**, because it is one component and the owner asked for every place. The black offset on the opening logo and sign-in stays. It cannot be seen on a dark background, which is fine: it is decoration.
- **No native checkboxes, radios or selects in the teacher area or the shared settings, notifications and support screens.** `frontend/components/design/controls.tsx` has `Switch` (role="switch"), `ChoiceGroup` and `SegmentedControl` (role="radio", arrow keys, one tab stop) and `Select` (the ARIA select-only combobox, on the Radix Popover we already have, so no new dependency).
  - Disabled is `aria-disabled` and not the attribute: a switch that turns busy during a save keeps the keyboard's place, and a person can reach a disabled one and hear why it is off.
  - Notifications: per-event In-app and Push are switches named with the event ("Your exam results are available: In-app"). "Enable" and "Disable browser push" are one switch with its status line. It starts from what the browser has (`getRegistration` and `getSubscription`, which ask for no permission). The `push`, `preference` and `action` handlers are unchanged, byte for byte: `scripts/settings.test.cjs` guards them.
  - **Students see these controls too.** Notifications and the language and appearance forms are one screen each for students and teachers, and the owner named the shared screens. Only the two forms in `frontend/features/personalization` changed for this, and only their controls; the guard in `scripts/teacher-settings-groups.test.cjs` now allows exactly those two files.
  - **The owner named checkboxes, radios and selects. Left alone:** the browser's own date and time pickers (`type="date"` and `type="time"` on the Group form and the session form) and file pickers. They are styled fields with a native popup, and a custom date and time picker is a project of its own. Outside the scope: the student homework and exam questions, the student's academic selection, the public teacher site's filter, the platform admin screens and the teacher invitation page, which uses the platform admin's design system.
- **The finished attendance sheet.** Desktop: "Edit attendance" is a secondary action in the page header, with "Editing asks for a short reason" beside it and as its tooltip; there is no bar at the bottom. Phone: a floating bar with one full-width button and safe-area padding. In both looks, because the switch changes only the visual layer. From 768 px up counts as desktop, where the sidebar appears. The reason form still opens at the end of the list.
  - The white band came from the New bridge: its `.bg-white` rule is stronger than `lg:bg-transparent`, so the unfinished sheet had the band on a desktop too. That is fixed as well. The unfinished sheet otherwise stays as it was: below 1024 px it keeps its fixed bar.

## Every teacher screen on the component system (2026-11-06, branch `claude/design-v2-foundation`)

This section replaces older lines where they disagree: "Only Home and the frame use the new components", "Classic is the default", 48 px targets, 16 px minimum text and "no boxed cards".

- **Every teacher screen uses `frontend/components/design` and the `--d-*` tokens, in both looks:** Groups, Group page, Attendance, Students, Invite, Student page, Courses, course page, Create and Edit Group, every Settings section, Notifications. The old button and card constants in `teacher-home/parts.tsx` are gone. `design-bridge.css` stays for anything still inside the shell that has not moved.
- **Default look: New (owner decision).** A browser with no valid cookie gets New; a chosen Classic stays Classic. **A cookie cannot tell a new teacher from an existing one who never chose,** so existing teachers without the cookie also get New.
- **New belongs to the teacher app.** The New token blocks need `[data-teacher-shell]` on the page, as the bridge already did, so a student's or a signed-out page keeps the Classic values even with the new default. This relies on the frame being in the server's HTML, which the layout does.
- **Shared screens:** Language, Appearance and Notifications read `useTeacherSurface()`, set by the teacher frame. Inside it they draw with the design components; elsewhere they draw exactly as before. It changes the drawing, never what anyone may do. Notifications keeps its handlers in `notifications-view.tsx`.
- **Targets are 44 px, minimum text 12 px, per the boards.** The older 48 px and 16 px rules are replaced.
- **Field edges have their own token, `--d-field-edge`,** at 3:1 against the page (WCAG 1.4.11). The boards' lighter `--d-field-line` measured 1.6 to 2.7:1 in New, so it stays only on buttons and the attention card. This is a deliberate departure from the boards' value.
- **The attendance sheet is one card, per the board,** replacing "no boxed cards" for that screen.
- **A course title is the only name shown for a run.** It comes from `offerings` of `/api/student-administration`. Two runs of one course therefore read the same.
- **Attendance figures on lists are derived from the history read:** up to 20 pages per Group, a dash beyond that, on failure, or with nothing marked. There is no per-session marked count in the sessions read, so "8 of 14 marked" and "Continue" are not shown. There is no "Low attendance" pill, because no rule defines one.
- **Invite students is its own page,** `/teacher/students/invite`, an exact middleware entry. The link token follows the same rules as before: shown once, never logged or stored, never in an address. The old `?invite=` address redirects.
- **Reschedule uses the existing `session` command;** the client refuses a past time and the database refuses a started or saved session.
- **Finish and Reopen, Suspend and Reactivate, Publish and Unpublish keep their inline question** rather than a dialog: trust behaviour stays as it was. Removing a student from a Group sits behind the row's menu and asks in a dialog.
- **The logo's black offset shadow is drawn in the light theme only on the opening logo and the sign-in page.** Other logos are unchanged.

## Sign-in on the components; the teacher website switched off (2026-11-06, branch `claude/design-followups`)

- **The sign-in and sign-up form uses the design components in both looks** (`Field`, `Button`, the `d-auth` card classes). Behaviour, messages and the wording of every control are unchanged; `scripts/sign-in-browser.cjs` and `scripts/firebase-auth.test.cjs` keep them.
- **The sign-in page is opted into the look by its own marker, `data-auth-surface`.** The token blocks in `design-tokens.css` now apply to a teacher page *or* a page carrying that marker. The marker is on the form only, so every other signed-out page and every student page still reads Classic values. The sign-in page is shared by students and teachers and cannot tell them apart before sign-in, so **a browser whose look is New (the default) sees the sign-in page in New even when it belongs to a student**; after sign-in a student's pages are Classic again. The bridge (`design-bridge.css`) stays teacher-only.
- **The sign-in action is ink on lime in every set** (`--d-accent` with `--d-on-accent`), also in Classic, where the shared primary is black. Measured 11.97:1 in Classic and 8.16:1 in New, light and dark.
- **The copy on the sign-in page is English only, as before.** The page mirrors in Arabic (right-to-left) but its strings and error messages are not translated; translating them is a separate task because the messages are part of the auth behaviour.
- **`/teacher/website` is not reachable by teachers until the website feature exists.** Its page file is deleted, its allowlist entry is out of `middleware.ts` and out of `shared/website-routes.ts` (an unlisted page goes to `/unavailable`). `scripts/teacher-website-gate.test.cjs` runs the real middleware to keep it so, and `scripts/teacher-foundation.test.cjs` pins that this is the only change to the baseline route list. `/api/teacher/website` (authorized in the database, no screen calls it) and the public `/t/<slug>` pages are unchanged.

## Homework and course content (owner decisions, 2026-11-06, branch `claude/course-content`)

The approved look is in `docs/design/homework-content/` (12 boards and `canvas.json`). Build with the existing design components, in both looks; do not copy board markup. These are decisions only: Homework is not built by recording them.

- **File system (from the 2026-10-24 handoff):** teachers see Course > Chapter > Lesson. Homework belongs to exactly one Lesson. Exams belong to the course (later).
- **Homework is a list of questions:** Multiple choice (auto-graded; answer texts are optional, so a question from the book is letters only; see "Homework move" below) and Essay (a text box, plus ONE photo per question, max 5 MB, if the teacher allows photos; a per-homework switch).
- **Every homework has a deadline.** "Allow after the deadline": a student who has not handed in can still hand in; it is stored and shown as "Missed the deadline". It covers a first hand-in only.
- **Solutions open** right after the student hands in, OR after the deadline (per homework). After the deadline, solutions show only to students who handed in. With tries on, solutions open after the student's last try or at the deadline, whichever comes first. Unused tries end at the deadline.
- **Tries:** one time / try again, fix mistakes (right answers stay, only wrong ones reopen) / try again, from zero; with a number of tries. The latest try counts; every try stays in history.
- **Locking and versions:** once a student finishes, that submission is locked. Once any student has started, editing the homework makes a new version (existing behaviour).
- **Student photos are never edited or drawn on** (the annotation feature is not used in the UI). Students can review their answers and photos after the homework closes, until the teacher deletes the images to free storage.
- **Assistants can correct AND release;** both become per-assistant permissions, on by default (no assistants screen yet; the switches come with it). Server-enforced.
- **The whole course gets the homework** (no per-Group homework in V1).
- **The Homework tab is a portal:** stats (essays to correct, corrected, handed in, on time), a To correct list, Open / Closed / Drafts, and "New homework". New homework is a 4-step wizard like the platform admin's provision form (Details, Questions, Rules, Solutions, then Review), one question on screen at a time. Correcting shows one student at a time with Save and next.
- **The student side is not in scope for now;** it must keep working.

## Course content screen: one route (2026-11-06, branch `claude/course-content`)

The Content section reads and writes through one new route, `/api/teacher/courses/<id>/content`, which dispatches to `edit_course_structure` and the existing `edit_learning_content`. It does not use the existing `/api/learning/<id>/edit` route for `create_lesson` and the reorders, because that route drops the database's detail: an archived course could not be told from a stale version. The route runs the same origin, sign-in and `editableTeacherCourse` checks as the Course page; the database authorizes again. Reads call only `course_structure`, which decides by itself, so assistants can read. Middleware allows exactly this path and nothing beside it.

A 42501 whose message is "Module unavailable", "Lesson unavailable" or "Content unavailable" means the row is gone since the teacher read it, so the screen says it changed elsewhere and offers Reload. "Course unavailable" and any other 42501 are refusals.

## Course content tree: audit and draft migration (2026-11-06, branch `claude/course-content`)

Audit of the Firebase/Supabase path for chapters (`course_modules`) and lessons. The legacy Clerk routes `app/api/courses/[courseId]/chapters/*` were not used. Draft migration `20261106130000_course_content_tree.sql`, **not applied anywhere**, then updated in place with the owner's four answers below. The Content section on the Course page is **not built**: the owner reviews and applies the migration on dev first.

- **Existing and kept:** `edit_learning_content` (through `POST /api/learning/<course>/edit`, Firebase only, exact origin) for `create_lesson`, `reorder_modules` and `reorder_lessons`. It locks the course root, checks `can_edit_course` and each row's `updated_at`, and works under a Firebase identity. Its text is not changed; the new triggers on the two tables apply to what it writes.
- **Missing or unsafe, now in the draft as `edit_course_structure`:**
  - `delete_lesson` and `delete_chapter`. The RPC had no delete. A direct delete under RLS has no lock and no version check, and a chapter delete would also remove a lesson added a moment ago in another tab, so a chapter delete must list every lesson the teacher was shown.
  - `move_lesson`. `lessons.module_id` was immutable.
  - `rename_lesson` and `rename_chapter`. `edit_lesson` also writes the status and description and refuses a published lesson with no published part; the old demo seed made exactly those lessons. `edit_module` wipes the description unless it is sent.
  - `create_chapter`. `create_module` stored type `Module` and number 1, so a student would read "Module 1" on every chapter. Both now get the right label from the trigger below.
- **New read, `course_structure`:** chapters and lessons in order, with homework counts (a homework counts once, by its newest version) and each lesson's delete blockers. Course staff who cannot edit may read it and get `canEdit: false`. It is needed because the board shows Delete off with its reason before a click, and a course editor may have no right to read the student work behind that reason. It gives facts and counts, no student or homework content.
- **An old rule changes:** "parent links never move" no longer holds for a lesson inside its course. A new trigger refuses leaving the course, even for the database owner, and there is still no client column grant on `module_id`. The lesson id, homework, progress and parts are untouched, and a move sends no notification.
- **Refused deletes:** SQLSTATE 23503 with the detail `{"reasons":[...],"lessonIds":[...],"contentBlocks":n,"covers":n,"parts":n,"homework":n}`, so the screen words the reason in English and Arabic. Reasons: `student_work`, `homework`, `student_progress`, `parts`, `content`, `in_use` (any other restrict reference). Nothing is hidden and nothing can be forced.
- **Draft state:** lessons have draft/published; chapters have none. The screen will show only a small Draft pill. **A lesson added here stays a draft, and students cannot see it, until the lesson editor exists:** publishing needs a published part, and parts have no screen. (Superseded 2026-11-10: a lesson needs no part to be published; see "A lesson is never tethered to one of its components".)

**The owner's answers (2026-11-06).** They replace the open questions that were here.

1. **A lesson may move between chapters of its course.** It may never leave the course: the trigger stays. Homework, progress, parts and every other reference stay attached to the lesson, unchanged, and it is refused for the same reasons in its new chapter.
2. **A lesson with blocks or a cover still refuses delete, and the refusal says in plain words what is inside.** The database gives the numbers in the refusal and in `course_structure` (`contentBlocks`, `hasCover`, `parts`, `homework`), before any click. The words arrive with the screen. For the screen, with the count in the plural each language needs (`chapter` replaces `lesson` for a chapter refusal):

   | Inside | English | Arabic |
   |---|---|---|
   | 1 item | This lesson has 1 content item. | في هذا الدرس عنصر محتوى واحد. |
   | 2 items | This lesson has 2 content items. | في هذا الدرس عنصرا محتوى. |
   | 3 to 10 items | This lesson has 3 content items. | في هذا الدرس 3 عناصر محتوى. |
   | 11 or more items | This lesson has 11 content items. | في هذا الدرس 11 عنصرًا. |
   | A cover | This lesson has a cover. | في هذا الدرس صورة غلاف. |
   | 2 items and a cover | This lesson has 2 content items and a cover. | في هذا الدرس عنصرا محتوى وصورة غلاف. |

   The owner's copy change (2026-11-06): teachers read "content item", never "content block". The Arabic count forms are the owner's: عنصر محتوى واحد / عنصرا محتوى / 3 عناصر محتوى (3 to 10) / 11 عنصرًا (11 and up), and صورة غلاف stays. These forms are nominative, so the sentence is "في هذا الدرس …", not "يحتوي هذا الدرس على …", which would need another case. Inside the database the field is still `contentBlocks`; it is not shown to anyone.

3. **Chapters are type Chapter, and the stored number always equals the position** (1, 2, 3…), so students and teachers read the same "Chapter N". This replaces the 2B rule that a number is chosen freely and stays independent of the order.
   - A trigger sets the type and number on every write to `course_modules`, so it covers the new function, the old `edit_learning_content` and the demo fill. Two table checks and `not null` say the same.
   - `edit_module` and `edit_module_details` still accept a type and a number and now ignore them. `edit_module_details` still saves the title, summary and description. The tests that asserted a custom number or type were changed for this reason.
   - Deleting a chapter closes the gap in the same transaction. Moving or deleting a lesson changes no chapter.
   - The old 1 to 99 limit is gone; the 500-chapter limit stays.
   - Existing rows are rewritten once in the migration, including archived courses.
   - **What a teacher will notice:** deleting or reordering a chapter changes the version of the chapters whose number changed, so another tab editing one of those is told to reload. That is right, because the number it shows is out of date. The screen must take the new versions from a fresh read after these writes.
4. **A published lesson no student has started may be deleted,** after the screen's confirmation. Nothing in the database looks at a lesson's status. Its old notification simply stops linking anywhere.
5. **On an archived course every structure change is refused in the database:** create, rename, reorder, move and delete of a chapter or lesson.
   - A trigger on both tables refuses it, on every path and for every caller, the database owner too: PT409 (HTTP 409), detail `{"reasons":["archived"]}`. A tab that has not heard about it reloads and shows the read-only page.
   - `course_structure` returns `archived: true` and `canEdit: false`, and still all the content.
   - Deleting the whole course still works.
   - **Not structure, so not refused by this rule:** a lesson's description and draft or published state, parts, blocks and covers. The screen shows them read-only there; the database does not refuse them.

**Our call, beyond the four answers:** the client grants `insert` and `delete` on `course_modules`, `update(position)` on `course_modules` and `delete` on `lessons` are revoked. Otherwise a crafted request could leave a gap in the numbers or delete a lesson the function refuses. The app has never used them. The other direct grants stay.

## Homework rules in the database: audit and draft migration (2026-11-09, branch `claude/homework-db`)

Database only: no teacher screen, no route, no server change. The draft migration `20261109120000_homework_teacher_rules.sql`
is **not applied anywhere**. The audit is `docs/ai/HOMEWORK_DB_AUDIT.md`. It applies the owner's rules in "Homework and course
content" above to the existing homework backend and keeps every existing contract.

- **Existing homework becomes `legacy`** (the default of the new `workflow` column; nothing is back-filled, no row is
  rewritten). Legacy homework keeps today's behaviour exactly: no deadline, no limit on tries, the teacher's resubmit request,
  solutions after the student's own hand-in, up to 4 files per essay, annotations. Inventing a deadline for old homework would
  lock students out; changing when solutions open would expose or hide answers students already had.
- **New homework is `questions`:** `save_homework(null, ...)` creates `PLATFORM_QUESTIONS` homework; FILE_UPLOAD is refused for
  it and stays in the database for legacy rows. The rules travel in a `rules` object (`deadline`, `lateAllowed`, `tries`,
  `maxTries`, `solutionsOpen`, `photosAllowed`); a partial object changes only what it names. A legacy row refuses `rules`.
- **Deadline:** a draft may have none; publishing needs one ("Set a deadline before publishing"). A deadline in the past is
  accepted (the screen warns). It must carry an explicit offset or `Z`: the screen converts Cairo time, the database never
  guesses a zone. A hand-in exactly at the deadline is on time. Late hand-in covers the first hand-in only and stores
  `missed_deadline`.
- **Refusals the screens show:** `Deadline passed` and `No tries left`, both PT409 with the detail
  `{"reason":"deadline_passed"|"no_tries_left"}`; `Homework is still open` (PT409, `still_open`) for Delete images; `File too
  large` (PT413) above 5 MB; `Photo answers are off for this homework`, `A right answer from your last try cannot change` and
  `Student images are never edited` (23514).
- **Tries** are a new action `retry` (two tabs asking at once get the same try). One time = 1 try; fix mistakes and from zero
  take 2 to 10 (fix mistakes defaults to 2). Fix mistakes keeps a choice answer that matches the key, and an essay only when it
  has full marks in a released correction; kept answers cannot change and their marks are copied at hand-in. A finished try is
  locked (as before). The resubmit request is refused for questions homework and kept for legacy.
- **Solutions:** "after hand-in" opens them after the student's own hand-in, and with tries only after the last try or at the
  deadline, whichever is first. "After the deadline" opens them at the deadline, only for students who handed in (a late
  student sees them right after handing in). Tries never open them early in that mode. The same rule guards solution files in
  Storage.
- **Assistant rights:** `private.homework_assistant_permissions` (per assistant per course); `can_correct` and `can_release`
  are on when there is no row. Only an owner, admin or course instructor sets them (`set_homework_assistant`, stale check
  PT409), and only for offering staff who are not instructors. No screen yet.
- **Delete images** (`homework_delete_images`): managers only (owner, admin, course or offering instructor), after the deadline
  only, never legacy homework (it has no deadline), never exams (it takes a homework id). It marks the ready photos of handed-in
  tries `deleted`, keeps every mark, score and correction, writes an `images_deleted` audit row and returns `deletedFiles`,
  `bytesFreed` and the paths. **SQL never deletes a stored file:** the server removes the objects at the returned paths (not
  built). Draft photos are left alone. `homework_storage_usage` gives the space owner the bytes and files per space and per
  homework.
- **Teacher reads, one call per view:** `homework_portal(course or null, tab, page)` (week stats, To correct, Open / Closed /
  Drafts with bytes for closed homework, 25 per page) and `homework_queue(homework, tab, page)` (To correct / Done / Missing,
  50 per page, with try number and late flag). The scope comes from the caller's memberships, never from authorizing each
  homework of the database. A course editor who is not support staff sees the homework but no student numbers (null). A
  version is listed when it is the newest of its family or has handed-in work.
- **The week** runs Saturday 00:00 to Friday, Cairo time. "On time" is over first tries handed in this week; "handed in this
  week" counts every try.
- **Demo seed version 5** adds homework (`docs/ai/DEMO_DATA.md`, "Demo homework"). Photos are upload rows with no stored file.
  Clear now removes demo homework and homework a teacher added, and refuses while a real person's try or a stored file is there.
- **Old assertions changed, each because the rules changed:** three SQL suites and the old race script created homework with
  `save_homework(null, ...)` as FILE_UPLOAD or without a deadline (now a legacy row, or a deadline); `homework.sql` asserted
  that an assistant cannot release (the right is now turned off first); the demo suites expected seed version 4, no homework,
  and the old row counts. Each baseline change is pinned in `scripts/teacher-foundation.test.cjs`.

**Questions for the owner** (answered below, "The owner's answers to the nine homework questions"):
1. May a teacher extend the deadline after students have started? Today the definition freezes once work exists (a new
   version), and the deadline is part of it.
2. Bulk release (all corrected tries at once)? Not built; release is per try.
3. Is a Saturday-to-Friday week right for the stats?
4. Should a course editor who is not support staff see the student numbers on the board? Today: no.
5. Should assistants be able to Delete images? Today: managers only.
6. The existing homework route (strict schema) cannot send `rules`, so it can create a draft but not publish new homework. The
   new teacher route is a later track.
7. Freeing the bytes needs a server step that deletes the objects at the returned paths.
8. The server maps every PT409 to "Homework changed. Reload before saving." and drops the database message. Showing "Deadline
   passed" and "No tries left" needs that mapping extended (a baseline file the teacher-foundation test protects).
9. The student screen has no "try again" button, and the server's action list has no `retry`.

### The owner's answers to the nine homework questions (2026-11-09)

The draft migration `20261109120000_homework_teacher_rules.sql` was amended in place (still **not applied anywhere**).

1. **Change the deadline after students started: yes.** A new lifecycle action `reschedule`
   (`homework_lifecycle(id, 'reschedule', revision, {"deadline": ..., "lateAllowed": ...})`) changes only the deadline and/or
   late hand-in of new (`questions`) homework, with no new version, even after work started. Changing questions, marks, tries,
   solutions or photos still freezes and clones. It needs the authoring right, the revision the screen read (stale: PT409),
   a deadline with an explicit offset or `Z`, and takes the same homework lock as authoring. Legacy homework is refused
   (23514). It is audited (`rescheduled`, before and after). A stored `missed_deadline` is history and is never recomputed.
   - **The invariant** (a student who could already see the solutions never gets another try or hand-in) is stored in
     `private.homework_solutions_seen` (homework, student, when, the deadline then). Under the homework lock and before the
     deadline moves, the reschedule records every student with a hand-in whose solutions are open under the current rules.
     A recorded student keeps the solutions (their visibility, Storage included, is "the rules say open, or recorded"), and
     is refused `No tries left` (PT409, `no_tries_left`) in start, retry, save, submit and the photo upload intent;
     `get_homework` gives them `triesLeft` 0, `canStart`/`canRetry` false and `triesEnded` true.
   - **Solutions never open early because of a reschedule:** the new deadline must be in the future (23514), so moving it
     never makes it passed. Students who are not recorded follow the rules with the new deadline: a student with no hand-in
     may start or hand in the first time on time. Records only accumulate; Clear removes them with the demo homework.
   - `homework_portal` and `homework_queue` read the deadline column, so they use the new deadline.
2. **Bulk release: yes.** `homework_release_many(homework, [{submissionId, revision}])`: 1 to 500 items, no duplicates, one
   homework, all or nothing. Every item needs the release right and passes the checks of a single release (a handed-in try of
   this homework, the correction finished) and must not be released yet; re-releasing an edited correction stays single, with
   its reason. Released as `approved`. Any stale revision (PT409, `stale`) or failed check (23514 `unfinished` /
   `already_released`, 42501 for another homework's try) refuses the whole call. Tries and then corrections are locked in
   submission id order, the order single grade and release use, so it cannot deadlock or half-apply. One `release` audit row
   per try (reason `bulk release`). Returns `{released, items: [{submissionId, revision}]}`. `homework_queue` gains
   `readyToRelease` (count) and `releasable` (at most 500 `{submissionId, revision}`, by id) for "Release 12 grades".
3. **The Saturday-to-Friday week (Cairo):** yes, as built.
4. **Course editors who are not support staff:** keep null student numbers, as built.
5. **Delete images:** stays managers only, as built.
6. **The old route cannot publish new homework:** fine; the screens track adds the new teacher route.
7. **The server step that removes the files at the returned paths:** yes, in the screens track.
8. **Student error mapping for "Deadline passed" / "No tries left":** yes, in the screens track.
9. **Student "Try again":** yes, in the screens track: a plain button plus the `retry` action on the existing student
   homework screen, no redesign.

No old assertion changed in this amendment. `homework-rules.sql` now also checks the new private table's RLS and grants and
the new helper's revoke; the shape test lists `homework_release_many`; `database.types.ts` gains two additive lines.

## A lesson is never tethered to one of its components (owner's rule, 2026-11-10, branch `claude/lesson-publish`)

The owner, in their words: **"A lesson should never be tethered to one of its components."** Some teachers don't want videos, some
don't want homework, some don't want exams. A lesson can be published with no parts, no videos, no content items, no cover and no
homework. Draft migration `20261110120000_lesson_publish.sql`, **not applied anywhere**. Database only; no screen or route changed.

- **Audit.** The rule lived in one place: `edit_learning_content`, action `edit_lesson` ("Publish a part first", 23514), first in
  `20261013141230` and copied into `20261018091735` and `20261018092002`. No trigger, table check or policy asked for a part. The
  part-level rule (a part needs a video, notes, a resource or a content item before it is published) stays.
- **Removed:** that one line. `edit_learning_content` is otherwise byte-for-byte the `20261018092002` version, and `edit_lesson`
  still writes the title, description and status (the scripts test both facts).
- **New actions** `publish_lesson` and `unpublish_lesson` in `edit_course_structure`: `can_edit_course`, the course-root lock, the
  `updated_at` the teacher read (stale: PT409), an archived course refused (PT409, `{"reasons":["archived"]}`), no options, no new
  version and no copy. Asking for the state a lesson is already in writes nothing. `course_structure` already returns the status.
- **Unpublish keeps everything:** tries, answers, corrections, marks, files and audit rows stay exactly as they were; students stop
  seeing the lesson and its homework (homework visibility already requires a published lesson) until it is published again, when
  they see their work as before. Student work never blocks an unpublish.
- **The direct grant `update(status)` on `lessons` is revoked** (owner's answer 2), so a client publishes or unpublishes only
  through the functions. Nothing relied on it: no app code updates `lessons` directly (a script test scans `app`, `server`,
  `frontend` and `shared`), the demo functions and every other writer are security definer functions, and the SQL suites that set a
  status directly do it as the database owner. `title`, `position`, `description` and `estimated_duration_seconds` keep their
  grants.
- **Notifications:** publishing a lesson with no part still sends "lesson published"; its link is empty (no error) until a part is
  published, and then the same notification links to that part. No second notification is sent.
- **Demo seed:** unchanged (owner's answer 3). The demo gets a published lesson with homework and no parts in the screens track,
  once the student lesson page exists.
- **Old assertions changed, both because of the owner's rule:** `course-content-tree.sql` asserted that `edit_lesson` refuses a
  published lesson with no part (it now keeps it published), and used `publish_lesson` as its example of an unknown action (now
  `archive_lesson`). Six script tests that list the migrations after theirs gained the new file, as every migration before it did.
- This replaces "publishing needs a published part" in "Course content tree" above (the "Draft state" point).

**The owner's answers (2026-11-10).** 1: build the database change now; the student lesson page addressed by the lesson id comes in
the next run, the Homework screens track, as a plain page in the existing student styles. 2: revoke the direct status grant.
3: no demo seed change in this run.

**What the student lesson page needs (for the Homework screens track).** No new database read is needed:
- **Today:** every student lesson page is addressed by a part (`/courses/<course>/chapters/<partId>?offering=<offering>`,
  `SecureLessonPage`). A published lesson with no parts shows as a **Locked** card with no link (`v2Chapters`: `href: null`,
  `status: 'Locked'`, `partsCount: 0`; `lesson-card.tsx` and `student-home.tsx` show Locked when there are no parts), Continue
  Learning and previous/next skip it, and its homework is unreachable because `HomeworkAssignments` is rendered only on a part page.
- **Reads it can use as they are:** `learningService(courseId).offering(offeringId)` (active, unexpired enrollment in an active
  offering of a published course); `tree()` (lessons, parts, content items, all through RLS: `can_view_lesson` = staff, or a
  published lesson of a course the student may view); the lesson's cover through `lessonThumbnails`; the homework list through
  the existing `POST /api/homework/new/list` with `segmentId: null`, which returns every homework of the lesson the student may
  see (RLS `homework_visible`, which needs a published homework, an active offering, a published course and a published lesson);
  `get_homework` and `homework_work` for opening and handing in, unchanged.
- **Visibility to keep:** a draft lesson, a draft course, an inactive offering or an ended enrollment shows "unavailable", as the
  part page does. Unpublishing hides the lesson and its homework, never the student's stored work.
- **Links to change:** the Locked card (and the Home lesson list) should link to the new page when the lesson has no published
  part, and Continue Learning keeps linking to parts. A lesson that has parts keeps today's part page.

## Teacher Homework screens, part 1 (2026-11-10, branch `claude/homework-ui`)

- **Routes.** `GET /api/teacher/homework` (homework_portal), `GET /api/teacher/homework/<id>` (get_homework, staff only), `POST
  /api/teacher/homework/<id|new>/save` (save_homework), `POST .../<id>/lifecycle` (publish, unpublish, clone, reschedule) and `POST
  .../<id>/delete-images`. Each checks Firebase staging, the origin (reads: Sec-Fetch-Site same-origin, and an Origin when sent),
  JSON content type, a streamed body cap (600 000 bytes for save, 4 096 otherwise) and a strict zod schema; the user is always the
  signed-in one; revisions are whole numbers passed through unchanged; deadlines are ISO 8601 with an offset. Writes run a server
  pre-check (`editableTeacherCourse`) and then the database function, which authorizes again. Refusals: 42501 and PGRST116 are 403;
  23514, 22P02 and 23505 are 400 with a named reason when the message has one; 23503 is 409 `in_use`; PT409 is 409 with its detail
  reason (`still_open`, `deadline_passed`, `no_tries_left`), `started` for "Work has started", otherwise `changed`; PT413 is 413.
  The old `/api/homework/*` routes stay for the upload flow and the student side.
- **Delete images, how the files go.** `homework_delete_images` (managers of that homework, after its deadline) marks the student
  photos `deleted` in `private.homework_uploads` and returns their paths; grades, marks, notes and answers are untouched. The server
  then removes the objects from the `lms-homework` bucket through the Storage API with the same signed-in (RLS-bound) client, in
  chunks of 100, which the storage policy allows only for a `deleted` submission photo and a manager of that homework. Only paths
  under `<homework id>/` without `..` are sent. SQL never deletes an object. If the removal fails or is cut short, the reply says
  `storage: 'retry'`, the rows stay `deleted` (students and teachers already see the photos as deleted), and
  `private.expired_homework_uploads` keeps listing them; `node scripts/lms-storage-maintenance.cjs` (operator-only, dry run by
  default, `--apply` to act) now also removes `deleted` homework files that are still in Storage. There is no automatic retry in
  the app: one would need a queue or a scheduled job, which is a new migration or a provider change.
- **Course runs.** Homework belongs to a run (offering). The wizard's Course list shows each course once, or "course · run" when a
  course has several runs; course and lesson are fixed after the first save (save_homework refuses a change).
- **Row actions read first.** The page read has no revision, so Publish, Unpublish, Change deadline and Edit read the homework and
  send the revision they got.
- **Started homework.** Saving makes a new version through the existing clone; a new date for everyone is Change deadline, which
  makes no version. On the clone, question and option ids are taken from the copy by position.
- **Pending owner questions.** An in-app retry for image removal (needs a migration); whether to show Preview as student; whether
  rows should show question count and marks (the page read does not return them).

## Homework move, answer letters and model answer pictures (2026-11-12, branch `claude/homework-move`)

Draft migration `20261112120000_homework_move.sql`, **not applied anywhere** (one migration for all of it).

- **A homework moves until a student starts.** `save_homework` may change a homework's lesson and/or course (offering) only when no
  submission of any status exists AND it is the only row of its family. Otherwise PT409 with `{"reason":"started"}` or
  `{"reason":"versioned"}`. The caller must edit both courses (`can_edit_course` on the target, `homework_staff` author on the
  source); the route checks both too, before the write. Both offerings are locked FOR SHARE in id order, then the homework FOR UPDATE,
  so a student's start (homework FOR SHARE) and a move are serialised. The integrity trigger allows course/offering/lesson to change
  only under the same two conditions and still checks that the lesson belongs to the course. Each move writes a `moved` audit row
  with course, offering and lesson before and after.
- **What else is keyed by course (checked):** `homework_assistant_permissions` is per course and is read through the homework's
  current course, so a moved homework follows the new course's assistant rules; the `homework_assignments_course_status` index
  follows the row; Storage paths are keyed by homework id, not course; notifications exist only for `homework_released`, which needs
  submissions (so never for a movable homework); demo Clear selects homework by the space's current courses and the seed ledger by
  space, so a moved homework is cleared by whichever space now holds it; course structure counts, the group summary and lesson delete
  blockers are computed live. Nothing needed rewriting.
- **A move stays inside one teaching space** (owner's answer, 2026-11-12): a course in another space (organization) is refused with
  PT409 `{"reason":"other_space"}` even when the caller edits both: by `save_homework`, by the integrity trigger for every writer,
  and by the save route before the write. The wizard offers a saved homework only the courses of its own space.
- **Choice questions:** no textbook switch. A choice starts with four blank answers A to D; question text and answer texts are
  optional; 2 to 8 answers. The teacher taps every right answer: one is `single_choice`, more than one `multiple_choice` (derived;
  no type control). Students are told "Choose the right answer" or "Choose every right answer". The database's textbook rule is
  dropped; 2 to 8 options, no duplicate keys and at least one right answer to publish stay.
- **Letters** run A to H (never numbers); Arabic: أ ب ج د هـ و ز ح, on the teacher's screen and on the student's (owner's answer).
- **Model answer picture:** one per question in `private.homework_keys.model_image_id` (an image, uploaded through the existing flow
  with purpose `solution`, the question-picture limit). Students see it only when the solutions open for them
  (`homework_unlocked`, so also after `solutions_seen`), in `get_homework`, `homework_upload get` and Storage
  (`homework_upload_visible`). It is copied on clone. Offered on every question (owner's answer): beside an essay's model answer and beside a choice
  question's explanation.
- **"Photo answers for essays"** moved to the Rules step under "How students answer"; off switches photo essays to text, with a
  one-line note.
- **Off menu items** show their reason inside the item, small and muted: "Move up (already first)", `aria-disabled` kept, on the
  question menu and the Content section (desktop menu and phone sheet).
- **Rows** on the Homework page show "N questions · M marks" from `homework_portal` (`questionCount`, `totalMarks`, computed for the
  listed rows only).
- **Demo data:** not extended for model pictures (owner confirmed): demo data never writes Storage, so a model picture row would point
  at no file.

Old assertions changed: `homework-rules.sql` ("a textbook question has exactly the letters A to D" became "a question with three
blank answers saves", and the following revisions moved up by one); `teacher-homework.test.cjs` (the textbook and one-or-several
tests became the tap-to-mark, derived-type, letters and lock tests; a contract case with three blank answers became nine answers
and one answer; letter(5) is F, not 6); `teacher-homework-sql.cjs` (no `setTextbook`); `teacher-course-content-browser.cjs` (the
desktop Move up is `aria-disabled` with its reason inside, not Radix `data-disabled`; the sheet reads "Move down (already last)");
the migration-order tests (the new file is the newest).

## Correcting homework, the Home card and the student lesson page (2026-11-12, branch `claude/homework-correct`)

Draft migration `20261113120000_homework_correct_demo.sql`, **not applied anywhere**: demo seed version 6 only (DEMO_DATA.md).

- **No new database read.** `homework_queue` (lists, counts, `readyToRelease`, `releasable` with revisions), `get_homework` with one
  submission (keys for staff, the try, `canGrade`, `canRelease`) and `homework_portal` (the Home card) are enough. Writes are the
  existing `homework_work` grade/release and `homework_release_many`.
- **How a release notifies (audited).** Neither route sends anything. The row trigger `notification_homework` on
  `private.homework_corrections` (`private.notification_business_event`) emits `homework_released` to the student when
  `released_at` is set, keyed `homework:<submission>:<released_at>`. A single release and "Release N grades" both set `released_at`
  on each try, so both notify identically: one notice per released try, never a push delivery from SQL. A grade withdrawn and
  released again notifies again (new `released_at`). `supabase/tests/homework-correct.sql` proves it. Nothing needed changing.
- **A released grade changes only with a reason** (three characters or more), which the database writes to the audit; saving
  withdraws the release until it is released again. The screen says so before saving.
- **Stale is not a failure.** PT409 on a save keeps what the teacher typed; Reload reads the new revision and keeps the typing.
- **Bulk release is all or nothing**, the queue's list sent unchanged: `{"reason":"stale"}` (changed elsewhere), `already_released`,
  `unfinished` and a denial are explained and nothing is released.
- **Student refusals carry their reason.** The owner approved extending the protected baseline for this: `homeworkChecked` keeps the
  reason the database names (`deadline_passed`, `no_tries_left`) or the message it raises (`stale`, `submitted`, `unavailable`),
  the work route returns it with the English text and accepts `retry`, and the screen says it in the student's language. The
  three baseline edits are pinned pair by pair in `scripts/teacher-foundation.test.cjs`.
- **The lesson page** (`/courses/<course>/lessons/<lesson>?offering=<group>`) runs the part page's checks (signed in, published course,
  active group, active unexpired enrollment, published lesson in the student's own tree). With a published part it opens that part
  (the one Continue Learning would); without one it shows the lesson and its homework. Continue Learning still links parts only.

## Exams in the database (2026-11-13, branch `claude/exams-db`)

Draft migration `20261114120000_exams.sql`, **not applied anywhere**. Database only: no screen, no route except closing the legacy
builder, no demo seed. Plan and details: `EXAMS_DB_AUDIT.md` (section f). The owner's answers:

1. Number questions exist for exams only; homework gets them later.
2. The legacy builder's save and clone are closed in the database (execute revoked on `save_exam_definition`,
   `save_exam_definition_v2`, `clone_exam_schedule`) and on `/api/secure-exams` (`save-definition`, `clone` removed from the route,
   the middleware and the browser allow-list). The legacy runner still reads.
3. A Group whose linked session is cancelled holds answer review and auto-release until the teacher picks a new session; teacher
   reads flag it (`held`).
4. A Group created after publishing is linked automatically by the same rule, source `auto`.
5. A started try keeps its deadline; a Group's window that opened keeps its times (stored when its session moves).
6. One shared correct/release pair per assistant per course (homework's rights table).
7. Paper: optional "held on" date; marks in 0.5 steps from 0 to the maximum; Absent is separate from 0.
8. Fix mistakes keeps the first try's order; essays reopen with the first answer, editable.
9. Auto-release and notices are written at the next action after the last close.
10. Manual release per student once their own window has closed; answer review waits for the last window.
11. Answer review only for students with a handed-in try.
12. Authoring (save, publish, windows) uses course edit rights (`can_edit_course`).
13. Demo Clear removes teacher-added exams in demo spaces and refuses, removing nothing, while a real person's exam work or a
    stored exam file is there.

Also decided while building: a released online mark changes only with a reason and stays released (homework withdraws the release);
paper results can be released any time after publishing; the release notice has no link until the student screen exists; exam
pictures are shared by the versions of one exam family.

### Amendment (owner's answers on `9f1169c`, 2026-11-13; same draft migration, amended in place, not applied)

1. Window freezing never depends on a later read. A Group created in a run with published, unclosed per-Group exams is linked when
   it is created (same rule, source `auto`), by a trigger at the commit that created it (so the Group command's sessions exist); a
   Group whose first session comes later is linked at that session's commit. When a session's times change or it is cancelled after
   it opened, every exam window linked to it keeps the times it had before the change (including a link not stored yet, which is
   stored frozen). Windows not yet opened keep following the session.
2. The teacher list (`exam_portal`) carries live counts per Group for open exams: started / total and the time left in the window on
   the server clock, plus the students in no Group. Same scope rule, no per-row authorization.
3. Archived exams stay visible to their students for released results (confirmed).

## Exams part 2: drafts, the student side, the Home card (2026-11-14, branch `claude/exams-student`)

Draft migration `20261115120000_exams_drafts_and_demo_v7.sql`, **not applied anywhere**.

1. **A draft never loses a question.** `exam_save` on a draft keeps unfinished questions (a choice with 0 to 8 options or no right answer,
   a number with no value). Invalid indexes, a repeated right answer and options on a number are still refused. A published exam keeps the
   strict rules. `exam_check` (Publish) lists the unfinished questions (1-based positions) and raises 23514 with
   `{"reason":"unfinished_questions","questions":[...]}`. The browser always sends every question; nothing is left out on autosave.
2. **The student screens decide nothing.** `/api/exams*` call `exam_student_list`, `exam_get`, `exam_work`, `exam_upload` as the signed-in
   student (no user id sent, no service role). A staff view of `exam_get` is refused on the student route (404). The order of a try's
   questions and choices is the stored one and is never reordered on the client. The clock is the server's: the countdown is read from the
   try's deadline with an offset from the server time, and at zero the server's auto-submit wins (the screen reads it back, it never
   submits for the student). A lost connection keeps the answer on screen, retries the save every few seconds and holds a hand-in back
   until everything is saved.
3. **Second try** is offered only inside the student's own window, by the exam's rule (`fix_mistakes` keeps right choices, `from_zero`),
   once. **Answer review** (right answers, model answers, the marker's note) appears only when the database says review is open.
4. **Release notices** for `exam_released` now link to `/exams/<exam id>` for new exam results (`notification_link`).
5. **Home "Live now"** reads `exam_portal` (open tab) as the Exams page does: one row per Group whose window is open with that Group's
   started / total and the time left; hidden when nothing is open; no new per-row authorization.
6. **Demo seed v7** adds five Physics exams (open now, closed with essays waiting, corrected-not-released, upcoming per Group, paper with
   marks and one Absent) tracked in `demo_seed_rows`; Clear still removes teacher-added work only through the existing refusal rules.

## Password reset (2026-11-14, branch `claude/password-reset`; migration `20261116120000` not applied)

1. **Own pages, not Firebase's.** `/forgot-password` asks for an email; `/reset-password?oobCode=...` verifies the code (`verifyPasswordResetCode`), shows the
   email, takes the new password twice (12+ characters, strength hint) and calls `confirmPasswordReset`. Expired, used, invalid, disabled and offline
   states each have their own screen; expired/used/invalid offer "Send a new link". The code is removed from the address bar after use.
2. **No enumeration.** The route answers 202 with the same body before any account lookup; the lookup, link and email run after the reply
   (`after()`), so timing does not tell either. Bad body is 400, a limit 429, an unconfigured mailer 503, each the same for every address.
3. **Link minted on the server** with `generatePasswordResetLink`; only its `oobCode` is kept and the email links to our own page. Only accounts with the
   password provider that are not disabled are sent a link (a Google-only account would otherwise gain a password and link by email).
4. **Rate limits (owner's question 2).** In-memory fixed windows per process, hashed keys, bounded: email 3 per 15 minutes, IP 20, shared bucket 200 when
   no trusted IP header is configured (`PASSWORD_RESET_CLIENT_IP_HEADER`, last entry). No new table or provider. On several instances the limit is per
   instance; moving it to the database is a follow-up if the owner wants it.
5. **Email** through the existing Brevo setup (`BREVO_API_KEY`, `AUTH_EMAIL_FROM`, tag `edulabs-password-reset`): table layout, inline styles, VML button for
   Outlook, a dark-mode query, a phone query, the link also as text, a text part, English, Arabic (RTL) or both when no language is known. The logo is
   `public/email/edulabs-mark.png`. Nothing logs an address, code or link: only a fixed event name.
6. **Other sessions.** A password change makes Firebase invalidate refresh tokens, and the app verifies every session cookie with the revocation check, so other
   devices are asked to sign in again. No server-side revocation call was added; not verified against a live provider.
7. **Demo seed 8** (same migration): Group 2 sessions no longer land at 12:00 AM Cairo (a `timestamptz` variable held a Cairo wall time), and a
   `homework_released` notice for a lesson with no published part links to the student lesson page by lesson id.
