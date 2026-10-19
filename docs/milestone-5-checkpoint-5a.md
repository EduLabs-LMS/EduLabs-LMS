# Milestone 5 — Checkpoint 5A database review

Date: 2026-10-18. Status: **local implementation tested; awaiting development SQL approval**.

Historical checkpoint: on 2026-10-19, Checkpoint 5B independently verified that
the exact SQL below is applied in development as version `20261018210950`.
Development has 30 migrations. See the migration ledger for the verified map;
the original pending-approval report below is retained as historical evidence.

Branch: `codex/milestone5-academic-programs-stages`.
Isolated worktree: `E:/EduLabs-Milestone5`.
Starting checkpoint: `06544439fe2c056793e72a34c275689931c11638`, whose parent is the reviewed `integration/milestone4-candidate` commit `d264556480d81f64f3c3e5cc6fce84f7c9bbabdb`.

This implements only 5A. There are no new UI, application routes or API handlers yet. Checkpoints 5B–5D remain gated on approved development migration/application verification. No connected writes, mutating remote tests, history repair, deployment, push or merge occurred.

## Exact pending migration

`supabase/migrations/20261018203119_academic_programs_stages.sql`

SHA-256:

```text
19EE37C9462E7879B987F013928EF41066E23620E5BBD2226353DD2F5152F8BD
```

Created with Supabase CLI `2.121.0` using `migration new`; protected by an exact `-text` Git attribute. This is the only new migration. The 29 pre-existing migration blobs remain unchanged. The local directory now has 30 SQL files; the connected development project still has 29 applied versions. This file is NOT applied remotely.

## Audit of the existing architecture

The source contract and development ledger were read before implementation. The connected project ref was verified as `gmvouqgjbtbkbhrdruzu`, active/healthy, PostgreSQL 17. Read-only inspection confirmed no existing program, stage, assignment or preference tables.

Existing public profiles use stable UUIDs resolved from verified Firebase issuer/subject through `private.current_app_user_id()`. Native Supabase identities remain supported by that existing boundary. There is no email-based identity association and no global teacher/student role. Organization membership and course/offering assignments determine staff permissions. `private.has_org_role`, `private.can_edit_course`, `private.is_org_member` and `private.is_enrolled` are reused, not replaced.

The teacher editor currently authorizes through `server/repositories/teacher-course.ts` and caller-scoped Supabase. Its HTTP wrapper provides verified Firebase sessions, exact-origin checks, bounded bodies and sanitized failures. `server/services/website.ts` and the dashboard Home/Self Learning adapter load authorized courses, offerings, enrollment and progress; their academic queries were left untouched. Student learning access still comes from those existing policies, never taxonomy/preferences. The existing `private.is_enrolled` policy intentionally permits an active unexpired enrollment after the offering's `ends_at`; this remains unchanged and is tested.

Development baseline counts from read-only queries: 10 profiles, 2 organizations, 2 courses, 3 offerings. No existing account/academic rows were modified by this task.

## Model

| Object | Purpose and relationships |
| --- | --- |
| `public.academic_programs` | Organization-owned configurable curriculum: UUID, stable slug/label, optional description, active/archived status, position, timestamps and revision. Slug unique per organization. |
| `public.academic_stages` | Ordered configurable stage inside one program. Composite `(organization_id, program_id)` foreign key prevents a forged parent tenant. Slug unique per program. |
| `public.course_stage_assignments` | Many-to-many course/stage links. Composite foreign keys bind both course and stage to the same organization. One course may span multiple stages/programs of that organization. |
| `public.student_stage_preferences` | One row per identity/program; selected stage must belong to that exact program and organization. Nullable stage represents a versioned cleared preference. Independent programs never overwrite one another. |
| `private.course_stage_versions` | Deny-by-default classification revision, retained after links are cleared. Avoids changing the existing course metadata/publishing version or adding columns to academic records. |

The only alteration to an existing table is an additional unique `(organization_id,id)` constraint/index on `courses`, providing a referenced tenant key. No course rows, IDs, timestamps, publication settings or grants are changed. The index builds on the existing data and requires a short table lock when applied; schedule the approved application without concurrent authoring if practical.

All new tables have RLS. Exposed tables grant only authenticated SELECT. There are no direct authenticated INSERT/UPDATE/DELETE privileges or write policies. Private version rows have no authenticated table privileges. Taxonomy and preference writes are identity-bound RPCs. No anonymous catalog/API access is added.

All new references use deliberate RESTRICT behavior. Referenced taxonomy should be archived rather than deleted. Classifications/preferences survive archival. Cleared classifications retain their private version tombstone, which also prevents destructive course deletion once a version exists. Existing teacher UI already disables course deletion; no new deletion workflow is provided here. No seed/backfill fabricates a program or stage for old courses. Those courses remain explicitly unassigned.

Ordering allows ties resolved by ID, avoiding transient unique-position failures during later UI reordering. Positions are bounded `0..1000000`; slugs/names/descriptions, JSON bytes and classification arrays are bounded. Indexes cover tenant catalog ordering, composite foreign keys and course/stage traversal; the preference-stage index also covers its program-FK prefix without a duplicate program-only index.

## Privilege matrix

| Actor | Catalog reads | Taxonomy writes | Course classification | Preferences |
| --- | --- | --- | --- | --- |
| Anonymous/unmapped/unverified/disabled identity | Denied | Denied | Denied | Denied |
| Active owner/admin of organization | Active and archived in that organization | Create/edit/archive program/stage | Existing course-edit permission | Own only |
| Active contextual teacher/assistant | Own organization, including archived | Denied | Only when existing `can_edit_course` permits it; assigned editor/instructor allowed, assistant without edit role denied | Own only |
| Active, currently eligible enrolled student | Active program/stage choices in enrolled organization | Denied | Read links only for independently authorized courses and visible stages; no writes | Read/update own per program |
| Suspended member without independent eligible enrollment; expired/suspended enrollment; inactive organization | No access through that revoked relationship | Denied | Existing contextual checks remain authoritative | Hidden/denied through revoked organization access |
| Other tenant staff/student | No access without a separate legitimate relationship | Denied | Denied | Never another student's data |

An identity can hold different legitimate roles across organizations. Suspending one membership does not intentionally remove a separate active student enrollment or another organization's membership. Catalog eligibility is **active organization membership or at least one existing eligible enrollment in that organization**. Signup, pending request or invitation alone does not grant private taxonomy access. Anonymous/pre-enrollment public discovery remains Milestone 6 scope.

Own saved preferences remain readable when a selected stage/program is archived, provided organization eligibility still exists; the UI can show recovery rather than silently delete them. Archived choices are not selectable. Explicit clearing works even for an archived parent. Loss of organization eligibility hides saved preferences without deleting them. Teachers cannot list other students' private choices.

## RPC contracts

All public wrappers are SECURITY INVOKER, revoke PUBLIC/anon EXECUTE and delegate to reviewed private definers with fixed empty search paths and qualified application objects. Private helpers also revoke PUBLIC/anon. Direct private invocation enforces the same checks and is not an authorization bypass.

```sql
public.academic_command(
  p_action text,
  p_organization_id uuid,
  p_entity_id uuid default null,
  p_revision bigint default null,
  p_data jsonb default '{}'
) returns jsonb

public.course_stage_classification(p_course_id uuid) returns jsonb

public.set_student_stage_preference(
  p_program_id uuid,
  p_stage_id uuid,
  p_revision bigint default 0
) returns jsonb
```

Actions:

- `program.create` / `program.edit`: owner/admin only; allowlisted `label`, `slug`, nullable `description`, `position`, `status`. Create generates ID and starts revision 0. Edit requires current revision and increments it; omitted fields are retained.
- `stage.create` / `stage.edit`: same rules, with `programId` required only on creation. Stages cannot change program/tenant through the API. Active stages cannot be created/reactivated under an archived parent.
- `course.assign`: existing contextual course-edit authorization. Exact `stageIds` array, maximum 50 unique UUIDs, all active and in active programs of the same tenant. Empty array explicitly clears assignments. Omitted array is an error. Unchanged sets are idempotent, preserve link timestamps and retain revision. Changes return `{courseId, revision, stageIds}`.
- `course_stage_classification`: authorized editor reads all current links, including archived references, plus durable version. An unassigned never-edited course has revision 0. Students read permitted assignment rows through RLS, not this management RPC.
- `set_student_stage_preference`: no user/organization argument. Both derive from verified identity and selected program. Initial version 0 creates version 1. Identical choice is idempotent; a different choice or explicit null advances revision. A stale request fails even if its desired value matches current state. Returns the own preference row.

Invalid fields/types/size/duplicates fail with `22023`; malformed UUID text may produce `22P02`; duplicate slugs use `23505`; denied/missing scoped targets use `42501`; stale writes use `PT409` for later HTTP 409 mapping. A contended membership/course-staff/enrollment authorization row fails with retryable `55P03` rather than creating an inverse-lock wait against existing owner/capacity operations. New HTTP handlers must sanitize database errors, expose a clear retry on lock contention, and retain existing CSRF/session/body-limit patterns in 5B. No new HTTP endpoints exist at 5A.

## Concurrency and threat review

An initial authorization gate rejects outsiders before they can queue on a tenant's mutation lock. Authorized writes acquire the organization row first, serializing low-frequency taxonomy, classification and preference changes within one tenant. Different tenants use different locks. Then identity, membership and relevant course/enrollment rows are locked/revalidated; the early gate never replaces post-lock permission checks. No caller-provided JWT role, organization claim, email address or target student controls authority.

This intentionally favors simple correctness over maximum preference-write throughput. Large onboarding-load performance is not claimed. An approved future scaling change can narrow locks after retaining these concurrency proofs.

The isolated tests prove stale program/stage/classification/preference writes are rejected, simultaneous first selection produces one row, archival cannot race a new selection, and membership/enrollment/identity revocation completed during a lock wait is rechecked. A separately locked owner-membership or enrollment causes a safe retryable failure with no partial taxonomy/preference change. Existing enrollments are not silently renewed or altered. No new table/helper participates in course, lesson, homework, exam, media or enrollment access policies. A selection cannot unlock private courses, drafts or another tenant's media.

Composite foreign keys reject forged cross-tenant course-stage links and mismatched preference-program-stage rows even when attempted by the local privileged test connection. No dynamic SQL, caller-selectable identity, new provider configuration or privileged browser credential is introduced.

## Validation actually executed

| Check | Result |
| --- | --- |
| Full disposable native PostgreSQL replay | All 30 local SQL migrations replay, including Milestone 4 |
| SQL regression suites | 20 passed; new academic suite has **101 assertions** |
| Independent-session concurrency | **96 cases passed**: 84 existing plus 12 academic cases |
| Existing data/grants/function/policy preservation at new migration | 72 table/data/RLS/grant baselines, 196 function definitions/grants, 112 policies unchanged |
| Application tests | **237/237 passed** with serial test execution |
| Architecture boundary checks | Passed |
| ESLint | Passed, 0 errors and 10 pre-existing warnings; no application source changed |
| TypeScript | **Blocked by host memory exhaustion**, not reported as passed |
| Production builds/browser UI acceptance | Not run for this SQL-only checkpoint; required during 5B–5D |
| Git whitespace and original migration audit | Passed |

Both fresh-install and existing-seed upgrade replay paths are covered. Tests exercise native/local Firebase claim substitutes and the existing onboarding RPC, not real connected Firebase sessions. The new verified but unenrolled identity initially sees no taxonomy; after an exact local test enrollment it can save its own choice, and disabling its mapping immediately hides/denies preferences.

The original unbounded `npm run check` exhausted host memory. The identical application test-file list passed with `--test-concurrency=1`. Boundaries and lint were then executed separately. TypeScript could not complete: a 512 MB attempt exhausted its heap and a 1536 MB attempt encountered native allocation failure under Windows commit pressure. No type error is being waived or hidden. There are no changed TypeScript/application files; rerun strict TypeScript with adequate host memory before full milestone integration. No unrelated process or OS configuration was changed to make tests pass.

Reproduction with the repository's existing optional local PostgreSQL runtime:

```powershell
$env:LMS_SQL_RUNTIME = '<existing optional runtime node_modules path>'
node scripts/exam-sql-local.cjs --postgres
node scripts/exam-sql-local.cjs --postgres --fresh-install
# The harness reads its loopback cluster port from .local/step03a/pg-port.txt.
# Use the existing local runtime setup; never point it at a connected project.
```

The harness only connects to `127.0.0.1`, creates a randomized database, executes local bootstrap/migrations/suites, closes all clients and drops that exact database in `finally`. SQL assertion fixtures roll back. Concurrency fixtures are confined to that disposable database. No remote fixtures, Firebase identities or Storage objects were created.

Final cleanup verified zero run-owned databases remaining and the task-owned
local cluster stopped. Existing development servers and other worktrees were
not stopped or changed. The final read-only development check still reports 29
migrations, no Milestone 5 public tables, and the same four baseline row counts.

## History reconciliation

The 29 remote version/name pairs match the ledger's map. Its four recorded remote SHA-256 values match current stored migration SQL. Two original Git files (lesson covers and chapter metadata) use LF versus reviewed remote CRLF; this is byte-level variance, not executable SQL drift. Their current Git hashes and exact CRLF counterparts are recorded in `development-db-migration-ledger.md`. Other old comments/formatting differences were inspected without changing SQL or history. Do not claim universal raw-byte equivalence or run automatic migration/history repair.

The new migration must be applied **once, by its individually approved exact SQL**, after a repeat read-only preflight. Do not use `db push`, `migration up` or replay earlier Git files against development. After separate approval, capture the actual resulting remote history version/name/hash and update the ledger; no remote version is predicted or claimed here.

## Recovery plan and approval boundary

Before approval/application, recovery is simply retaining this isolated branch; there is no remote state to undo. The SQL is transactional, so an application failure rolls back its own changes. Stop and inspect any unexpected error; do not automatically change grants, history or pre-existing data.

After successful application, prefer an approved forward migration for any defect. An emergency access pause can revoke EXECUTE from authenticated on the three new public/private command/read pairs and revoke SELECT on the four new public tables, without changing existing learning RLS or account permissions. Such remote actions require explicit authorization. Do not drop tables with student selections/classifications or cascade-delete taxonomy; preserve their data and resolve integrity through a reviewed repair. Do not reverse the organization-provisioning security restriction.

**Requested decision:** approve the exact migration filename and checksum above for development project `gmvouqgjbtbkbhrdruzu` only. Then preflight/apply/verify it, record the real history identifier, and proceed to 5B. No website deployment, main/integration branch change, PR modification or production change is included in that approval request.

## Changed files in 5A

- `.gitattributes` — exact new SQL byte preservation rule.
- `supabase/migrations/20261018203119_academic_programs_stages.sql` — additive schema, constraints, indexes, helpers, RPCs and RLS.
- `supabase/tests/academic-programs-stages.sql` — 101 isolated authorization/integrity/preference assertions.
- `scripts/academic-programs-concurrency.cjs` — twelve real independent-session cases, including outsider rejection before tenant locking.
- `scripts/exam-sql-local.cjs` — include new preservation baseline, suite and concurrency runner.
- `docs/development-db-migration-ledger.md` — append-only read-only audit clarification; original mapping retained.
- `docs/milestone-5-checkpoint-5a.md` — this checkpoint report and approval contract.
