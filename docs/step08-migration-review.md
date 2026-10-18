# Step 08 — implementation and development validation

Date: October 16, 2026 (Africa/Cairo). Teacher trial: Sunday, October 18.

**Status: migration 25 applied to development and academic/admin acceptance completed; Firebase verification-link consumption is blocked by provider throttling.** This report accompanies the isolated Step 08 PR. No merge, deployment, production/configuration change or main change occurred. The teacher trial is not declared ready until the email/configuration gates below pass.

## Verified starting point

- Repository remote: `https://github.com/EduLabs-LMS/EduLabs-LMS.git`.
- Fetched `collab/v2-integrated-ui`: `d0f5aff793c9101703faf3f698f456cbd25dabd6` (merged Step 07).
- Isolated branch: `codex/step08-student-admin-launch-readiness`.
- Worktree: `C:\dev\EduLabs-LMS\.local\worktrees\step08`.
- Development project: `gmvouqgjbtbkbhrdruzu`, healthy, PostgreSQL 17.11.
- Preflight: exactly 24 applied migrations matched local history; Step 08 objects were absent, public RLS enabled, and both organization-creation functions unavailable to authenticated users. Final state: exactly 25 migrations, with versions 1–24 unchanged and the same provisioning restrictions.
- Original checkout and Step 07 worktree are preserved. Local main remains `b2ca8d180c5d4bf984986850272ed8d8de916f34`.

## Approved migration and applied identifier

Applied file: **`supabase/migrations/20261016053117_student_administration_workflows.sql`**. The approved input was named `20261016040437_student_administration_workflows.sql`; MCP recorded version `20261016053117`, so the file was renamed without changing its approved bytes.

SHA-256: **`1BB6F23C321DE94DBFE8473DC28979A4083402F6A4D72CB6CF22A2241A014BF3`**.

The complete file is the review artifact; this report is not a substitute. Supabase CLI created the migration filename. `.gitattributes` preserves its exact approved bytes across platforms. The applied timestamp is reflected in Git as in earlier deliveries.

### Schema and permission effects

Five additive tables:

1. `public.enrollment_requests`: UUID identity, offering/user foreign keys and unique pair, pending/approved/rejected state, optimistic version, reviewer/reason/timestamps. RLS permits own requests or existing offering-support scope. Authenticated users have SELECT only; there is no direct request write grant.
2. `private.student_access_links`: UUID identity, offering, issuer, kind, recipient binding for invitations, SHA-256 token hash, expiry, optional enrollment expiry, revocation and claim state. Raw tokens are not stored. A request link is reusable but grants nothing; an invitation requires both its secret and its explicitly bound verified profile.
3. `private.enrollment_admin_versions`: lazy per-enrollment version counters, keyed by enrollment UUID. Future enrollment UPDATEs increment the counter, including writes through pre-existing authorized paths. Existing rows are not backfilled or modified on installation.
4. `private.student_admin_audit`: actor, offering, subject, action and immutable-to-application before/after evidence. No token, email or password in audit output.
5. `private.student_admin_commands`: actor/request UUID idempotency records, payload fingerprint and non-secret result. Changed payload reuse is rejected; retries do not duplicate grants.

All five tables have RLS. The four private tables are default-deny with all client/service table grants revoked. One new public SECURITY INVOKER RPC, `student_administration`, and its private implementation are executable only by authenticated users (and database owner); anonymous/service execution is revoked. Internal issuer/version helpers have no client EXECUTE grants. All new private definer functions use fixed empty search paths and qualified references. Public request timestamps reuse the existing `private.touch_updated_at` trigger.

No existing function definition, policy or grant is replaced. No organization/membership provisioning is exposed. Existing contextual `can_manage_offering`, `can_support_offering`, current-identity and homework-grading helpers are reused. Assigned teaching assistants can view their offering's roster/requests; only an existing authorized manager can approve, invite, enroll, suspend or reactivate. Support-operator status adds no academic privilege.

**Expected installation effect on existing data: zero existing academic/identity rows changed, zero enrollments/approvals/notifications created, no Storage bucket/object changes.** Only future operations produce new requests, audit/version records and normal Step 07 enrollment notifications. Existing Exams/Lessons/Homework/Groups/Support history and migrations 1–24 remain intact.

## Implemented workflows

- Firebase signup collects a full name and retains verified-email/session enforcement. An exact internal `/join/<token>` or `/access` continuation survives switching between signup/sign-in. Arbitrary/external/admin continuations are rejected; registration itself grants no academic access.
- A teacher creates a seven-day request link for an offering. Its verified student holder sees only the intended organization/offering descriptor, submits one pending request and can review status/reason in My requests. Repeating a request does not reset a rejection or create duplicates.
- A teacher approves/rejects actual pending rows. Approval inserts the correct unique offering enrollment and lets the existing Step 07 trigger emit learning-access approval. Rejections never grant access. Stale versions fail with 409.
- Authorized single-use invitations bind a verified profile UUID plus a cryptographically random 256-bit secret. The student can copy their own UUID from My requests. The teacher never searches or links accounts solely by email. Another verified account cannot inspect/claim a forwarded invitation, even before its intended recipient accepts. Failed capacity grants do not consume it.
- Existing students of that organization may be enrolled in an additional offering by exact profile UUID. Unknown/foreign records require a request or bound invitation first. Existing suspended/expired access is never silently overwritten by another approval/invitation; it needs explicit reactivation.
- `/admin/users` has a Firebase/Supabase adapter with offering pagination, real roster and pending queues, name search, status filters, versioned actions, private invitation creation/revocation and link-history pagination. Existing Clerk admin implementation remains the fallback. Group assignment uses the unchanged Step 06 Groups & Attendance interface.
- Suspension changes only that offering enrollment. It preserves enrollment UUID, historical submissions/progress and attendance intervals. Reactivation deliberately chooses a new expiry (blank = no expiry). Old group membership intervals remain history; reassign through Groups when appropriate.
- Dashboard counts are database-authoritative: distinct currently eligible students, actual pending requests, submitted homework still under correction and real active `study_groups`. They are scoped to the caller and optional authorized organization. Graded-but-not-released homework is not falsely counted as ungraded. Counts do not depend on truncated frontend arrays.
- Active Groups links to Groups, activity placeholders now point to functioning queues, and student exam summaries link to actual exam/quiz pages while excluding homework/practice. Existing V2 styling/components/animations are retained.

## Concurrency and authorization

Mutations serialize per actor and lock the offering before enrollments, matching existing capacity/group triggers. Current course, organization, profile, membership and assignment state is rechecked while relevant rows are locked. Membership-before-organization ordering respects the existing last-owner trigger. A grant cannot use stale offering state or a revoked issuer/manager after a lock wait. Different competing approvals allow one grant and reject the stale request; same-request retries return the original result. Recipient-bound invitation retries preserve one enrollment.

Teacher and student command rates are bounded. Inputs, dates, UUIDs, request/link type, token length, pagination and text lengths are checked at HTTP and SQL boundaries. HTTP requires a verified Firebase viewer, exact origin, JSON and a bounded body; it uses only the caller-scoped publishable-key Supabase client. Browser code receives no privileged key. Join responses use no-store/no-referrer; share links remain sensitive and should not be pasted into logs/reports.

## Actual local verification

### Final reactivation correction (October 16)

Only the pending migration's reactivation eligibility predicate changed: it now explicitly rejects `ends_at <= clock_timestamp()` and requires an active organization, in addition to the existing active offering, published course, active target profile and valid enrollment-expiry checks. It runs after the existing offering/course/profile/membership/organization locks and authorization recheck. No grants, locks, suspension behavior, existing helper definitions or migrations 1–24 changed. NULL expiry still explicitly means unlimited; a future expiry remains supported. A suspended or archived organization normally fails the existing manager authorization first (42501); an ended offering fails the reactivation validation (23514). HTTP preserves these as 403 and 400, and stale writes remain 409.

SQL tests now populate homework, exam, progress and attendance records and compare their exact rows before suspension, during suspension and after reactivation. Failed reactivations leave the enrollment and version unchanged. Two independent-session races change the offering end or organization status while reactivation waits, then verify denial and the persisted suspended state/version. Application tests cover NULL/future expiry forwarding with the optimistic version, invalid date rejection and database error handling without leaking database details.

**Existing access policy retained:** read-only inspection of the live development `private.is_enrolled(uuid)` confirms it checks enrollment expiry/status, active profile/organization/offering and published course, but contains no `course_offerings.ends_at` predicate in its current definition. There is no evidence here establishing the original product intent; the established behavior allows continued learning under an active, unexpired enrollment after the delivery end. A characterization regression preserves that behavior. Preventing a new/reactivated grant after an offering ends is separate from revoking an existing grant. Adding a cutoff to this shared helper would affect Lessons, Exams, Homework, private media and other dependent authorization paths, potentially removing review/completion access. That broader policy change requires explicit owner approval and is **not included**.

The previous checksum `1B849FC05CD596E41FB74D0A854E27087F21460A23E83591648EDC11C7383243` is superseded and was never applied. At that correction checkpoint, development still had 24 migrations and no browser acceptance had run. The owner subsequently approved the exact revised checksum; development application and actual acceptance are recorded below.

| Check | Result |
| --- | --- |
| Application tests | **193 passed**, no failures |
| TypeScript, lint, architecture boundaries | Passed; seven existing lint warnings |
| SQL upgrade replay | **15 rollback suites / 892 assertions**, including **76** administration assertions |
| Fresh-install replay | Same 15 suites passed |
| Native independent-session concurrency | **73 cases**, including **14** administration cases |
| Existing data/schema preservation during migration replay | **65 existing local tables' rows/RLS/grants, 187 function definitions/grants and 107 policies unchanged** |
| Production builds | Firebase/Supabase and Clerk/legacy passed with isolated outputs |
| Development SQL | All **15 rollback suites / 892 assertions** passed against the applied schema |
| Remote final state | Exactly **25** migrations; existing data/functions/policies/grants preserved after scoped cleanup |

New regressions cover registration without access, request/link authorization, recipient secrecy, forwarded invitation denial, request/approval idempotency, actual distinct metrics, real homework correction counts, real study groups, pagination/search, assistant restrictions, tenant denial, rejection, suspension/reactivation, exact progress preservation, expiry, capacity rollback, staff revocation and unchanged manual organization provisioning. Races cover duplicate approval, competing different approvals, stale suspension, concurrent invitation acceptance, unintended claimant denial and issuer/owner revocation while blocked. Existing Firebase, Exams, Lessons, Homework, Groups, Notifications and Support suites still pass.

Native SQL fixtures live only in randomized disposable loopback databases; suites roll back and the harness drops its owned databases. They simulate claims for SQL authorization and **are not real Firebase browser acceptance**. These local tests were followed by manifest-owned development fixtures and real Firebase browser testing, documented below. Build processes read existing environment configuration without copying secret files or changing production configuration. Evidence is Git-ignored under `.local/step08/`.

## Approved acceptance plan (historical plan; actual outcomes below)

1. Reverify the exact project, 24-entry history, file checksum and object absence. Capture schema/grant/function/policy and existing-row fingerprints. Apply only this approved SQL, verify 25 migrations and expected privileges/preservation, regenerate/check types and run advisors plus SQL suites.
2. Create manifest-owned synthetic Firebase student/teacher/assistant/owner/support identities. Use actual signup and normal verified onboarding; generate a synthetic verification action link where necessary rather than editing identity mappings. Test verification-code consumption; do not claim real inbox deliverability from a synthetic email test.
3. Trusted fixture provisioning atomically creates two isolated tenants and owners. Assign a contextual instructor and assistant using existing memberships/staff tables; the instructor must not be an owner for assignment-revocation tests. No real teacher/student record changes.
4. Chromium workflow: signup/unverified denial → verified email → request link → pending queue/metric → teacher approval → actual enrollment/notification → group assignment → published lesson/progress → exam submission/results → homework submission/correction/counts → notifications/preferences → private support/replies. Test ordinary V2 navigation and direct URLs.
5. Test second-recipient invitation theft, link expiry/revocation, rejection, duplicate requests, same/different-request double approval, stale enrollment writes, suspension, preserved academic history, reactivation/reassignment, other-tenant denial, assistant restrictions and staff/profile revocation through real Firebase-token REST/RPC calls.
6. Test desktop/mobile layouts and actual error/loading states. Capture screenshots and results; keep all tokens, passwords and browser state ignored. Only exact synthetic fixtures may be removed. Delete Storage objects through the Storage API if any were deliberately created; never delete Storage metadata directly.
7. Revoke synthetic Firebase sessions, guard cleanup by exact UUIDs/tenant slugs/verified mappings, remove only owned records in FK order, delete exact synthetic identities and compare existing-row fingerprints. Repeat final checks/builds, then commit/push the isolated branch and open the PR to `collab/v2-integrated-ui`. No automatic merge.

## Trial decisions and limits

Migration application was approved and completed; actual results and the outstanding verification-email gate are below. This is not a claim that the teacher trial is ready to deploy. See `docs/trial-operations.md` for trusted teacher/operator provisioning and configuration checks. Real owner/operator identities, trial hosting/configuration and any production migrations require separate permission. Existing Web Push/scheduled-worker setup, email delivery verification, video privacy constraints and baseline dependency advisories are not silently resolved by Step 08.

Recovery must preserve history: stop exposing new operations or review revoking the new RPC if necessary, and use a reviewed forward correction. Do not drop request/audit tables, delete enrollments, restore organization-creation grants or reset existing records automatically.

## Development application and real acceptance (October 16)

- Target: `gmvouqgjbtbkbhrdruzu`, PostgreSQL 17.11, healthy. Approved checksum matched immediately before application. All 187 pre-existing function definitions/grants and 107 policies matched a clean replay of migrations 1–24; there was no unexpected drift. Step 08 objects were absent.
- Applied only `20261016053117_student_administration_workflows` through Supabase MCP. Captured fingerprints/RLS/grants for 97 existing tables, 187 functions and 107 policies before application. Immediate and final comparisons found **zero differences** to existing data or authorization. Exactly five tables, four functions and one policy were added. All new tables have RLS, private tables remain default-deny, public RPC is authenticated-only and service/anonymous EXECUTE is denied. Existing organization creator restrictions and `private.is_enrolled` definition remain unchanged.
- Generated current development TypeScript types through MCP; regenerated the application enrollment-request contract from the same replayed schema. Preserved the existing nullable RPC contract and unrelated contracts.
- Real **Chromium** sessions were used for a UI-registered student plus four disposable Firebase identities (contextual instructor, assigned assistant, tenant-B owner/peer and trusted tenant-A owner). All mappings went through the normal verified Firebase provisioning/session flow. Two UUID-scoped synthetic tenants were provisioned atomically with their initial owners. No fake identity mapping was inserted, and no privileged credential reached the browser.
- Actual signup created an unverified account and its student-administration call returned 401. **Verification-link generation failed:** Firebase HTTP 400 `TOO_MANY_ATTEMPTS_TRY_LATER`, wrapped by Admin SDK as `auth/internal-error`, including an explicit localhost continuation. The exact synthetic account alone was Admin-marked verified to continue testing. **Verification-code consumption and real inbox delivery did not pass and remain a trial gate.** No production/provider configuration was changed.
- 28 recorded browser/API check groups cover UI request link → pending request → teacher approval → unique enrollment/notification → roster/search → rejection and unchanged repeated decision; assistant read-only management; cross-tenant queues/course access; unauthorized direct table writes and provisioning; real lesson completion/progress; ExamRunner start/resume/submit/release and forbidden retry; MCQ and written homework submission, solutions, grading/release and actual to-grade count; recurring groups, stable schedule IDs and joining information; support creation/replies/deadlines/status; notification counts/preferences/deep links; UI suspension/reactivation, preserved homework/exam/progress, expired access, future/unlimited expiry, stale writes, live instructor revocation, recipient-bound/idempotent invitations, session restore and logout (cookie removed, API 401).
- Desktop/mobile screenshots and no-overflow checks cover the real roster/dashboard and student Self Learning, Exams, Groups, Notifications, Support and My requests. Evidence is ignored under `.local/step08/acceptance/`. Principal screenshots: `teacher-roster-desktop.png`, `teacher-roster-mobile.png`, `teacher-dashboard-desktop.png`, `teacher-dashboard-mobile.png`, and `student-*-mobile-final.png`. No UI redesign, production bypass or local preview authentication was used.
- Harness corrections: a protected wildcard attempt SELECT correctly returned 403; the test now uses the safe participation RPC. A synthetic expiry initially violated the existing expiry-after-enrollment CHECK; fixture dates were corrected. Roster selectors now account for the displayed UUID suffix, and logout expects middleware's actual /sign-in redirect. These were test assumptions, not application bugs; failed runs remain in ignored evidence. No application correction was necessary during acceptance.
- Exact cleanup was guard-checked in a rollback first. Revoked sessions, removed only the two manifest-owned tenants and dependent academic/admin/communications fixtures, then deleted/verified all five synthetic Firebase identities. Post-cleanup comparison against the immediate post-migration baseline found **zero differences across all 102 tables, 191 functions and 108 policies**, including data fingerprints and privileges. No Storage objects were created or removed; Storage metadata was never deleted directly. No test accounts or academic fixtures remain.

### Security advisors and trial limitations

Security advisors reported intentional private default-deny RLS/no-policy informational notices and the existing Supabase Auth leaked-password warning (Firebase is the application's primary identity provider). Performance advisors reported the pre-existing Groups composite-FK index notice and unused-index notices, including new indexes on empty administration tables; no new high-severity finding or missing public RLS was found. No unrelated grants/indexes/configuration were changed merely to silence these findings. Remediation references: [private RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [FK index](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

**Sunday trial gate:** clear/verify Firebase verification-email throttling and test real delivery on the intended trial domain. Separately authorize hosting/production rollout and trusted real teacher/owner/cohort provisioning. Scheduled reminder execution and VAPID/device push remain unconfigured/unvalidated; transaction-generated in-app notices work. This slice does not repeat media upload/DRM, physical-device, cross-browser or load testing, or remediate prior dependency advisories. See `docs/trial-operations.md` for the complete operational checklist. The PR is a review checkpoint, not deployment approval.

## Changed files (28)

- `.gitattributes`
- `app/(dashboard)/(routes)/admin/users/page.tsx`
- `app/(dashboard)/_components/website-pages.tsx`
- `frontend/features/auth/firebase-form.tsx`
- `frontend/features/dashboard/admin-home.tsx`
- `middleware.ts`
- `package.json`
- `scripts/exam-sql-local.cjs`
- `scripts/firebase-auth.test.cjs`
- `scripts/student-portal.test.cjs`
- `scripts/website.test.cjs`
- `shared/contracts/database.types.ts`
- `shared/website-routes.ts`
- `app/(dashboard)/(routes)/access/page.tsx`
- `app/api/student-administration/route.ts`
- `app/join/[token]/page.tsx`
- `docs/step08-migration-review.md`
- `docs/trial-operations.md`
- `frontend/features/admin/users/student-access.tsx`
- `frontend/features/admin/users/supabase-student-admin.tsx`
- `frontend/lib/student-administration.ts`
- `scripts/student-administration-concurrency.cjs`
- `scripts/student-administration.test.cjs`
- `server/http/student-administration.ts`
- `server/services/student-administration.ts`
- `shared/contracts/student-administration.ts`
- `supabase/migrations/20261016053117_student_administration_workflows.sql`
- `supabase/tests/student-administration.sql`
