# Core Release Work 1 — registration and class access

Date: 2026-10-22. Status: locally validated; live-provider pilot acceptance pending.

## Source and preservation

Actual worktree: `C:/Users/Sky-II-14600kf/.codex/worktrees/student-settings/EduLabs-LMS`.
Branch: `codex/student-settings-language`.
Unchanged HEAD: `5be818564c359689350c17497b0585f43605e983`.
The worktree and index were clean at entry. Everything in this assignment remains
local and uncommitted. No teacher-facing UI, provider settings, environment files,
connected data, migrations, middleware, grants or application RPCs were changed.

Reviewed the current implementation and `step08-migration-review.md`,
`trial-operations.md`, `organization-provisioning.md` and
`firebase-auth-integration.md`. The latter explicitly describes a historical
checkpoint; its former claims of missing functionality are not a current audit.
The October 16 throttle and later pre-VPS report are historical evidence. Neither
establishes that the provider remains throttled today.

## Existing functionality retained

- Email/password creation and sign-in; Google popup with redirect fallback;
  Apple is exposed only when explicitly configured. These supported code paths
  do not establish which providers are currently enabled in the hosted project.
- Registration keeps the authenticated Firebase account after verification-mail
  or name-update failure. Same-identity retry never creates a duplicate account;
  an unauthenticated email match never links or claims another account.
- Resend cooldown and explicit verification reload. The client and server still
  require verified email before creating a usable academic session.
- Browser-local persistence, token renewal, revocation-aware server verification,
  bounded HttpOnly cookies and UUID identity mapping through the existing RPC.
- `/join/<43-character-token>` preserves its exact continuation through sign-in
  and signup. Arbitrary URLs/admin destinations remain rejected.
- Request links grant no academic access. Requests are identity-bound and
  deduplicated; teacher approval uses existing locked, capacity-checked RPCs.
  Invitations are bound to an explicit verified profile, never an email match.
- Existing RLS and enrollment checks deny unauthorized, suspended and expired
  access. Historical approval is distinct from current enrollment eligibility.
  Established continued access after an offering ends, while enrollment remains
  active and unexpired, is unchanged.
- Successful logout invalidates the identity's old authentication times in the
  database, revokes Firebase refresh sessions and clears browser/server identity.
  Existing failed-revocation error handling is preserved, not presented as a
  successful remote revocation.

## Verified defects and corrections

1. `restoreFirebaseAuth()` cached a rejected browser-persistence promise forever.
   A transient storage failure consequently made every later retry fail. Failed
   initialization now clears that promise. Successful initialization remains
   coalesced and cached; no weaker persistence fallback was introduced.
2. Student access loading retained old errors/results, did not guard late
   responses from previous links/pages and offered no in-place status refresh.
   It now has a visible loading state, clears obsolete presentation, ignores
   abandoned reads, keys local state/idempotency to the link, and exposes Retry
   and Refresh status through the existing endpoint. A synchronous operation
   guard prevents duplicate UI submissions; SQL remains authoritative.
3. Historical approved requests without current enrollment lacked an explanation.
   The student now receives an explicit unavailable-access message. Transient
   operation messages are cleared during subsequent reads. Errors never turn
   into apparent empty results or retained access grants.
4. The existing account-browser harness lacked the `usePathname` export now
   required by the language provider. Its synthetic navigation stub was fixed;
   production navigation and teacher workflows were not changed.

`frontend/features/admin/users/student-access.tsx` is located under an older
directory name, but is imported only by student `/join` and `/access` pages.
No teacher management component consumes it.

## Actual executed verification

| Check | Result |
| --- | --- |
| Complete application suite | 414 passed, 0 failed; final repeat passed |
| Focused Firebase/signup/administration suites | 38 passed |
| Strict TypeScript | `tsc --noEmit --strict --incremental false`, exit 0 |
| Architecture boundaries | Passed |
| Lint | 0 errors, 9 existing warnings |
| Firebase/Supabase production build | Passed, exit 0 |
| Clerk/legacy production build | Passed, exit 0 |
| Disposable PostgreSQL | 31 local migrations replayed; 23 rollback suites passed |
| Administration SQL | 80 assertions, including four new explicit recipient-bound expired/revoked invitation denials |
| Other selected SQL | Authorization 73; Firebase identity 34; Lessons 72; Homework 96; exam suites 76/17/50; Settings 11 |
| Concurrency | All existing independent-session suites passed, including 14 student-administration cases |
| New Chromium workflow | 12 groups passed; no browser JavaScript errors |
| Existing account Chromium | 10 groups passed |
| Settings/Notifications Chromium | 21 groups passed, no hidden academic-stage requests |
| Whitespace | `git diff --check` passed |

### What the browser and SQL results mean

The new browser runner executes the real React FirebaseForm,
FirebaseAuthProvider, signup recovery, session-sync helper and StudentAccess.
Firebase SDK and HTTP transports are deliberately synthetic and restricted to
an ephemeral loopback server. The real join-page redirect is tested independently
at the application boundary. The browser runner's protected routing is a fixture,
not evidence that a deployed Next.js route or hosted provider accepted an identity.

It exercises signup failure without a usable session, unchanged-account resend,
verification reload, exact class continuation, duplicate requests, pending state,
refreshed approval, session restoration, revoked/expired access presentation,
rejection/reason, failed-read retry, late-response isolation, unavailable links,
existing-account sign-in and actual provider-component logout behavior.
The existing account harness additionally exercises synthetic Google/Apple SDK
contracts, confirmation, recovery, account editing and security actions.

Actual PostgreSQL runs separately under application roles and RLS. Its suites
verify approval/enrollment, capacity, unauthorized direct writes, tenant/recipient
isolation, duplicate commands, recipient-bound invitation expiry/revocation,
academic access, suspension/expiry, preserved history and identity revocation.
The concurrency suites use independent sessions. These are simulated JWT claims;
they do not prove a real Firebase token traverses hosted Supabase successfully.
There is no claim of a single live registration-to-course browser run here.

Desktop 1440px/mobile 390px, English/Arabic direction and light/dark combinations
were rendered with the existing real language/theme providers, asserting actual
document language, direction, dark class and absence of horizontal overflow.
Existing authentication and access copy remains mostly English in Arabic mode;
this assignment did not undertake a localization redesign. Screenshots are
component-fixture evidence, not screenshots of a deployed teacher website.

### Local harness issues resolved

- The first full test invocation could not resolve `web-push` through this
  worktree's dependency junction. Reusing the established process-only
  `NODE_PATH=E:/EduLabs-Milestone5/node_modules` resolved it; no package/config
  changes were made and all 414 tests subsequently passed.
- The bundled Playwright expected a different browser revision. Tests were rerun
  using the existing installed Chromium executable, without installing packages.
- A visual test initially visited signup while already verified; the correct
  application redirect prevented its screenshot. A separate guest context now
  exercises signup. The harness explicitly seeds and checks the real language
  and appearance keys rather than assuming query parameters configure them.

## Evidence and reproduction

All raw evidence is Git-ignored under `.local/`:

- `core-release-check.log`, `core-release-tests-final.log`, `core-release-focused.log`
- `core-release-strict-tsc.log`, `core-release-build-{firebase,legacy}.log`
- `core-release-sql.log`
- `core-release-browser.log`, `core-release-browser/results.json`
- `core-release-account-browser.log`, `m4-browser/results.json`
- `core-release-settings-browser.log`, `settings-browser/results.json`
- `core-release-browser/{registration,access}-{1440,390}-{en,ar}-{light,dark}.png`

`npm run check` runs the application, architecture, TypeScript and lint suites.
Focused tests: `node --test scripts/signup-recovery.test.cjs
scripts/firebase-auth.test.cjs scripts/student-administration.test.cjs`.
The new browser runner is `node scripts/student-access-browser.cjs` with
`LMS_BROWSER_RUNTIME`, `LMS_ESBUILD_RUNTIME` and optionally
`LMS_CHROMIUM_EXECUTABLE` pointing to existing local tools. It requires the
existing Firebase-mode font/CSS build at `.local/settings-build-firebase`.
It writes only to `.local/core-release-browser` and blocks outbound browser requests.

The established native PostgreSQL wrapper `.local/session4-sql.cjs` starts only
its previously stopped loopback cluster, runs `scripts/exam-sql-local.cjs
--postgres`, restores its local port file and stops its cluster. The harness
creates and drops its own randomized disposable database. Never point these SQL
mutation suites at connected Supabase. Current completion logs confirm rollback,
owned database disposal and cluster shutdown. Browser contexts and owned HTTP
servers were closed; synthetic local screenshots/state remain ignored.

## Live-provider acceptance — NOT EXECUTED; authorization required

Real verification-email delivery, real link consumption, Google/Apple provider
configuration/redirects and current throttle status are **unknown**, not failed
today. Old reports cannot resolve them. Admin-marking an account verified would
not test them and is expressly excluded from the following procedure.

Proposed controlled procedure, to be explicitly authorized before any writes:

1. Target Firebase `diagonproduction` and Supabase `gmvouqgjbtbkbhrdruzu` only
   after rechecking the active configuration and owner confirmation that these
   are still the intended development resources. Run this exact candidate on
   an approved HTTPS staging origin, or an explicitly approved isolated local
   HTTPS server. Match `APP_ORIGIN` exactly and rebuild Firebase public flags.
   Do not change billing, quotas, domains, provider/email settings or DNS.
2. Obtain one owner-controlled disposable student inbox (not `example.invalid`)
   and its verification-link handoff method. Use an existing specifically
   authorized test teacher, or approve one synthetic teacher plus one isolated
   tenant/course/offering with exact initial ownership and cleanup manifest.
   A second controlled test identity is needed for real recipient/tenant denial.
   Keep passwords, tokens, link secrets and browser state in protected ignored
   evidence only. Confirm the known profile mappings; never link by email.
3. Capture sanitized baseline identifiers, row counts/fingerprints and migration
   history. Establish exact per-resource cleanup before creation. Create only
   manifest-owned fixtures through existing trusted provisioning and ordinary
   verified onboarding; do not insert fabricated identity mappings.
4. Open the teacher-provided link in a clean student context, register once,
   confirm unverified denial, request one verification email, inspect inbox/spam,
   consume its actual action link, reload verification and complete onboarding.
   Record provider status separately from inbox delivery. Respect retry timing;
   never generate repeated mail bursts or Admin-mark the student verified.
5. Sign in later with the same account and restore its session. Test recovery
   after delivery failure using that account, not a new signup. A controlled
   synthetic send failure remains different from an actual provider failure.
   Verify safe continuation, request/pending state, teacher approval, enrollment
   notification and actual published lesson access. Also test rejection, duplicate
   actions, bound invitation theft/expiry/revocation, capacity and peer/tenant denial.
6. Suspend and expire only manifest-owned enrollment, verify direct lesson/media
   and RPC denial, preserved history, and accurate access status. After logout,
   test protected direct URLs, reload/Back behavior and rejection of retained old
   tokens. Check desktop/mobile and both language/theme preferences. Use ordinary
   teacher flows as they stand; no teacher redesign or provider bypass.
7. Stop sessions/processes; revoke owned Firebase sessions; remove only manifest
   fixtures in dependency order and delete the exact created Firebase accounts.
   Preserve immutable audit metadata if deletion is intentionally prohibited and
   report it. Verify pre-existing data/schema/history unchanged. Do not delete
   records by test-like names. No upload is needed for this slice.

Expected side effects: Firebase account/authentication/email/audit/quota usage;
one or a few controlled inbox messages; mapped synthetic profiles; isolated
organization/ownership and academic fixtures if approved; request/enrollment/
notification/revocation/audit records. Provider audit logs/counters cannot be
restored byte-for-byte. Any protected audit residue must be disclosed.

The real-provider gate is a release blocker, but a current Firebase outage has
not been demonstrated. Hosting, authorized provider methods, actual email delivery,
HTTPS cookies and live token/RLS integration must be verified on the pilot origin.
Full Arabic auth/access copy and additional physical-device/browser coverage are
separate enhancements unless the owner makes them mandatory pilot requirements.

## Exact changed-file inventory

1. `frontend/lib/firebase.ts` — transient persistence restoration retry.
2. `frontend/features/admin/users/student-access.tsx` — student-only loading,
   retry, status freshness, stale-result and duplicate-action handling.
3. `scripts/signup-recovery.test.cjs` — account recovery and initialization regressions.
4. `scripts/student-administration.test.cjs` — actual join-page routing regressions.
5. `scripts/student-access-browser.cjs` — new isolated component workflow runner.
6. `scripts/account-browser-components.cjs` — missing synthetic navigation export.
7. `supabase/tests/student-administration.sql` — four invitation-boundary assertions;
   no migration, schema, grant, policy or production function change.
8. `docs/core-release-1-registration-class-access.md` — this report and live acceptance procedure.

All prior committed Continue Learning, Settings, Notifications, academic-stage,
teacher, Exams, Homework, Groups and account-security implementations remain.
No commit, staging, push, merge, deployment or connected-service mutation occurred.
