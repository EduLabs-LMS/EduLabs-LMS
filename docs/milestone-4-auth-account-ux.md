# Milestone 4 — Authentication, onboarding and account management

Date: 2026-10-18. Branch: `codex/milestone4-auth-account-ux`.
Base: `aafb434b77a00d67650550d75d21e9ef74476878` (`collab/v2-integrated-ui`).

## Delivery and readiness

Implemented locally, with application, native PostgreSQL and browser-component validation passing. This is a draft integration candidate, not a claim of connected-provider acceptance or production readiness. The account migration is **local and unapplied**. No Firebase/provider settings, connected database, infrastructure or other PR branches were modified.

Separate checkpoints:

- 4A: `d96f4dca0b726203e8fe4e030178aa84d90c3750` — V2 authentication and safe signup recovery.
- 4B: `11ca9b83b1430e7a71003bc0904e73e5bb1e06ad` — private avatars and persistent onboarding.
- 4C: `47b83d616eb4f9e910c7a22e37b55c47ab9cd9af` — account-management dialog.
- 4D: the commit containing this report — regression coverage, acceptance evidence and final hardening.

## Implemented functionality

### 4A — Authentication

Responsive V2 login and registration retain the animated tree, established wordmark/fonts, green/cream/black palette and border/shadow treatment. Login supports password visibility, forgot password, Google and a clearly gated Apple entry. Registration provides separate names, optional photo preview/replacement/removal and password confirmation. Loading and errors remain visible. A failed verification email never causes a second account creation; resend is throttled and recoverable.

The reviewed PR #9 `signup-recovery.ts` was reused byte-for-byte. Redirect-result processing precedes restored-session navigation, preserving first-login provider drafts. Existing safe next-destination rules and Firebase server-session synchronization are retained.

### 4B — Profile persistence and private photos

Names and onboarding completion persist through an owner-scoped account RPC. First Google/Apple login requests confirmation; missing Apple names/photos use manual entry. Completed users are not repeatedly interrupted. Interrupted signup/provider drafts are UID-scoped in IndexedDB, expire after 24 hours, and contain no passwords or tokens.

PNG/JPEG/WebP input is limited to 3 MB and fully decoded server-side with a 16-megapixel limit. Sharp normalizes to a metadata-free 512-pixel WebP, at most 1 MB. Assets have immutable owner paths in a private bucket. Exact upload attestations bind asset ID, bytes, digest and a short issuance window to the verified caller. Attestation credentials stay server-side and are not persisted as user claims.

An optional provider image is fetched only from the verified Admin user record, over HTTPS to the Google image-host allowlist, without redirects/userinfo/custom ports and with timeout/size bounds. Other images require explicit upload. No arbitrary client-supplied server fetch is allowed.

Replacement/removal retires the old asset before owner-authorized Storage cleanup. The ledger is pruned only after the object is confirmed absent. Missing-photo failures do not prevent editing names or removing the broken photo. Read URLs expire after 90 seconds; the bridge refreshes at 60 seconds. Cleanup failures have explicit recovery controls. Abandoned pending assets become eligible after one hour; there is no global scheduled janitor in this slice. The per-account reservation bound is ten assets.

### 4C — Account management

The shared account trigger opens a responsive Radix dialog with dimmed/blurred backdrop, keyboard focus containment and opener-focus restoration. It supports names, photo replacement/removal, linked sign-in methods, verified email-change requests, password changes for password-linked accounts and explicit logout. Sensitive operations require supported Firebase reauthentication. OAuth-only users are not offered misleading password controls.

Email changes use `verifyBeforeUpdateEmail`; pending addresses never become trusted application identity mappings. Password changes use Firebase SDK reauthentication and refresh existing server synchronization. Logout retains existing revocation behavior and reports incomplete server revocation. No Supabase password field is edited.

An editor retains its original revision during background photo refresh; stale edits return 409 rather than silently overwrite another tab. Profile changes do not alter organization membership, staff roles, academic enrollment or tenant boundaries. The Clerk fallback remains available.

## Local migration and database boundary

File: `supabase/migrations/20261018104040_account_profiles_private_avatars.sql`.

SHA-256: `60DD7B134954229D4BE0EDC0A4884511D0C5947EAD92D0E21B7B4E3B4E9AB7B4`.

The file has canonical LF bytes protected by an exact `.gitattributes` rule. All 25 baseline migration Git blobs are unchanged; this branch has 26 local migration files. No connected migration history was changed or remotely verified for this milestone. Unmerged PR #11/#12 migrations remain on their separate branches.

Additions:

- `public.account_profiles`: owner-only SELECT RLS; no direct authenticated writes; durable names, avatar reference, completion and revision.
- `private.account_avatar_assets`: private owner ledger, with RLS and no direct authenticated table access. A composite foreign key prevents cross-owner avatar references.
- Private `lms-avatars` bucket: WebP-only, 1 MB maximum; owner read, attested insert and retired-object delete; no overwrite policy.
- Private helpers for exact-upload capabilities, Storage access and serialized account commands; fixed empty search paths and explicit object references.
- Public invoker `account_profile` RPC: authenticated only, caller identity derived server-side; action/data validation and current identity revalidation after lock waits.

Existing academic tables, functions, grants and policies are not replaced. Local preservation assertions compare 70 pre-existing table/data/grant baselines, 191 function definitions/grants and 108 policies. The deliberate new bucket is excluded from unchanged-data comparison. Existing profile display names change only when their owner submits an account save.

**Owner approval is required before applying this migration to a connected project.** Application database types describe the local schema; they were not regenerated from an unapplied remote schema.

## Executed verification

| Check | Actual result |
| --- | --- |
| `npm run check` | 210/210 tests; architecture and TypeScript passed; lint has zero errors, 10 warnings |
| Native PostgreSQL replay | All 26 local migrations replayed, including existing upgrade preservation fixture |
| SQL regressions | All 16 suites passed; new account suite has 36 assertions |
| Independent-session concurrency | 77 cases passed, including four account races |
| Firebase/Supabase-mode production build | Passed |
| Clerk/legacy-mode production build | Passed |
| Chromium component acceptance | Passed at desktop 1440 and mobile 390 widths |
| Git whitespace/security/migration audit | Passed; baseline files and preserved branch refs checked |

The four account races cover simultaneous initialization, stale saves, remove versus stale upload reservation and identity revocation during lock waits. Local SQL tests cover direct/forged access, ownership, Storage policy capabilities and lifecycle, RPC privileges and stale revisions. Storage metadata manipulation in the disposable SQL bootstrap simulates Storage API behavior only; application code does not delete Storage metadata with SQL.

Browser acceptance bundles the actual form, account dialog and onboarding bridge, real styles and local fonts. **Firebase SDK and HTTP transports are fictional component fixtures; all nonlocal requests are blocked.** It covers password confirmation/visibility, single-create verification recovery, resend throttling, provider SDK contracts, profile/photo persistence contracts, verified email and password security ordering, onboarding refresh behavior, focus, scrolling and overflow. No browser JavaScript exceptions occurred.

Lint warnings comprise seven existing warnings and three native-image warnings for blob/private signed avatars. Native images deliberately avoid routing short-lived private URLs and local blobs through the shared image optimizer. Existing Tailwind ambiguity warnings remain in builds.

Reproduction:

```powershell
npm run check
npm run test:exam-sql:postgres
node scripts/account-browser-components.cjs
npm run build
```

The SQL harness requires its native PostgreSQL/runtime prerequisites; the component runner requires Playwright/esbuild (it accepts `LMS_BROWSER_RUNTIME`). This run used existing ignored dependency runtimes. Both build modes ran through an ignored launcher setting the existing documented backend selectors and isolated output directories; no environment files were copied into evidence or committed.

## Screenshots

These are actual component renders with clearly synthetic data, not evidence of connected authentication:

- [Login desktop](evidence/milestone4/login-1440.png) / [mobile](evidence/milestone4/login-390.png).
- [Signup desktop](evidence/milestone4/register-1440.png) / [mobile](evidence/milestone4/register-390.png).
- [Account desktop](evidence/milestone4/account-1440.png) / [mobile](evidence/milestone4/account-390.png).
- [Account security desktop](evidence/milestone4/account-security-1440.png) / [mobile](evidence/milestone4/account-security-390.png).
- [Apple manual onboarding](evidence/milestone4/apple-onboarding-390.png).
- [Google onboarding](evidence/milestone4/google-onboarding-390.png).

## Remaining gates and limitations

Not tested: real email delivery/verification links; actual Google/Apple accounts; connected Firebase/Supabase sessions and real Storage upload/read/delete; Firefox/WebKit; production infrastructure and load. No remote test identities or objects were created. These are acceptance gates, not passes inferred from SDK fixtures.

Apple is disabled by default (`NEXT_PUBLIC_FIREBASE_APPLE_ENABLED=false`). Activation requires a configured Apple Developer team/App ID and web Services ID, authorized domains and the exact Firebase return URL from the provider console, plus team ID/key ID/private key entered securely in provider configuration. Register Firebase sender domains for Apple's private email relay where applicable. Enable the Firebase provider, perform controlled real-provider testing, then enable the public build flag. No Apple keys belong in application/client configuration. See [Firebase Apple authentication](https://firebase.google.com/docs/auth/web/apple) and [Firebase account updates](https://firebase.google.com/docs/auth/web/manage-users).

Migration approval and connected owner-only Storage acceptance are needed before calling account persistence development-ready. Existing configured server Firebase credentials remain required for trusted attestations; none are added to browser code or this report. Eventual maintenance may add an explicitly reviewed abandoned-asset janitor; current owner cleanup controls and bounds are documented above.

## Preservation and cleanup

The disposable local PostgreSQL cluster was stopped and all run-owned databases dropped: zero owned databases remain. Browser contexts and test server closed. Zero remote fixtures were created. Ignored local builds/runtime/evidence remain available for inspection; raw manifests and runtime configuration are excluded from Git. No remote records, provider configuration or infrastructure were changed.

Local main remains `b2ca8d180c5d4bf984986850272ed8d8de916f34`. PR #9/#10/#11/#12 local branch heads were checked unchanged. No merge, retargeting or manual deployment occurred.

## Integration overlaps

PR #9 overlaps `.gitattributes`, `firebase-form.tsx`, `signup-recovery.ts`, `package.json` and `firebase-auth.test.cjs`. Its reviewed recovery file is identical (Git blob `e2b0dfe884d800606ec833e2880b75f6a8469feb`); reconcile the form around this preserved recovery behavior rather than reintroducing duplicate signup. Infrastructure work was not imported.

PR #10-only changes overlap `package.json`. Its sidebar badge/wordmark/notification changes must be retained alongside the shared account trigger; no sidebar/logo source was edited here. PR #11/#12 types, test harness/script lists and migration attributes need additive reconciliation at integration time. Their migrations were not imported, renumbered or modified.

## Changed files

The final changed-file inventory is generated below from the base comparison and includes only source, tests, the pending SQL migration and sanitized evidence. No `.env` secrets, private keys, tokens, raw browser sessions or local runtime artifacts are included.

- .env.example
- .gitattributes
- app/(auth)/layout.tsx
- app/api/auth/firebase/account/route.ts
- app/api/auth/firebase/avatar/route.ts
- docs/evidence/milestone4/account-1440.png
- docs/evidence/milestone4/account-390.png
- docs/evidence/milestone4/account-security-1440.png
- docs/evidence/milestone4/account-security-390.png
- docs/evidence/milestone4/apple-onboarding-390.png
- docs/evidence/milestone4/google-onboarding-390.png
- docs/evidence/milestone4/login-1440.png
- docs/evidence/milestone4/login-390.png
- docs/evidence/milestone4/register-1440.png
- docs/evidence/milestone4/register-390.png
- docs/milestone-4-auth-account-ux.md
- frontend/components/providers/application-auth-provider.tsx
- frontend/components/providers/v2-identity.tsx
- frontend/features/auth/account-dialog.tsx
- frontend/features/auth/account-security.tsx
- frontend/features/auth/avatar-picker.tsx
- frontend/features/auth/firebase-account-bridge.tsx
- frontend/features/auth/firebase-account.tsx
- frontend/features/auth/firebase-form.tsx
- frontend/features/auth/provider-icons.tsx
- frontend/lib/account-draft.ts
- frontend/lib/account-security.ts
- frontend/lib/account.ts
- frontend/lib/signup-recovery.ts
- package.json
- scripts/account-browser-components.cjs
- scripts/account-concurrency.cjs
- scripts/account.test.cjs
- scripts/exam-sql-local.cjs
- scripts/firebase-auth.test.cjs
- server/http/account.ts
- server/services/account.ts
- shared/contracts/account.ts
- shared/contracts/database.types.ts
- supabase/migrations/20261018104040_account_profiles_private_avatars.sql
- supabase/tests/account-profiles.sql
