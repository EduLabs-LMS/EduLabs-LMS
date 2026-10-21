# Settings account hub and preserved student-stage visibility

Updated locally on 2026-10-20 on `codex/student-settings-stage-visibility` at base
`a53a096c525d525b41d98ecf21922eb32bea9cb7`. All changes remain uncommitted for review.
No push, merge, deployment, connected database mutation or migration occurred.

## Why Settings was empty

The preceding correction correctly separated Notifications, but Settings then
rendered an empty application-preferences resource. Existing profile/security
features were available only through the account opener and were not exposed as a
useful Settings destination. The earlier legacy form also suffered from Firebase
route allowlist exclusions, a Clerk/Prisma-only API, silent load failures and V2-unused
dashboard preferences. The present hub reuses actual account functionality rather
than inventing options to fill the page.

## What is implemented

- Protected `/settings` shows account name, authenticated email, verification state
  when supplied by the provider, and the existing authorized profile image.
- Missing names/emails/photos use explicit fallbacks, never fictional account data.
  Broken image delivery shows a neutral profile icon; no new image/storage system.
- **Manage account** opens the already-mounted account dialog. There is no second
  profile form, security implementation, profile table or upload API.
- Existing dialog handles name edits, image selection/upload/removal, provider-photo
  import where supported, stale-write conflicts and photo-cleanup recovery.
- Existing security forms retain reauthentication, verify-before-email-change,
  password checks and session-refresh behavior. Settings does not call those SDK
  mutations directly or change any authorization rule.
- The existing provider bridge now exposes its loading/error/reload state and
  email-verification state to the account hub. Successful edits update its shared
  profile state and therefore the hub and sidebar together.
- **Open Notifications** navigates to `/notifications`; the hub contains no feed,
  unread counter, notification preference controls or subscription controls.
- The session action delegates to the existing sign-out handler, shows progress,
  and exposes failure without falsely confirming server revocation.
- Clerk mode reuses Clerk's authenticated user, verification information and
  existing `openUserProfile()`/sign-out handlers.

`/personalization` still redirects to `/settings`. The bounded, identity-scoped
compatibility API and its validated empty Firebase application-resource contract
remain, but the hub does not fetch them to obtain profile data. The unused
`frontend/lib/settings.ts` client helper was removed after an import audit found no
application consumers; its only former importer was a test. Legacy dashboard
validation contracts remain actively used by the compatibility API.
Legacy dashboard preference records remain stored. No ineffective Save button or
additional application settings have been introduced.

## Notifications and academic stages preserved

`frontend/features/notifications/notifications-view.tsx` remains identical to base,
including seven event toggle pairs, saving/error behavior, bell, feed, read actions,
links, pagination and browser registration. Communications APIs/RPCs, RLS, event
creation and delivery workers remain unchanged.

The student academic-stage panel remains unmounted on Home and Self Learning,
without blank space or hidden preference requests. The single academic-contract
visibility flag remains false. Underlying APIs, records, teacher management,
authorization and the existing `docs/new-lms-phase2.md` backlog are preserved.

## Executed account-hub verification

- **354/354 application tests passed**, including existing account/security tests
  and 27 focused Settings tests. A separate focused Settings/account run passed
  all 44 tests.
- Architecture boundaries passed; strict non-incremental TypeScript passed.
- ESLint: 0 errors, 10 existing warnings.
- **20 Chromium component scenarios passed**, zero page exceptions and no
  desktop/mobile overflow or hidden student-stage API requests.
- Both production builds passed again after the final fixes: Firebase/Supabase and Clerk/Prisma fallback.
- Three anonymous authentication/CSRF smoke checks passed against the actual local Firebase-mode production server. Its owned process was stopped.

Browser coverage uses actual ApplicationAuthProvider, FirebaseAccountBridge,
AccountDialog, AvatarPicker, AccountSecurity, account fetch clients, account-security
helpers, shared navigation, hub, NotificationsView and StudentLearning. HTTP responses,
Firebase identities/SDK calls, Clerk provider and browser push APIs are synthetic.
It exercises name save/refresh, shared profile updates, photo upload/removal, email
verification request and password reauthentication ordering, missing fields/images,
API error/retry, mobile editor, failed logout, notification preferences and existing
feed/registration controls. It also exercises the Clerk account opener.

These tests **do not prove real Firebase sign-in, provider email delivery, remote
profile/Storage persistence, real sign-out revocation or push-device delivery**.
No connected test identities, uploads or academic records were created. Existing
account tests separately verify server-side input/CSRF/authentication restrictions,
image normalization and reauthentication requirements with controlled dependencies.
The established disposable native PostgreSQL harness was rerun: all 31 migrations
replayed, 23 SQL suites passed, and all 109 concurrency cases passed. The Settings
suite passed all 11 assertions unchanged. Its transaction rolled back; the entire
disposable database was then removed and the owned cluster stopped. No connected
Supabase project was accessed.

Two initial local failures were corrected before the successful runs: the installed
Lucide version exports `User`, not `UserRound`; a browser test needed its name
locator scoped to the hub because the sidebar correctly displayed the updated name
as well. Existing E:-backed ignored build outputs/dependency links are reused to
avoid the C: disk-space limitation encountered during the preceding correction.
No tracked build configuration or dependency lockfile was changed.

## Final correctness fixes and audit (2026-10-20)

Firebase full names now filter null/undefined/empty name parts, trim and normalize
whitespace, and use the authenticated provider display name only when neither saved
part is available. If that is also absent, the value is null and the hub displays
"Name not set". Six tests render the actual ApplicationAuthProvider for first-only,
last-only, both, neither-with-provider, neither-without-provider and undefined/blank
values. Actual browser scenarios also run the bridge/hub through these cases.

The account error now says: "Your profile details could not be loaded. Please retry,
or sign in again if the problem continues." Retry profile, visible failure and
sign-in recovery remain. A failed profile load does not claim a save or change.

The actual Settings server page is exercised with anonymous and resolved Firebase/
Clerk viewers. It redirects unresolved viewers to sign-in. Provider-neutral
getApplicationViewer, Firebase token verification, profile binding and server-side
account authorization remain unchanged. The profile editor, avatar upload, email
verification and password reauthentication implementations were not replaced.

Desktop and mobile scenarios each assert exactly one visible Settings link in its
navigation and verify the active state. The alternate legacy sidebar is a separate
navigation implementation, not an additional Settings item within the V2 sidebar.
NotificationsView remains identical to base. The 20 scenarios include all seven
preference pairs, feed, actions, pagination, bell preview, registration and separate
hub navigation. Home and Self Learning make zero hidden stage-preference requests.

## Exact files changed during this final correctness/audit task

1. `frontend/components/providers/application-auth-provider.tsx` — safe name assembly.
2. `frontend/features/personalization/dashboard-form.tsx` — accurate profile error copy.
3. `server/http/personalization/route.ts` — use the retained response-validation contract.
4. `frontend/lib/settings.ts` — removed unused task-added client; no application imports.
5. `scripts/settings.test.cjs` — component-rendered name regressions, route guard and contract audit.
6. `scripts/settings-browser-components.cjs` — name/copy/navigation/bell regressions.
7. `docs/student-settings-stage-visibility.md` — this report.

Earlier account-hub work is retained, including provider loading/error/reload state,
existing editor reuse, the protected route, navigation and the academic-stage backlog.
Ignored .local harnesses, builds, screenshots, logs and dependencies are verification
artifacts. No credentials or environment values are included in source exports.

## Screenshots

Local Chromium component screenshots with fictional accounts (not authenticated
provider evidence): `.local/settings-browser/settings-desktop.png`,
`settings-mobile.png`, `account-editor-mobile.png`, and
`settings-mobile-drawer.png`. Fonts/styles and actual components are reused; the
component harness supplies its own page shell, rather than Next's full server page.

## Remaining limitations

- Real-provider acceptance was not run because connected account/database mutations
  are excluded from this task.
- Email delivery, provider verification links and real push delivery remain separate
  acceptance gates. The UI preserves their existing verification requirements.
- Old dashboard option records still have no consumer in the V2 dashboard; retained
  compatibility does not imply a new configurable dashboard.
- The normal launcher uses its existing checkout, not this isolated worktree.


## Final SQL, legacy compatibility and CSRF review

### Verified implementation results

The current Clerk/Prisma Home route calls getStudentHomeData and passes lessons,
group details and homework information to the same V2 StudentHome renderer. Neither
that route, query nor renderer reads Personalization.dashboard. The repository's
only production Prisma personalization reads are in the compatibility API itself.
At the base commit, DashboardForm offered In Progress/Completed checkboxes and saved
them, but no dashboard renderer consumed those choices. Thus the current fallback
supports stored personalization records, not working preference-driven dashboard
customization. No fake customization controls were added to Firebase or Clerk.

Account hub/editor, Notifications, academic-stage visibility and all migrations are
unchanged during this review. NotificationsView, preference APIs/RPCs, delivery code,
RLS and the Settings SQL suite retain their existing implementation.

### Legacy compatibility contract — editor retirement approved

The owner explicitly approved retiring the ineffective legacy editor; it is not
restored. /personalization continues redirecting to the existing Settings account hub.
The Clerk API response contract is now preserved:

- Existing-record GET and PUT return the full authenticated user's own Prisma record,
  including id, userId, dashboard, createdAt and updatedAt, as the original handler did.
- Missing-record GET returns null. It creates no row and fabricates no selections.
- GET returns stored values unchanged, even historical dashboard strings that do not
  match current write validation. It performs no rewrite, normalization or migration.
- PUT modifies only the validated dashboard field. Existing record id, userId and
  createdAt are preserved; Prisma manages updatedAt normally. New rows use only the
  server-derived authenticated identity and validated dashboard value.
- Reads and upserts always use where.userId from the authenticated viewer. No client
  identity or record ID is accepted. All metadata/identity extras are rejected.
- The intentionally stricter write validation, bounded JSON requests, no-store/private
  responses, authentication and exact-origin CSRF protections remain. This is not a
  promise to preserve insecure arbitrary-field writes from the original handler.

The earlier metadata-only response narrowing and fabricated default selections have
been corrected. No API-envelope approval remains pending. The ineffective UI's
retirement is approved; any future dashboard customization would be a separate task.

### Production APP_ORIGIN / CSRF verification

The compatibility PUT reuses the existing validFirebaseOrigin helper for both modes.
In NODE_ENV=production it fails closed if APP_ORIGIN is absent. The Origin header
must exactly match the configured origin and Sec-Fetch-Site must not be cross-site.
APP_ORIGIN must be the externally visible scheme/host/port only, without a trailing
slash/path. Proxy/deployment origins must be configured consistently; this task
neither inspected nor changed any deployed environment or actual production value.
In development only, an unset APP_ORIGIN falls back to the incoming request URL's
origin, still requiring a matching Origin and denying cross-site writes.
Authenticated GET reads do not require the write-origin check, and remain private,
no-store and identity-scoped. Production clients omitting Origin cannot PUT; foreign
origins, wrong ports and a trailing-slash mismatch are denied with 403 before data
access. This intentionally introduces a production configuration requirement for
legacy writes compared with the original unguarded handler.

Four new tests exercise the actual origin helper inside the legacy API fixture:
missing production configuration; exact-origin save/read and peer separation;
missing/foreign/cross-site/wrong-port/misconfigured origins; development fallback.
No origin-validation implementation changed. Test hosts/identities are synthetic.

### Automated outcomes from the preceding SQL/compatibility audit

- Native PostgreSQL: 31 migration replays; 23 SQL suites; 109 concurrency cases: passed.
- supabase/tests/settings.sql: 11 assertions: passed unchanged; no RLS relaxation.
- Database reconciliation: zero disposable databases remain; owned cluster stopped.
- Application: 350/350; focused Settings/account: 40/40; architecture: passed.
- Strict non-incremental TypeScript: passed. Lint: 0 errors / 10 existing warnings.
- Desktop/mobile Chromium: 20 scenarios passed. One test-only timing race was fixed:
  wait for the bell's asynchronously loaded items before counting them. Notifications
  source was not changed to make the test pass.
- Both production builds passed again in this review: Firebase/Supabase and Clerk/Prisma fallback.

### Real-provider acceptance still untested

The SQL run uses actual isolated PostgreSQL with local auth/storage bootstrap
objects and synthetic JWT claims, not connected Supabase or provider delivery.
Browser/API/provider tests use synthetic fixtures. Real Clerk/Prisma database CRUD,
Firebase sessions, remote Storage persistence, verification email delivery, provider
logout revocation and push-device delivery were not tested. No test identities or
connected business records were created or changed.

### Exact files changed during this review pass

- scripts/settings.test.cjs — actual production/development CSRF and legacy API tests.
- scripts/settings-browser-components.cjs — wait for asynchronous bell items.
- docs/student-settings-stage-visibility.md — evidence, exact compatibility impact,
  origin requirement and explicit owner-approval gate.

All previously uncommitted implementation work remains preserved. No migration,
production code, notification authorization or RLS policy was changed in this pass.

## Final narrow envelope correction

Only server/http/personalization/route.ts, scripts/settings.test.cjs and this report
changed in this pass. The handler no longer selects only dashboard or validates/
normalizes values on GET. Explicit dashboard assignments replace even the previously
validated object spread in upsert. Notification code, account hub/editor/security,
academic-stage implementation, RLS, schema and all environment files are unchanged.

Actual automated results in this pass: 354/354 application tests, 44/44 focused
Settings/account tests, strict non-incremental TypeScript, architecture checks and
lint (0 errors, 10 existing warnings) passed. Four new tests verify raw own-record
GET envelopes, PUT metadata/persistence, null/create/peer isolation, and rejected
identity/metadata fields. Existing actual-origin policy tests still pass. Both
production builds passed again: Firebase/Supabase and Clerk/Prisma fallback. Existing
isolated build tooling was used; no environment configuration or dependency changed.

The prior 20 component scenarios and local SQL run (31 replayed migrations,
23 suites, 109 concurrency cases, 11 Settings SQL assertions) remain historical
verification from the immediately preceding review, not newly rerun results in
this response-envelope-only pass. No SQL, notification or account UI code changed.
Real Clerk/Prisma persistence is tested with a controlled Prisma fixture here;
no connected account/database writes or real-provider acceptance were performed.

## Complete outstanding inventory versus base

- Modified: `app/(dashboard)/(routes)/personalization/page.tsx`
- Modified: `docs/new-lms-phase2.md`
- Modified: `frontend/components/providers/application-auth-provider.tsx`
- Modified: `frontend/components/sidebar.tsx`
- Modified: `frontend/features/auth/firebase-account-bridge.tsx`
- Modified: `frontend/features/dashboard/sidebar-item.tsx`
- Modified: `frontend/features/dashboard/sidebar-routes.tsx`
- Modified: `frontend/features/personalization/dashboard-form.tsx`
- Modified: `frontend/features/self-learning/student-learning.tsx`
- Modified: `middleware.ts`
- Modified: `package.json`
- Modified: `scripts/exam-sql-local.cjs`
- Modified: `scripts/student-academics-browser-components.cjs`
- Modified: `scripts/website.test.cjs`
- Modified: `server/http/personalization/route.ts`
- Modified: `shared/contracts/student-academics.ts`
- Modified: `shared/website-routes.ts`
- New: `app/(dashboard)/(routes)/settings/page.tsx`
- New: `docs/student-settings-stage-visibility.md`
- New: `scripts/settings-browser-components.cjs`
- New: `scripts/settings.test.cjs`
- New: `shared/contracts/settings.ts`
- New: `supabase/tests/settings.sql`

23 source/documentation files have content changes versus the unchanged base. The narrow correction changes only the three files identified above. No files are staged. NotificationsView has no base-relative content diff, even if Git status still flags its checkout metadata.
