# New LMS — Phase 2 teacher editor

> Historical implementation record. Step 02B disabled self-service organization
> onboarding. Step 02B-S migration 17 now revokes its RPC grants in the approved
> development project. Current provisioning instructions:
> [organization-provisioning.md](organization-provisioning.md).

## Direction and boundaries

This is a NEW LMS. Firebase Authentication establishes identity and Supabase PostgreSQL is the source of truth for application data and tenant permissions. The original website contributes its adapted design and reusable UI components only.

Legacy migration is canceled. Do not investigate, export, reconcile, link, import, overwrite, or delete old Clerk/Prisma records. Do not apply `20261010153606_legacy_preservation_ledger.sql`. Historical migration documents/scripts are retained for provenance, not active development instructions. Email similarity is not identity authorization.

Verified Phase 1 is preserved at `59706084d20cb4eb910c1056032dc79f8afbd358`. Phase 2 branches directly from that commit on `codex/teacher-editor-phase2`. Canceled work is retained separately at `861ad483aabaeba21a7ba653f45b1f4f4e4f338a` on `codex/legacy-preservation-dry-run`; the GitHub Desktop stash is retained. None of that branch was merged into Phase 2.

The original checkout remains unchanged on local main. The separate Phase 2 checkout is:
`C:/Users/Sky-II-14600kf/.codex/worktrees/teacher-editor-phase2/The-Life-of-Physics-Portal`.

Existing Firebase accounts, Supabase records and all RLS policies are preserved. No account is automatically made owner of an existing organization. An explicit onboarding action creates a new organization and contextual ownership.

## Audit and first implementation slice

The original course editor combines title, rich description, image, chapter count, chapters and publishing UI with legacy endpoints. Supabase represents courses, modules, lessons and lesson blocks separately. Its course metadata includes title, description, slug, status and visibility; it has no legacy chapter-count field or course image field.

The adapted editor reuses the existing dashboard shell, course cards, Button, Input and rich-text Editor. It uses dedicated Firebase/Supabase endpoints, never the legacy course handler. Existing legacy components and explicit fallback branches remain pending a reviewed cleanup; they are not used by the new editor.

Implemented:
- Home link to explicit organization onboarding at `/onboarding/organization`.
- Onboarding uses the existing atomic `create_organization` RPC and last-owner protections.
- Course creation at `/teacher/create`, scoped to active owner/admin/teacher memberships.
- New courses are always private drafts; the existing ownership trigger assigns the creator.
- Authorized course cards link to `/teacher/courses/[courseId]`.
- Course title, slug, rich description, draft/published/archived status and private/unlisted/public visibility can be edited.
- Optimistic concurrency compares the original `updated_at`; stale writes return HTTP 409.
- Strict input whitelists, bounded JSON requests, exact-origin CSRF checking, verified Firebase sessions and sanitized errors.
- No course, organization or identity deletion endpoints.

Publishing course metadata does not publish lessons or create enrollments. Existing RLS still requires contextual staff access or an authorized offering/enrollment; setting public visibility does not introduce anonymous catalog access.

## Database changes

Two additive migrations are applied to the connected development project, after the existing 14 migrations:
1. `20261010181016_teacher_course_creation.sql`: checked private definer function plus public invoker wrapper.
2. `20261010181140_reuse_course_owner_trigger.sql`: corrects duplicate owner assignment to rely on the existing trigger.

Both are retained in order to reproduce the applied history. The second was required when the first transactional test exposed the already-existing ownership trigger. That failed test rolled back completely.

No table, RLS policy or existing record is changed by these migrations. The private definer uses an empty search_path, qualified references, current_app_user_id and active contextual organization roles. Anonymous execution is revoked. Browser/server data clients use a publishable key and the caller's verified Firebase token; no service-role key is used.

## Verification

- `npm run check`: application tests, TypeScript, architecture boundaries and ESLint; eight pre-existing warnings, no lint errors.
- `scripts/teacher-course.test.cjs`: validation/mass-assignment denial, contextual permissions, CSRF/anonymous rejection, stale update rejection, size limits and safe error responses.
- `supabase/tests/teacher-editor.sql`: 20 assertions against connected PostgreSQL using unique synthetic identities and organizations inside BEGIN/ROLLBACK. Existing records are untouched.
- SQL tests cover onboarding ownership, private draft defaults, creator course ownership, edit/publish, cross-tenant creation/read/edit denial, student/assistant creation denial, editor assignment, suspension and anonymous RPC denial.
- SQL claims simulate the verified API gateway. They do not prove Firebase cryptographic verification or authenticated browser behavior.
- All 19 public tables still have RLS enabled; new helper grants/search_path checked after applying.
- Security/performance advisors show existing notices only. Private answer keys and identity registry deliberately have no direct RLS policies. Unused indexes are retained pending real workload evidence. Supabase Auth leaked-password protection remains disabled; Firebase is this application's sign-in provider.
- Production build passed in Firebase/Supabase mode. The new worktree required a physical dependency copy because a cross-drive node_modules junction prevented Next.js from resolving build modules. No application or production configuration workaround was introduced.
- Final application checks passed: 58 tests, architecture boundaries, TypeScript and lint (the same eight existing warnings).
- Clean Playwright Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 each passed eight smoke checks: sign-in initialization, mobile overflow, three teacher-page sign-in redirects, anonymous write rejection, CSRF rejection and blocking of legacy course writes. No captured JavaScript exceptions or hydration errors.
- Final integration acceptance now passes real authenticated organization creation, draft creation, rich-text editing, persistence, publishing, stale-tab rejection, tenant isolation, logout and session restoration. See [the final integration validation and approval report](phase1-phase2-integration-validation.md) for the 59 application tests, 181 PostgreSQL assertions, browser coverage, fixture cleanup and proposed local-main fast-forward.
- Credential-pattern scanning found no credentials/test JWTs in the changed source files. Local environment files, copied dependencies and browser reports remain ignored.

## Local use

Use the existing Firebase/Supabase development configuration:
`NEXT_PUBLIC_AUTH_BACKEND=firebase-staging`, `LMS_DATA_BACKEND=supabase-staging`, and an exact `APP_ORIGIN` matching the local URL. Names are retained for compatibility with Phase 1. No production flags or environment files were changed.

From the Phase 2 checkout, run the existing development command with your protected Firebase Admin credential path configured in the terminal. Use a separate available port if the original checkout is already running. Sign in, open Home, choose Create an organization, then create a course. Save metadata, reload and verify persistence. A second signed-in tab can check stale-save rejection.

Do not run legacy inspection/migration scripts. Do not reset or reseed the connected database.

## Remaining implementation order

1. Modules/chapters: creation, title editing and transactional reordering with conflict detection.
2. Lesson editor: block-based content, drafts/publication and secure media references.
3. Organization staff and course staff administration: explicit scoped role assignment, invitation acceptance, last-owner protection and no email-only identity linking.
4. Offerings/groups: create course runs, assign offering staff and administer enrollments for existing verified new-LMS profiles.
5. Student content delivery, media upload/playback, assignments and assessment participation.
6. Reviewed cleanup of dormant Clerk/Prisma code/dependencies after parity checks.

No global teacher/admin access will be introduced. Each slice must include RLS tests and a complete UI-to-database flow. No push, merge or deployment is part of this phase.

## Backlog — student academic-stage selection (temporarily hidden, 2026-10-20)

The student-facing “Your academic stages” panel is paused on Home and Self Learning.
The existing selector/component, program/stage schema, preference records, APIs,
teacher management and RLS remain intact. No academic records or saved preferences
are deleted. All authorized courses remain available; no invisible discovery filter
is applied while the panel is hidden. This is not an enrollment/access change.

Before re-enabling, review and complete the student selection experience: proper
program/stage interface; correctly persisted per-program, per-organization student
preferences; loading, genuine empty, error/retry, saved and recovery states; useful
course discovery/filtering; tenant isolation and authorization. Tests must cover
persistence across refresh/new sessions and switching programs/organizations,
archived-choice recovery, failed saves and forbidden cross-tenant requests.
Keep the UI disabled until that review is approved; do not implement it in the
current Settings task. Existing API/SQL preference tests remain active.
