# Original LMS website integration — Phase 1

Implementation report, 10 October 2026. Branch: `codex/restore-lms-phase1`,
based on Firebase integration commit `8862c5e`. This report covers the local Phase 1
implementation; no push, deployment or production configuration switch was performed.

## Completed and active in Firebase staging

Firebase staging now uses the original dashboard shell, desktop/mobile sidebar,
footer, student dashboard, teacher overview, course cards and staff roster
presentation. The original color, typography and layout classes are retained.
Provider-specific authentication is separated from presentation. `/lms-staging`
redirects to `/home`; successful Firebase sign-in also goes to `/home`.

The new read adapter does not call Prisma or Clerk-authorized legacy APIs in
Firebase mode. Default Clerk/Prisma branches remain available. No dependencies,
lockfile, deployment configuration, local environment files or production flags
were changed for this phase.

| Working page | Supabase tables used through the website repository |
| --- | --- |
| `/home`, `/dashboard`, `/` | Authorized courses, offerings, own enrollments, published modules/lessons, own lesson progress, published assessment schedules/titles; contextual staff enrollment counts |
| `/self-learning`, `/search` | `courses`, `course_modules`, `course_offerings`, authorized organization names; bounded database title search and pagination |
| `/teacher/courses` | Same course list, filtered to contextual course/offering staff permissions; inspection only |
| `/courses/[courseId]`, `/courses/[courseId]/detail` | Course description, modules and published lessons, accessible offerings, own progress for an explicitly selected offering, assessment schedules |
| `/group`, `/groups` | Authorized offerings and the signed-in user's own enrollment statuses |
| `/offerings/[offeringId]` | Student's own enrollment, or authorized staff roster with display names and enrollment statuses; 50-row pagination and exact count |

All pages additionally resolve the verified identity through `current_profile_id`
and read the active `profiles` row. Navigation loads `organizations`, own
`organization_memberships`, own `course_staff` and own `offering_staff`.
The sidebar organization selector scopes the home, course and group overviews.
An account with no authorized academic records sees the original layout with
honest empty states. Signing in does not create an enrollment or staff role.

### Data and authorization boundaries

- `server/services/application-auth.ts` provides a neutral authenticated viewer.
  Firebase uses a verified server token and the existing external-identity RPC;
  a Firebase UID is never used directly as a profile UUID.
- `server/repositories/website.ts` makes typed, explicit-column, read-only queries
  with the caller's JWT and the publishable Supabase key. PostgreSQL RLS remains
  authoritative. No service-role client or privileged data proxy was added.
- `server/services/website.ts` derives navigation from active tenant membership
  and course/offering assignments. Organization owner/admin is contextual;
  ownership in one tenant confers no privileges in another. Offering teaching
  assistants can inspect their permitted roster without gaining enrollment
  management privileges.
- Students do not receive peer roster/profile/progress records. Published lesson
  visibility, account suspension, enrollment validity and tenant isolation are
  enforced by existing database policies, independently of navigation checks.
- Teacher counts represent **enrollment records in supported offerings**, not
  distinct people across all offerings. Homework and live-session statistics
  remain unavailable rather than fabricated.
- Progress is computed per offering from lesson rows; completion is never copied
  from one cohort to another. Partial overview data does not produce a purported
  complete course percentage.
- Overview queries have explicit limits: 100 courses/offerings/enrollments,
  500 modules/lessons, 1,000 progress rows and 100 scheduled assessments, with
  overflow detection. Lesson module filters use at most five 100-ID batches.
  Course lists paginate 100 records; rosters paginate 50. Identity/navigation
  relationship queries are bounded to 101 records; larger installations need
  further navigation pagination. This is a documented scaling limit, not an
  authorization bypass.
- Invalid identifiers, oversized query parameters and excessive page offsets
  fail closed. Some streamed Next.js not-found responses have HTTP 200 with a
  404 page; tests verify the rendered denial and absence of private content as
  well as direct database access denial.

## Prepared or retained, but inactive in Firebase staging

The middleware permits only explicitly adapted routes. Legacy APIs return 503;
unmigrated pages lead to a clear unavailable page with links to working sections.
Original implementations remain intact for Clerk mode.

| Deferred workflow/routes | Remaining dependency |
| --- | --- |
| Full teacher course creation/editing, `/teacher/create`, nested editor pages | Prisma mutations, Clerk permissions, content authoring/upload adapters |
| `/courses/*/chapters/*`, video playback, UploadThing/Mux | Private media migration, block renderer, playback authorization |
| Homework and review/submission pages | Legacy submission model, assignment/attempt mapping, submission UI |
| Assessment authoring and participation UI | Existing secure Supabase assessment RPCs need original UI adapters; Phase 1 exposes schedules only |
| `/admin/users`, group management and enrollment writes | Contextual administration forms and mutation adapters |
| Support ticket persistence | Legacy ticket API; Firebase support dialog currently offers an email-client contact action |
| Live sessions, attendance and channels | Legacy schedule/LiveKit integration and cohort-scoped session model |
| Notifications, payments, personalization, notes | Dedicated tenant-aware backend/UI integration |

Course and roster writes were intentionally not implemented in this read-focused
phase. Database assessment/storage capabilities from earlier work remain
available to their existing adapters but are not represented as a finished
student assessment, upload or video UI.

## Additive database migration

Applied to development project `gmvouqgjbtbkbhrdruzu` via Supabase MCP:

`20261010144028_allow_organization_owner_cascade.sql`

Disposable-fixture cleanup exposed an existing trigger bug: the last-owner guard
also blocked an authorized deletion of the parent organization through its
membership foreign-key cascade. The migration replaces only the private guard
function. It locks the parent row, preserves last-active-owner deletion,
demotion and suspension protection while the organization exists, and permits
the child cascade when the parent has already been deleted. Empty search path,
fully qualified references and restricted function execution are preserved.
No new organization deletion endpoint or application deletion grant was added.

All original 13 migration versions remain unchanged; the connected database and
Git migration directory contain 14 matching versions. No schema type changes
were introduced, so existing generated TypeScript database types remain valid.
No existing application records were removed by the migration.

## Verification

Completed checks:

- `npm run check`: **52 passing unit/adapter tests**, architecture boundary
  checks, TypeScript and lint; zero errors, eight pre-existing lint warnings.
  Seven new tests exercise contextual capabilities, offering-specific progress,
  route allowlisting, query limits/pinning and invalid organization selection.
- Production builds pass for both `clerk` + `legacy` and `firebase-staging` +
  `supabase-staging`. Ignored build directories isolated these from the user's
  running development server. Clerk production security smoke passed 10 checks.
- Connected-database rollback suites, rerun after migration 14: authorization
  **71**, hardening **51**, Firebase identity **34**, owner-cascade **5** checks;
  **161 total**, all passed. These test SQL policy behavior with fixture JWT
  claims; they are not a substitute for signature-verified browser tests.
- Supabase HTTP boundary smoke: **4 passed**, using only the publishable key;
  anonymous access, private-schema exposure and an unsigned JWT are denied.
- Real signed Firebase JWT/PostgREST checks: **12 passed**. Student peer records,
  unenrolled courses/sibling offerings, drafts and answer keys are denied;
  student teacher-content updates do not change data; teacher A cannot read B;
  assigned staff can read their roster; owner A/instructor B retains separate
  tenant access; suspended enrollment grants no offering access.
- Actual authenticated Playwright flows passed in Chromium **153.0.8010.12**
  and Firefox **155.0** with fresh contexts and disposable real accounts. Covered
  student courses/groups/progress, teacher/admin overview and rosters, cross-tenant
  denial, refresh, logout, suspended enrollment and empty mobile account states.
- Final production/HTTPS acceptance passed **27 checks** with real signed tokens
  in Chromium **153.0.8010.12**, Firefox **155.0** and WebKit **26.6**: 12 direct
  RLS checks plus five account scenarios per engine. There were **zero captured
  JavaScript exceptions or hydration console errors** and no detected horizontal
  overflow. Desktop viewport was 1280×900; the empty account used 390×844.
  Screenshots of the restored desktop and mobile layouts were inspected.
  Initial WebKit development runs had HMR/cancellation noise; the stable
  production run eliminated it without suppressing hydration warnings.
  A reproducible input-readiness race was fixed: Firebase form fields wait for
  auth initialization before accepting input. The harness also waits for the
  settled Home location because auth observer/submit navigation can overlap.
- Firebase production HTTP boundary checks: **7 passed** for anonymous page
  denial, legacy API blocking and cross-origin authentication rejection. Streamed
  redirects were checked for the sign-in destination and absence of private data.
- Repository credential scan: 416 source files and 116 staging client JavaScript
  assets contained no Firebase Admin private-key fragment or embedded secret-key
  material. `.env`, `.env.local`, `.local` manifests and credentials remain ignored.
- Read-only legacy reconciliation confirms the inventory below, with zero writes.

Security/performance advisors were rerun after the migration. No new security
errors were reported. The two private tables intentionally have deny-all RLS with
no direct policies; access is through controlled functions. Supabase's pre-existing
leaked-password-protection warning remains an owner configuration decision;
this setting does not configure Firebase password policy. Thirteen unused-index
information findings remain; development usage statistics do not justify dropping
foreign-key/authorization indexes.

Not tested: interactive Google account approval, actual email delivery for reset
and verification, long-duration token renewal, authenticated real Clerk accounts,
high-volume tenant pagination or a production deployment. Earlier unit tests
cover session refresh/revocation and CSRF behavior; those are distinct from these
real browser checks. No production readiness claim is made for deferred features.

## Legacy reconciliation and owner decisions

The subsequent preservation review produced a private, record-by-record approval
report and editable decision form under `.local/phase1-preservation/`. These are
ignored because they contain personal identity and academic metadata. The report
explicitly holds two courses with an absent Clerk author, four progress records
with a different absent Clerk user, and the submission's unknown cohort. It does
not associate the current Firebase account with any legacy identity. No data
imports, ownership grants or source record changes were performed in this review.

The read-only script `scripts/legacy-reconciliation.cjs` produces an ignored
per-record report at `.local/legacy-reconciliation.json`, including immutable
Clerk subjects and explicit unresolved Firebase, tenant, offering and progress
mappings. It deliberately omits email matching and has no import mode.

Verified legacy inventory: seven users, four courses, eight chapters, two
attachments, four progress records, two groups, four group memberships, one
submission, two support tickets and one personalization record. Other inspected
models currently have zero records and remain preserved in the schema/code.

Approval is still needed for:

1. Proof linking each immutable Clerk identity to a Firebase identity, including
   collision review with already-onboarded profiles. Matching emails are not proof.
2. Organization ownership, contextual teacher/admin/course staff assignments and
   course tenancy. Legacy global roles are not automatically promoted.
3. Which reusable courses each legacy group delivers, cohort dates/timezones and
   the corresponding enrollment status for each membership.
4. Which original offering each progress record belongs to; never duplicate it
   into every run of a course.
5. Publication/access rules, external media ownership, private file migration and
   homework-to-versioned-assessment mapping without invented grades.

Before any approved import: consistent encrypted source backup and restore test,
explicit mapping review, an additive resumable migration-run ledger, dry-run
counts/hashes/foreign-key/file-checksum reconciliation, and a staging rehearsal.
This phase neither imports records nor links existing real accounts.

Recommended next phase: review and approve identity/course/cohort mappings, then
build the resumable staging importer and contextual enrollment administration.
Follow with original lesson-block/private-video presentation and the assessment
participation UI, then authoring/homework and the remaining services.

## Reproducing disposable acceptance tests

`scripts/website-acceptance.cjs` is opt-in and restricted to localhost and the
named staging projects. It requires the Firebase Admin credential path only in
the server/test process. `prepare` persists each created synthetic UID immediately
under ignored `.local/website-acceptance`, then writes exact-ID fixture SQL for
reviewed Supabase MCP execution. `browsers` uses an external Playwright installation
without adding a website dependency; reports distinguish real tokens from mocks.
`cleanup-sql` generates exact-ID database cleanup; `cleanup-auth` deletes only the
manifest's disposable Firebase UIDs and sanitizes saved passwords/tokens.

Production session cookies require HTTPS. A local-only self-signed HTTPS proxy
and per-test certificate trust can exercise the production build without changing
application TLS settings, disabling global certificate verification or editing
production configuration. Never commit the ignored test manifest or credential.

All six disposable Firebase accounts were deleted and each exact UID was
confirmed absent. Exact-ID Supabase fixture cleanup completed successfully;
fixture profiles, identity mappings, organizations and courses have zero
remaining rows. The original eight profiles (seven seed profiles plus the
already-onboarded real account) remain. Saved fixture passwords and tokens were
erased from the ignored manifest. No real account or legacy record was deleted.

The temporary HTTPS proxy was stopped after verification. The user-started
3111 production test process is left under the user's control; stop it with
Ctrl+C when finished. Continue normal development on the existing port 3000
server. The generated local test launcher/certificate/build directories are
ignored artifacts, not deployment configuration.

## Changed files

- app/(dashboard)/(routes)/courses/[courseId]/detail/page.tsx
- app/(dashboard)/(routes)/courses/[courseId]/layout.tsx
- app/(dashboard)/(routes)/courses/[courseId]/page.tsx
- app/(dashboard)/(routes)/group/page.tsx
- app/(dashboard)/(routes)/home/page.tsx
- app/(dashboard)/(routes)/offerings/[offeringId]/page.tsx
- app/(dashboard)/(routes)/search/page.tsx
- app/(dashboard)/(routes)/self-learning/page.tsx
- app/(dashboard)/(routes)/teacher/courses/page.tsx
- app/(dashboard)/(routes)/teacher/layout.tsx
- app/(dashboard)/(routes)/unavailable/page.tsx
- app/(dashboard)/_components/website-pages.tsx
- app/(dashboard)/layout.tsx
- app/layout.tsx
- app/lms-staging/page.tsx
- docs/firebase-auth-integration.md
- docs/phase1-website-integration.md
- frontend/components/course-card.tsx
- frontend/components/providers/application-auth-provider.tsx
- frontend/components/sidebar.tsx
- frontend/components/support-modal.tsx
- frontend/features/auth/firebase-form.tsx
- frontend/features/courses/detail/legacy-course-detail.tsx (deleted 2026-11-27: nothing imported it)
- frontend/features/dashboard/admin-home.tsx
- frontend/features/dashboard/student-home.tsx
- frontend/features/groups/group-roster-view.tsx
- middleware.ts
- package.json
- scripts/dependency-security.test.cjs
- scripts/firebase-auth.test.cjs
- scripts/legacy-reconciliation.cjs
- scripts/website-acceptance.cjs
- scripts/website.test.cjs
- server/repositories/website.ts
- server/services/application-auth.ts
- server/services/website.ts
- shared/contracts/application-auth.ts
- shared/contracts/dashboard.ts
- shared/website-model.ts
- shared/website-routes.ts
- supabase/migrations/20261010144028_allow_organization_owner_cascade.sql
- supabase/tests/authorization.sql
- supabase/tests/organization-owner-cascade.sql

docs/windows-development.md was already untracked before this phase and was preserved. Ignored build/proxy/test reports are local verification artifacts, not application source.
