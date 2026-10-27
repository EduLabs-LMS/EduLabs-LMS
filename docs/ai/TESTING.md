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
