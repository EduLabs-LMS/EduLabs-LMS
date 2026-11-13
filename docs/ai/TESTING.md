# Testing instructions and evidence boundaries

## Application checks
npm test
npm run check:boundaries
npm run lint
npm run typecheck
npm run build

TypeScript must actually exit successfully. For a worktree containing generated local
fixture apps, use a reviewed ignored application-only tsconfig extending the root,
including app/frontend/server/shared/next-env, excluding node_modules/.local, with
strict:true, noEmit:true and incremental:false. Do not exclude production modules or
claim an out-of-memory run passed. Existing package typecheck remains unchanged.

Both optimized Firebase/Supabase and Clerk fallback builds are required. NEXT_PUBLIC_*
mode/config is build-time; credentials must be supplied through existing protected
runtime configuration, never bundled or copied into this handoff. This task's ignored
.local/settings-build.cjs reads existing root configuration without printing/copying it,
uses one build worker, an isolated output directory and application-only tsconfig.
Inspect it locally before reuse. It is not portable source or a secret distribution.
An auxiliary preinstalled web-push runtime was needed through child-process NODE_PATH;
this preparation installed nothing and did not change the lockfile.

## Disposable SQL only
npm run test:exam-sql:postgres
The existing harness reads a loopback PostgreSQL port from ignored .local/step03a/
pg-port.txt, creates a unique owned database, replays 32 migrations and executes 24
rollback suites plus independent-session concurrency tests. Run only against an owned
local disposable cluster. It does not use a Supabase URL. No hosted migration replay,
db push, history repair or real academic records. Keep the migration ledger intact.

## Browser tests
node scripts/student-access-browser.cjs
node scripts/settings-browser-components.cjs
node scripts/continue-learning-browser.cjs
node scripts/continue-learning-next.cjs --build
node scripts/continue-learning-next.cjs
node scripts/teacher-foundation-browser.cjs

Prerequisites: external Playwright/esbuild runtimes, Chromium and native-video test
media (FFmpeg for its generation). LMS_BROWSER_RUNTIME/LMS_ESBUILD_RUNTIME point to
node_modules containing those tools; LMS_CHROMIUM_EXECUTABLE identifies the browser.
LMS_COMPONENT_FONT_BUILD and LMS_LANGUAGE_FONT_BUILD identify the isolated Firebase
build with its static CSS/fonts. No .env files or credentials belong in archives.

Continue Learning must pass multiple independent optimized Next server/browser runs:
Back cache, normal navigation, completion, late writes, out-of-order reads, failure/
retry, >1,000-row truncation, revoked access and rapid navigation. The fixture build
skips TS/lint for synthetic adapters; full application TS/lint/builds remain separate.
Standalone auth navigation uses a synthetic router transport; it does not prove the
real Firebase/Next integration. SQL tests prove local RLS, not hosted configuration.

Test failures referencing intentionally deleted UI were replaced with retirement
assertions; backend/service/contract/RLS coverage remains. See the review report for
exact counts, initial failures and remaining live-provider/cross-browser limits.

Platform admin (teacher provisioning): scripts/platform-admin.test.cjs (unit/contract/render, part of npm test), scripts/platform-admin-browser.cjs (Chromium, fictional HTTP, real brand fonts from .next after a build, a11y/contrast scans, screenshots; needs LMS_BROWSER_RUNTIME/LMS_ESBUILD_RUNTIME), supabase/tests/platform-admin-provisioning.sql and supabase/tests/teacher-invitation-delivery.sql (via exam-sql-local --postgres), scripts/teacher-invitation.test.cjs (deterministic link, Send/Copy token reuse, replacement invalidation, mailer outcomes, send ordering, preview/accept handlers, storage, copy; part of npm test; the Chromium harness also drives the teacher invitation page and the admin send/copy/delivery states). None of these is Firebase/Supabase/email end-to-end verification.

SQL runtime note: the default in-memory runtime (PGlite 0.5.8) is PostgreSQL 18 and reports ON DELETE RESTRICT as
23001, which the existing academic-programs-stages suite (written against PostgreSQL 17, 23503) rejects. This is
independent of any migration (it fails identically on the 31-file baseline). The authoritative run is
`npm run test:exam-sql:postgres` against a disposable PostgreSQL 17 on loopback. Release procedure and rollback:
docs/platform-admin-staging-release.md.

Demo spaces: scripts/demo-spaces.test.cjs (part of npm test) covers the service, the admin HTTP routes (non-administrators denied,
bounded strict body, no user/role/recipient injection), the pinned migration, locale parity, the Home label rule, and fails when
the latest demo seed version in the SQL, the service constant and docs/ai/DEMO_DATA.md disagree. A feature that stores teacher data
without extending the demo seed (see DEMO_DATA.md) must update those three places in the same change.

Teacher Settings and Groups & Classes: scripts/teacher-settings-groups.test.cjs (part of npm test: section array, exact-path
middleware run through the REAL middleware.ts, pure Groups model, endpoint/command allow-list, EN/AR parity, wording) and
scripts/teacher-settings-groups-browser.cjs (Chromium; every page and API request goes through the real middleware; fictional
/api/study-groups; filled and cleared demo states, errors with retry, EN/AR, 390/1440, light/dark, 44px targets, keyboard).
scripts/teacher-home-browser.cjs covers Home, the menu and the frame. The teacher browser harnesses compile their stylesheet from the current sources (`scripts/harness-css.cjs`: Tailwind compile of app/globals.css plus the CSS files app/layout.tsx imports); `.next` is only read for the font faces, so an old build can no longer make them fail (or pass) wrongly. `LMS_FRESH_CSS` is no longer used.
These use synthetic data and are not provider acceptance.


Demo clear: supabase/tests/demo-clear-robust.sql (rolled-back transaction; registered in scripts/exam-sql-local.cjs, so `npm run test:exam-sql:postgres` runs it on a disposable PostgreSQL only; it has NOT been run against any database yet).

## Students screen (`claude/students-screen`)

- `node --test scripts/teacher-students.test.cjs`: the model (status, merged paging, Group index, approve outcomes, the 43-character link secret against the real contract), the REAL middleware, the menu entry, source guards (the secret never logged, stored or navigated to; only the existing endpoints and actions; actions hidden without manage rights) and English/Arabic locales.
- `node scripts/teacher-students-browser.cjs` (needs the same environment as the other teacher browser harnesses: `source .local/pa-env.sh`, `LMS_FRESH_CSS`): desktop, phone, Arabic/RTL, dark theme, the real middleware, fictional student-administration and Groups services, every error state, approve then Group add (and its partial failure), Invite students and that the secret appears only in the create request and the final `/join/<token>` text.
- `supabase/tests/demo-students-screen.sql` runs in the local PostgreSQL suite (`npm run test:exam-sql:postgres`), rolled back.

## Students fixes (`claude/students-fixes`)

- `supabase/tests/group-summary-performance.sql` runs in the local PostgreSQL suite: the previous `group_view` is installed as `group_view_before` and compared with the new one for 35 person/group cases plus the independent counts.
- `node scripts/exam-sql-local.cjs --postgres --bench` also runs `group-summary-performance-benchmark.sql` (20,400 attendance rows in six extra spaces, EXPLAIN ANALYZE before and after). It is slow because the old function is slow; it is not part of `npm run test:exam-sql:postgres`.
- `node scripts/teacher-attendance-browser.cjs` (real middleware, synthetic data, fake clock for retries) covers: mark-the-rest never overwriting, the slow-save reload that used to show a stale state (and the fixed page that re-checks), automatic retry then Retry, the leave guard on links, menu, Back and reload, alphabetical order and search above 15 students, the Edit attendance focus, flat finished labels, phone, Arabic and dark. `teacher-home-browser.cjs` covers the live-class button order, the unsaved list across Groups and dark-mode contrast of the yellow buttons. Both need `LMS_FRESH_CSS` to contain a Tailwind build of `app/globals.css` **plus** `frontend/styles/appearance.css` (the dark-mode rules live there), otherwise a stale `.next` stylesheet makes the dark contrast check fail.
- `node scripts/exam-sql-local.cjs --postgres --bench` also times, inside the local PostgreSQL only, the two calls an attendance save makes (`group-attendance-save-benchmark.sql`: 28 marks, 1 mark, and the session `view`). It does not measure network, hosting or the connected Supabase project.
- `node scripts/teacher-students-browser.cjs` covers the Invite panel with draft courses and the `/join` failure text in English and Arabic.

## Course page and teaching space name (`claude/course-page-space-name`)

- `node --test scripts/teaching-space-name.test.cjs scripts/teacher-course-page.test.cjs`: the name contract, the migration's shape (LF, pinned as text, last, only the provisioning function and the two read models replaced, never `auth.uid()`), the owner-rename route, the course page helpers, loader, links and Arabic/English text.
- `supabase/tests/teaching-space-name.sql` (58 checks, rolled back, every identity a Firebase subject through `onboard_firebase_profile`) runs in the local PostgreSQL suite (`npm run test:exam-sql:postgres`) on a disposable server only; it has NOT been run against any provider database.
- `node scripts/teacher-course-page-browser.cjs` (same environment as the other teacher browser harnesses: `source .local/pa-env.sh`, `LMS_FRESH_CSS`): the real middleware, desktop, phone, Arabic/RTL, Publish and Unpublish with confirmation, a stale version (409), a refused change, a failed change, a lost reply, the grade read failing on its own, no edit rights, archived, missing and server error. Fictional services, synthetic data.

## Speed (`claude/speed`)

- Server timing: set `LMS_SERVER_TIMING=1` (staging only). API responses carry a `Server-Timing` header (phase names, durations, call counts; no ids or user data). Pages carry the same text in `<script type="application/json" id="lms-server-timing">`; read it with `JSON.parse(document.getElementById('lms-server-timing').textContent)`. Phases overlap when parallel, so they do not add up to `total`. Round-trip counts are exact and portable; milliseconds depend on the network.
- Local measurement: `node scripts/speed/measure.cjs --dist <build dir> --label X --memo on|off --google-ms 120 --supabase-ms 25 --runs 5 --out file.json` (production build with `EDULABS_DIST_DIR`).
- SQL: `scripts/exam-sql-local.cjs` runs `supabase/tests/listing-performance.sql` (equivalence); `--bench-listing` runs the benchmark. The migration is never applied from here.
- Browser: `scripts/loading-overlay-browser.cjs` (skeletons instead of the overlay, first-load overlay once, stale-while-revalidate per user and cleared on sign-out). Needs `LMS_ESBUILD_RUNTIME` and `LMS_BROWSER_RUNTIME`. Its navigation is a stand-in for Next; confirm skeleton timing on staging.
- Unit: `scripts/request-scope.test.cjs`, `scripts/swr-cache.test.cjs`, `scripts/listing-performance.test.cjs`.

## Design foundation (`claude/design-v2-foundation`)

- `node --test scripts/design-foundation.test.cjs` (part of `npm test`): WCAG AA of every text and fill pair in both looks and themes, the owner's New values, Classic values against today's sources, no black edge in New, every token defined in both looks, logical properties only, the switch cookie, the bridge's scoping, avatar hashing, locale strings, the REAL middleware for the new routes and lookalikes.
- `node scripts/design-foundation-browser.cjs`: the real frame, Home, switch and shared components, 16 groups. The test server writes `data-design` from the cookie with the real `designFromCookie`. It sweeps both looks, both themes, phone and desktop, English and Arabic: AA on rendered text, 44 px targets, no overflow, no black edge in New. Screenshots go to `.local/design-foundation-browser/screenshots`, named `<look>-<theme>-<desktop|phone>-<en|ar>-<home|settings|gallery>.png`.
- **Classic visual check:** run a harness on the commit before the foundation and keep its screenshots as the baseline, run the same harness with `LMS_CLASSIC_OLD_GEOMETRY=70` (the old phone header height; `scripts/harness-css.cjs` then puts the content where the old frame had it and leaves the footer out, which the old harnesses did not render), then `node scripts/classic-visual-compare.cjs <baseline> <current> <diffDir>`. It leaves the frame out and writes an image of what differs. Clock times in the data and buttons caught mid-transition show up as small differences; read the diff images before concluding anything. Baselines are not committed, so this is a manual check.
- The logo: `scripts/loading-overlay-browser.cjs` covers sign-in (plays to its end, never on navigation, reduced motion, the 5 second cap) and the fresh opening with the real head script (ten routes, once per tab, a new tab plays it, the user change does not restart it, reduced motion, storage blocked, the stylesheet cap).
- A real-server check of the first byte: `next dev` with `EDULABS_DIST_DIR` set to a folder under `.local` and placeholder public Firebase values, then `curl -H 'Cookie: edulabs_design=new' /sign-in`. `next dev` rewrites `tsconfig.json`: restore it afterwards. It proves the cookie reaches `<html>` on a public page only; signed-in pages were not requested.

## Owner feedback on the New look (`claude/design-v2-foundation`)

- `node --test scripts/design-feedback.test.cjs` (part of `npm test`): the countdown words in English and Arabic with every plural form and edge, the server clock with a device clock wrong by years, the real head script in a stand-in document, tokens, and that all motion CSS sits inside no-preference and starts with the New look.
- `scripts/design-feedback-checks.cjs` runs inside `node scripts/design-foundation-browser.cjs`, in both looks, light and dark, desktop and phone, English and Arabic where it matters: active pill and edge, no box around the logo, Soon items, each motion present in New and absent in Classic and with reduced motion, the countdown against a device clock wrong by hours and years (Playwright's clock also moves it minute by minute). Screenshots are named `new-<light|dark>-<desktop|phone>-<en|ar>-<home|home-next>.png`; `home` has a live class and `home-next` has a next session with its countdown. To work on one group, set `LMS_ONLY_STEPS` to a regular expression; a full run sets nothing.
- **The opening logo against a real Next server:** `scripts/first-open-real-server.cjs` proves what a harness that renders on the client cannot: the first byte, hydration with no warning, the logo animating and lifting with the app's scripts blocked, and JavaScript off. Start `next dev -p 3477` with `EDULABS_DIST_DIR` under `.local`, `NEXT_PUBLIC_AUTH_BACKEND=firebase-staging`, `LMS_DATA_BACKEND=supabase-staging` and placeholder `NEXT_PUBLIC_FIREBASE_*` values, then run it with `LMS_FIRST_OPEN_BASE=http://127.0.0.1:3477`. It requests public pages only and is not part of `npm test`. `next dev` rewrites `tsconfig.json`: restore it afterwards.
- The timings of motion are read from the browser's own animation objects. Whether the motion feels calm can only be judged by a person.

## Owner feedback after testing New (`claude/design-v2-foundation`)

- `node --test scripts/design-controls.test.cjs` (part of `npm test`): both looks stay, the credits and their AA on every background, the teacher's footer, the menu that changes in place, the logo at 3:1 on everything it sits on, switch and choice contrast, and a scan that finds no native checkbox, radio or select in the teacher area or the shared screens.
- `scripts/design-controls-checks.cjs` runs inside `node scripts/design-foundation-browser.cjs`: the logo's measured contrast, the footer, `Switch`, `ChoiceGroup`, `Select` (keyboard, roles, 44 px, RTL, disabled, inside a dialog), Notifications and the language page, in both looks, themes and languages.
- `scripts/teacher-attendance-browser.cjs` has the finished sheet in both looks, both themes, desktop and phone, English and Arabic. It sets the look on `<html>` after the page loads and renders without the frame.
- `scripts/first-open-real-server.cjs` also measures the logo's contrast on `/sign-in` against a real server, in both looks and themes.
- In a browser test, click a disabled control with `{ force: true }`: Playwright waits for an `aria-disabled` element to become enabled.

## Every teacher screen, every look (`claude/design-v2-foundation`)

- `scripts/screen-matrix.cjs` shoots each screen in Classic and New, light and dark, English and Arabic, desktop and phone, to `.local/design-screens/<screen>/<look>-<theme>-<lang>-<size>.png`, and fails on: text below WCAG AA or 12 px, a control edge below 3:1, a target below 44 px (inline links excepted), sideways scroll, or Arabic that is not right-to-left. Text on a gradient is measured against each stop; a picture background is listed as not measured, never passed.
- Run it with `LMS_MATRIX=1 LMS_ONLY_STEPS='^Screen matrix' node scripts/<harness>-browser.cjs`, for `teacher-home`, `teacher-attendance`, `teacher-students`, `teacher-settings-groups`, `teacher-course-page` and `design-foundation`. Each writes `audit-<label>.json` beside the pictures. A normal run skips it.
- It measures rendered states on synthetic data, not every state. Look at the pictures too: on sign-in it was looking, not a measure, that found the large tree's shadow.
- The course page harness has no teacher frame, so its pictures show the page without the sidebar.

## Course content tree (`claude/course-content`)

- `supabase/tests/course-content-tree.sql` (216 checks, rolled back, every identity a Firebase identity) runs in `npm run test:exam-sql:postgres`: who may write and read, cross-space denial, stale requests, moving with everything attached, every refused delete with its reason and counts, a published unstarted lesson, the chapter label on create, reorder, move and delete, every refusal on an archived course, the read, demo seed 4 and Clear. It has NOT been run against any provider database.
- `supabase/tests/course-content-rewrite-before.sql` and `-after.sql` run around this one migration during the replay (8 checks): old-style rows, with gaps, custom labels and an archived course, are rewritten once.
- `scripts/course-content-concurrency.cjs` runs in the same command when it uses PostgreSQL: 13 real two-tab races on separate connections, including the chapter numbers and archiving. Because `updated_at` is the transaction's time, staleness inside the single-transaction SQL suite is tested with an old stamp, and only this script proves it across transactions.
- `node --test scripts/course-content-migration.test.cjs` (part of `npm test`) checks the file's shape.
- The runtime is in the main checkout: `LMS_SQL_RUNTIME=/c/dev/EduLabs-LMS/.local/step03a/runtime/node_modules`. `bash .local/pg17.sh start` starts the disposable server.
- **Expect a long full run.** `listing-performance` is much slower after the other suites than alone: on the base commit `0d32831`, 234 s alone and 1,476 s in a full run; on this branch, 215 s alone and about 44 minutes in one full run while other runs shared the machine. Why it slows after the other suites is not diagnosed. To work on one suite, set `LMS_SQL_ONLY=<name>`.
- `node --test scripts/course-content-screen.test.cjs` (part of `npm test`): numbering, reorder and move payloads, which function each action calls, database codes to replies to messages, refusal wording in both languages, the contract, the middleware pattern.
- `scripts/course-content-screen-sql.cjs` runs in the same SQL command, after the races: the screen's own payload builders, the route's contract and reply mapper against the real functions, under a Firebase identity, with the `updated_at` round trip. pg gives the code, message and detail directly; PostgREST is not run.
- `scripts/teacher-course-content-browser.cjs` (Chromium, real middleware, real contract and reply mapper, fictional server, synthetic data): desktop drag and keyboard moves, move to another chapter, inline add and rename, delete, Delete off with its reason, a refused delete, stale reload with the typed text kept, a lost reply, archived, assistant, the phone sheet, Arabic RTL, Classic and New. `LMS_MATRIX=1` adds the screen matrix. Needs a Firebase-mode `npm run build`, `source .local/pa-env.sh` and `LMS_FRESH_CSS=1`.
- The esbuild path in `.local/pa-env.sh` no longer exists on the owner's machine. These runs set `LMS_ESBUILD_RUNTIME` to another existing copy.
- A harness pressing Escape within milliseconds of opening a Radix menu or dialog can be ignored: the layer has not registered yet. No person is that fast. The harness waits briefly first.

## Sign-in (`claude/design-followups`)

- `scripts/sign-in-browser.cjs` runs the real `FirebaseForm` with a synthetic Firebase SDK on a loopback server: the wording and behaviour of sign-in, sign-up, the show-password control, Forgot password, a failed sign-in, the unverified-email panel, the photo chooser, the Sign in button's contrast in both looks and themes, and that the marker is what opts the page into New. `LMS_MATRIX=1` adds the screen matrix for four sign-in screens (sign-in, sign-up, failed sign-in, unverified) to `.local/design-screens/<screen>/`.
- `scripts/screen-matrix.cjs` no longer adds the teacher marker to a page that carries `data-auth-surface`, so the sign-in page is tested on its own marker. A visually hidden file input is measured through its 44 px label.
- `scripts/teacher-website-gate.test.cjs` runs the real middleware for `/teacher/website`.

## Homework rules (`claude/homework-db`)

- `supabase/tests/homework-rules.sql` (179 checks, rolled back, every identity a Firebase identity): create and rules, deadline
  edges (at, just after, late allowed for the first hand-in only), every tries mode, solutions visibility (also by storage
  path), assistants with and without each right, Delete images (keeps grades, refuses before the deadline and for legacy and
  exams, audited), the portal and the queue, cross-space denial (another teacher, a student of another course, anon), grants;
  reschedule (before and after the old deadline, who is recorded, no try or hand-in for them, a first hand-in for the
  others, solutions neither re-close nor open early, stale, past deadline, legacy, rights, audit, `missed_deadline` kept)
  and bulk release (all or nothing on a stale, unfinished or released item, 500 cap, duplicates, rights, audit, the
  queue's release list).
- `supabase/tests/homework-reads.sql` (12 checks): a few hundred synthetic tries in two spaces. Every page of every tab of
  `homework_portal` and `homework_queue` equals a naive query that authorizes every homework of the database one by one, for
  five callers (owner, assistant, editor, a teacher of two spaces, the other space's owner).
- `supabase/tests/demo-homework.sql` (38 checks): demo fill and clear at seed version 5, every homework row recorded, the reads
  on demo data, and Clear refusing (removing nothing) with a real person's try or a stored file.
- `scripts/homework-rules-concurrency.cjs` (11 races on separate connections): two graders, release against grade (both
  orders), two tabs asking for the next try, two tabs handing in the same try, a hand-in waiting past the deadline (refused,
  and flagged late when late is allowed), no try after a late hand-in, a bulk release against a grade (both orders),
  two bulk releases sharing a try, and a reschedule against a hand-in at the old deadline (both orders).
- `node --test scripts/homework-rules-migration.test.cjs` (part of `npm test`) checks the file's shape and the stable refusals.
- The old suites `homework`, `notifications-support`, `student-administration`, `course-content-tree` and the demo suites were
  changed only where the rules change them (DECISIONS.md lists each change).
- Run just these: `LMS_SQL_ONLY=homework,homework-rules,homework-reads,demo-homework node scripts/exam-sql-local.cjs --postgres`
  (the races run with every `--postgres` run).

## Lesson publish (`claude/lesson-publish`)

- `supabase/tests/lesson-publish.sql` (51 checks, rolled back, every identity a Firebase identity): the direct status grant is gone
  and the other grants stay; an empty lesson (no part, no content item, no cover, no homework) is published and unpublished by the
  space owner, the course instructor and a course editor; stale, no version, options, assistant, a teacher who does not teach the
  course, a student, another space's teacher (also naming their own course) and anonymous are refused, and an archived course is
  refused with its reason; the old `edit_lesson` publishes a lesson with no part; a lesson with only homework: a student sees the
  lesson and its homework only while it is published, hands in with a photo, is graded and released, then after unpublish sees
  nothing and cannot start, while every try, answer, correction, mark, file and audit row is kept exactly, and after publishing
  again sees their work; another space's student sees nothing; the notification of a lesson with no part has no link and no error,
  and links to the part once one is published.
- `scripts/lesson-publish-concurrency.cjs` (2 races on separate connections): publish against delete of the same lesson, both
  orders (the delete is stale, or the publish finds the lesson gone).
- `node --test scripts/lesson-publish.test.cjs` (part of `npm test`): the file's shape, that `edit_learning_content` lost exactly the
  one line, that `edit_course_structure` only gained the two actions, that only the status grant is revoked, that no app code
  writes a lesson status directly, and that the student models show a published lesson with no parts as Locked with no link and
  never throw (Continue Learning offers nothing for it).
- `course-content-tree.sql` changed in two assertions (DECISIONS.md lists both, with the reason).
- Run just these: `LMS_SQL_ONLY=lesson-publish,course-content-tree node scripts/exam-sql-local.cjs --postgres` (the races run with
  every `--postgres` run).

## Homework screens, part 1 (`claude/homework-ui`)

- `node --test scripts/teacher-homework.test.cjs` (part of `npm test`, 23 tests): Cairo times (+02:00 winter, +03:00 summer, the
  spring gap has no time, the autumn fold takes the later instant, round trip), the Saturday to Friday week; the wizard's state
  (step issues, blank answers and the derived type, letters A to H and Arabic, the move lock rules, options and answers, photos off makes every essay text, tries 2 to 10 and one time sent as 1, the
  deadline with its offset, what a draft needs, read back unchanged); the contract (extra keys, a client-named user, string,
  fractional, negative and unsafe revisions refused; revisions kept exactly); every refusal code and reason mapped and read back by
  the screen; the five routes with a stubbed viewer and database client (signed out is 401 before any call, foreign origin, wrong
  content type, bad JSON, oversized bodies, repeated query keys, `new` only for save, the server pre-check refusing another space's
  teacher or an assistant before the write, the signed-in user only, versions round-tripped, a student refused); Delete images (the
  paths filtered to the homework, removal in chunks of 100 with the signed-in client, a failed removal reported as `retry`, nothing
  removed while open); the middleware's exact paths; the menu; static rules (no native checkbox or disabled attribute, only the
  homework and content routes); every `hw.*` text in both languages with the same holes and no ruled-out word.
- `scripts/teacher-homework-sql.cjs` (in `npm run test:exam-sql:postgres`, after the lesson-publish races): the real functions under
  Firebase identities through the contract and the reply mapper: a wizard draft saved and read back (Cairo wall time and revision
  round trip), a stale save; another space's teacher and an assistant without editing refused by the database; publish without a
  deadline refused with `no_deadline`; the page read's shape, counts, rights and a week that starts on Saturday in Cairo; Change
  deadline stale, past and saved; Delete images while open (`still_open`), by an assistant (denied) and after the deadline; a student
  is never staff on the teacher's routes.
- `scripts/teacher-homework-browser.cjs` (Chromium, synthetic loopback server checked against the real contract and the real
  middleware): the page, filter, row menus by tab, publish from the menu with the revision read, Change deadline with the Cairo
  offset and a past time caught on screen, Delete images, the phone list, empty/error/signed-out states, the wizard from nothing to
  published (autosave, the draft lesson note and Publish lesson, blank answers as letters and the derived type, photos off on Rules, tries capped at 10 with the reason, the
  deadline offset), a stale save keeping the typed text, and started homework. Then 112 pictures: every screen and dialog at 1360
  and 390, Classic and New, English and Arabic, each measured (no sideways scroll, 44 px targets, 12 px text, no native disabled
  or checkbox, no ruled-out word, nothing says Soon). `LMS_COPY_SHOTS=1` copies them to `docs/design/screenshots/homework-ui/`.
- `scripts/teacher-course-content-browser.cjs` gained Publish and Unpublish lesson (the confirm, cancel sends nothing, the exact
  version) and checks the phone sheet's reasons.
- Runs: `source .local/pa-env.sh` (esbuild may need its own folder: `LMS_ESBUILD_RUNTIME`), a Firebase-mode build for fonts; CSS
  is compiled fresh by `scripts/harness-css.cjs`.

## Homework move (`claude/homework-move`, migration `20261112120000_homework_move.sql`)

- `supabase/tests/homework-move.sql` (`LMS_SQL_ONLY=homework-move`, 96 checks, Firebase identities): a move to a course in another
  space refused (`other_space`) for a teacher who edits both, in both directions and by the trigger, and allowed within the space; a
  choice question's model answer picture opened with the solutions; a draft and a published
  homework moved to another lesson and to another course (the audit row before and after); refused after a student's draft and
  after a hand-in (`started`), for a later version (`versioned`), for a teacher who cannot edit the target and for another space's
  teacher; the trigger's own refusals; the relaxed choice rule (2 to 8 blank answers, at least one key to publish, no duplicate keys);
  the model answer picture before and after solutions open, by Storage path, through `homework_upload get` and `get_homework`, for a
  student of another course, an outsider, after the deadline and after a reschedule; the copy on clone; `homework_portal` counts
  against a naive query; grants and shapes.
- `scripts/homework-move-concurrency.cjs` (every `--postgres` run): a move first then a start (the start waits, then starts in the
  new lesson); a start first then a move (refused `started`, nothing moves); a move to another course first then a start (refused,
  no try left behind).
- `scripts/teacher-homework.test.cjs` adds the letters, the derived type, the lock rules, and route tests for a move (both courses
  checked before the write, `started` and `versioned` as plain refusals, another space's teacher denied).
- `scripts/teacher-homework-browser.cjs` adds the move step (unlocked, locked with the reason, another course clears the lesson and
  nothing saves until one is picked, a refused move keeps the typed text) and the row counts; `LMS_COPY_SHOTS=move` copies the
  `move-*` pictures to `docs/design/screenshots/homework-move/`.

## Homework correcting (`claude/homework-correct`, migration `20261113120000_homework_correct_demo.sql`)

- `supabase/tests/homework-correct.sql` (`LMS_SQL_ONLY=homework-correct`): demo v6 fill and clear (the lesson with no part, the
  homework's states, recorded rows, Clear refusing a real person's try), the queue's counts and `readyToRelease` against a naive
  query, a try as staff sees it (deleted photo, keys, Missed the deadline), another space's teacher and an assistant with correct
  and release off refused by the database, single grade/release/stale/marks above the points/reason required/withdrawn, bulk release
  (stale refuses all, releases five, the same notifications as a single release, audit rows, no push delivery, already released).
- `scripts/teacher-homework-correct.test.cjs`: every new route (signed out, wrong origin, another space's teacher and an assistant
  as the database answers them, bad and oversized bodies, every code and reason mapped, revisions round-tripped), the exact
  middleware paths, the correcting logic, the Home card mapping, the student lesson page decisions, Try again and the plain
  refusals in both languages.
- `scripts/homework-correct-browser.cjs` (`LMS_COPY_SHOTS=correct`): the correcting screen (one student, Save and next, a deleted photo,
  stale with Reload kept typing, release one, a released grade needing a reason, Release N grades refused on a change, the phone list and
  Reload reachable above the sticky bar), the Home card, and the student lesson page (Try again, the kept answer locked, a refusal in
  Arabic), with the real middleware and contract; 92 screenshots in `docs/design/screenshots/homework-correct/`. The student pictures
  keep the existing student styles and are checked for sideways scroll only.
- Seed version 6 changed totals in older suites (the version 5 assertions by title are unchanged): `demo-homework.sql` (5 homework,
  rows `5/15/35/15/5/72/214/213/71/23/23/1`, 691 recorded, 3 closed, 22 essays waiting, 695 and 800 cleared), `demo-students.sql`
  (6 lessons, 800 recorded, 801 with the teacher's Session; space F also drops the version 6 lesson to look like version 1),
  `demo-clear-robust.sql` (808 and 800), `course-content-tree.sql` (Magnetism has 3 lessons, 9 recorded chapters and lessons, 6 read),
  `demo-notifications.sql` and `demo-students-screen.sql` (seed version 6).
- `teacher-homework-browser.cjs`: Correct is now a link to the correcting screen (it was off with "Correcting comes in the next update").
  `teacher-home-browser.cjs` and `design-foundation-browser.cjs` give Home `homework: {state: 'unavailable'}` (what the loader sends
  outside Firebase), so the card stays hidden there and their pictures do not change.
- Known, not from this change: `design-foundation-browser.cjs` steps "Desktop frame, both looks" and "Homework, Exams and Reports" still
  expect four links and Homework as Soon (true before the Homework page); `student-academics-browser-components.cjs` (its
  `next/navigation` stub lacks `usePathname`) and `student-access-browser.cjs` (sign-in heading) fail on the base as well; the web-push
  unit test needs `node_modules/web-push`.

## Exams in the database (`claude/exams-db`, migration `20261114120000_exams.sql`)

- `supabase/tests/exams.sql` (`LMS_SQL_ONLY=exams`, 181 checks): grants and RLS (no table grant, wrappers invoker, definers with an
  empty search path, `authenticated` only), authoring and publish checks, windows (same time, per Group, auto link of a Group added
  later, picked and custom, cancelled hold, freeze on a session move), start/save/submit, deadlines and the hand-in at the next
  action, fix mistakes and from zero, choice and number marking, grading and release (single, bulk all or nothing, reasons), paper
  marks and Absent, review gates, notices (one per release), uploads (claim, size, owner, reads), the portal, queue and paper sheet
  counts, scope (another space, assistants without rights, students), the legacy builder refused.
- `supabase/tests/exams-demo.sql` (`LMS_SQL_ONLY=exams-demo`, 11 checks): demo Clear removes teacher-added exams with their tries,
  results, photo rows and notices; refuses on a real person's try or paper mark and on a stored exam file; a plain Clear still
  removes the 800 recorded rows.
- `scripts/exams-concurrency.cjs` (in the `--postgres` admin block): 9 independent-session races (session move vs start both orders,
  two tabs starting, two tabs handing in, grade vs release both orders, bulk release vs grade, a start waiting past the window end,
  two paper sheets).
- Legacy tests changed because the builder is closed: `exam-authoring.sql` and `exam-completion.sql` build their fixtures through
  `pg_temp.legacy_save`, `pg_temp.legacy_save_v2`, `pg_temp.legacy_clone` (security definer wrappers of the same private definers)
  and assert the public builder refuses; `scripts/exam-concurrency.cjs` calls the private definers as the owner with claims;
  `scripts/exam-runner.test.cjs` now expects `save-definition` and `clone` to be refused. Migration-list pins (teacher foundation,
  course content, homework rules, listing performance, lesson publish, group summary, teaching space name, demo spaces) include
  the new migration.
- The web-push unit test needs `node_modules/web-push` installed (environmental).
