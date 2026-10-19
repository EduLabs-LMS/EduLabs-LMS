# Milestone 5 — Academic Programs, Stages, and Student Selection

## Authority and working boundary

- Repo: EduLabs-LMS/EduLabs-LMS.
- Work only on branch: codex/milestone5-academic-programs-stages.
- Initial parent: d264556480d81f64f3c3e5cc6fce84f7c9bbabdb (integration/milestone4-candidate, PR #14).
- Do not merge, deploy, reset, force-push, or change integration/staging, main, PR #13 or #14.
- Current live VPS staging remains integration/staging at a544cedcdd5294797069eaf2a6997996998c2d7e. Work is local/branch-only until reviewed.
- Firebase Authentication is identity; development Supabase PostgreSQL is the academic authority; existing PostgreSQL RLS, tenant memberships and scoped RPCs are authoritative. Do not use Clerk or Prisma for Firebase staging operations.
- Review docs/development-db-migration-ledger.md before SQL work. Supabase development project gmvouqgjbtbkbhrdruzu has 29 applied migrations, including Milestone 4. Four SQL-equivalent migrations have remote history version timestamps different from Git filenames. Do not run Supabase db push, migration up, history repair, or apply earlier SQL automatically.
- New database changes need separate, milestone-specific owner approval. Previous authorization covered only Milestone 4. Never apply this milestone's SQL or run mutating remote tests on a connected project without new explicit approval.

## Why this exists

EduLabs is a multi-tenant teacher LMS. The same teacher/organization needs one dashboard to teach different educational programs and curricula, and students should select the academic stage they are interested in. An organization is not a grade; stages are not separate tenants. Stage selection is a preference/discovery filter, not enrollment or a permission grant.

Existing live database confirms:
- public.organizations(id, slug, ...), public.courses(id, organization_id, title, slug, status, visibility, ...), public.course_offerings(id, course_id, name, ...), public.enrollments(offering_id, user_id, status, ...) and public.profiles(id, ...) exist with RLS.
- There are NO existing academic_programs, academic_stages, grade or student-stage tables.
- Existing access rules are based on verified Firebase identity, contextual organization/course/offering permissions, and active enrollments. Preserve them.
- The verified source base contains the shared tree/green-black design, teacher course editor, dashboard, Self Learning, and the full Milestone 4 account UX. Reuse them.

## Product behavior

A. Teacher configuration:
1. An authorized organization owner/admin or appropriately scoped content-management staff member can create and manage educational programs inside only their own organization. Use existing role checks; do not invent a global "teacher" authorization shortcut. Prefer owner/admin for organization-wide taxonomy writes unless a supported contextual permission can safely be established.
2. Each program has a configurable title, stable slug, description (optional), active/archived status and position. Examples (not hardcoded): Egyptian secondary, international curriculum, university; no fixed Egyptian year labels.
3. Each program contains an ordered set of configurable stages (e.g. first/second/third secondary). Stages have stable IDs and slugs, teacher-defined display names, optional descriptions and an active/archived state.
4. One organization can run several programs. Use ONE existing teacher dashboard, not a new website or isolated tenant per stage. Lists, counts and management controls clearly indicate program/stage context.
5. A course may be assigned to one or more stages, including within different programs of the SAME organization. Reuse existing course content, offering, enrollment and progress IDs. Do not duplicate courses or silently reassign cohorts.
6. Preserve existing courses with no stage assignments; show them in an explicit "Unassigned" teacher state rather than silently hiding or backfilling them into an invented grade.

B. Student experience:
1. For a specific teacher organization, an authorized student can view its available program/stage choices and make a stage selection with clear progress/empty/loading/error states. If a student studies different programs, their selections must not overwrite one another (scope preference per student+program, with organization derived/checked).
2. Stage choices guide discovery and UI organization only. They must NOT create memberships, enrollments, content permissions, or offer access to unpublished/private courses.
3. Student Home/Self Learning should display stage-appropriate authorized content where applicable and retain access to every offering the student is legitimately enrolled in, even if its stage differs from the current preference. Unclassified legacy enrollments stay visible.
4. Do not expose another organization's program/stage catalog or student preferences via forged IDs, route params, JWT payload fields or filter queries. Anonymous/public catalogs are OUT of scope and belong to Milestone 6.
5. A missing/archived selected stage has a safe recovery state; don't delete or modify historical learning progress.

C. Integration with existing editor:
- Add lightweight stage assignment/editing to existing teacher course editing without altering course publish semantics or creating an enrollment.
- Follow existing EduLabs V2 styling, visual layout, responsive breakpoints, empty/error states, accessible keyboard navigation and RTL-safe layout. Do not create a parallel UI design system.
- Do not break Milestone 4 signup/onboarding/account dialogs, session/group views, covers, chapter metadata, assessments, homework, badges or notifications.

## Schema design work (propose and review before committing)

Consider the following additive model; refine after inspecting real SQL and RLS:
- public.academic_programs: UUID identity, organization_id, slug, label, description, position, status, timestamps, review-friendly revision for optimistic updates.
- public.academic_stages: UUID identity, program_id, teacher-defined slug/label, position/status/timestamps, consistent tenant scoping.
- public.course_stage_assignments: course_id + stage_id junction with a database-enforced SAME-ORGANIZATION relationship (not UI-only).
- public.student_stage_preferences: student identity + program ID + selected stage ID, at most one preference per program, and DB-enforced selected stage belongs to that program.
These are candidate names and constraints, not authorization to create them remotely.

Require:
- Tenant-safe composite foreign keys or equivalent immutable integrity enforcement, uniqueness, referential integrity and appropriate indexes. No cross-org course-stage mapping even via forged SQL/RPC parameters.
- RLS and least-privilege access: anon denied; teacher program writes restricted to explicit contextual roles; student reads/preferences constrained to verified identity and applicable organization. Direct updates must be explicitly justified vs identity-bound RPCs.
- Sensitive commands use reviewed API + RPC patterns, exact-origin CSRF for writes, bounded JSON/arrays/pagination, allowlisted fields, conflict revision checks, error sanitization.
- Archive rather than destructive deletion for referenced programs/stages; preserve course IDs, enrollments, progress, student academic records. No migration backfill that fabricates program assignment.
- No general self-service organization creation and no cross-tenant role promotion.
- No automatic extension of public Data API access or anonymous public catalogs.

## Checkpoints — finish in order

### 5A — Schema proposal, isolated SQL proof, migration approval gate
1. Inspect existing migrations, generated types, actual current branch, role/scoping helpers, teacher course editor, Home and Self Learning.
2. Write a detailed model + privilege matrix + threat model and one or more additive SQL migration files; keep existing 29 migrations completely unchanged.
3. Add native disposable PostgreSQL tests covering cross-tenant forged references, unauthorized writes/reads, suspended members, missing/archived stages, malformed payloads, concurrent conflicting edits, authorized preferences, legacy unassigned courses, and preservation of existing tables/grants/data.
4. Test a full scratch replay including Milestone 4. Verify remote development migration map against docs/development-db-migration-ledger.md without modifying remote state.
5. STOP and report migration paths, exact SHA-256 checksums, scope, local test results, rollback/recovery plan and whether all existing rows remain untouched. Request explicit owner approval before applying this milestone to Supabase development.
6. Once separately approved and actually applied, verify remote version, checksum, RLS, constraints and existing data; update the migration ledger with exact remote name/version/hash. Do not claim remote sync before running it.

### 5B — Server/API and teacher configuration
- Implement tenant-scoped reads/commands for programs/stages/course assignments reusing existing verified Firebase middleware/session and server integration patterns.
- Integrate within existing teacher dashboard and course edit flows. Add tests for role matrix, duplicate names/slugs, archived behavior, optimistic concurrency and forged IDs. UI should not assume one program/stage per tenant.

### 5C — Student stage selection and discovery
- Build stage/program picker, per-program persisted preference and authorized discovery filters.
- Keep independent enrollment/progress access intact; no spoofable role/tenant assumptions.
- Add responsive browser component tests, independent profiles/organizations, navigation/loading/error/empty/retry and keyboard coverage.

### 5D — Integration validation, draft PR and deployment gates
- Run npm application tests, strict TS, lint and architecture checks; report lint warnings, not just exit code.
- Run native disposable PostgreSQL migration replay, all SQL regression suites and concurrency checks. No connected SQL test fixtures without owner approval.
- Run Firebase/Supabase production build, preserving protected build config. Check legacy fallback if applicable and no regression.
- Component/browser checks at desktop and mobile; state clearly where HTTP/Firebase SDK was mocked versus real authenticated acceptance. Capture design evidence.
- Open a DRAFT PR targeting integration/milestone4-candidate (stacked milestone; do not target live integration/staging without approval).
- Produce changed-files list, commit checkpoints, test results, pending provider/browser gates, exact SQL checksum and development database status.
- No staging deployment, production change, secret access/export or DB history repair without separately authorized action.

## Explicit out-of-scope

Teacher custom domains, public anonymous catalogs, tenant website creation, payments, checkout, automated enrollment, publicly exposing curriculum via slug, student role elevation, brand redesign and rewriting old content or academic identity. These belong to later reviewed milestones.

## Success condition

An authorized teacher can administer multiple curricula and stages in a single existing dashboard and classify existing courses without duplicating academic records. An authorized student can choose their stage per program and see relevant content, but cannot bypass enrollment, publication, RLS, or tenant boundaries. The database is actually updated and re-verified in approved development Supabase before Milestone 5 is called integrated.
