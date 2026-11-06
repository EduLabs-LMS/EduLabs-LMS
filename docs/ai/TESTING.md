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
