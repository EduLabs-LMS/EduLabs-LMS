# Development Supabase migration reconciliation — 2026-10-18

This is an **audit ledger**, not a migration file, and is not permission for unreviewed schema changes.

- Target: Supabase **development only**, project ref `gmvouqgjbtbkbhrdruzu`.
- Source: integration candidate based on `3855e3a67a727df84c6a73b191fba6d9dc68a418`.
- Owner expressly approved applying **only** the Milestone 4 account/private-avatar migration after preflight.
- At the Milestone 4 checkpoint the connected schema had **29 applied migrations**; Milestone 5A increased this to 30, as recorded in the latest section below. The first 25 foundation versions already match their Git files.
- All four mappings below were verified using SHA-256 of the exact UTF-8 SQL stored in `supabase_migrations.schema_migrations.statements[1]` and the reviewed Git migration checksum. SQL bytes match; migration version timestamps do not.

| GitHub migration file | Supabase applied version | History name | SQL SHA-256 |
| --- | --- | --- | --- |
| `20261018091735_lesson_covers.sql` | `20261018113714` | `lesson_covers` | `e58f0d40a0afaa1b152736c2c66f69b92a4657933b7916f7986216eb5f36fb98` |
| `20261018092002_chapter_metadata.sql` | `20261018113727` | `chapter_metadata` | `8d0423ab55d7eb729a79c8cebd375114d699c35aa7dacc7532b68c6e2be91f5a` |
| `20261018100132_group_presentation_and_session_summary.sql` | `20261018113736` | `group_presentation_and_session_summary` | `a0a14658bb9f09f6fc1e9fed884db3d8f1a0a71d36a236e0152310dd97bfd4fc` |
| `20261018104040_account_profiles_private_avatars.sql` | `20261018201707` | `account_profiles_private_avatars` | `60dd7b134954229d4be0edc0a4884511d0c5947ead92d0e21b7b4e3b4e9ab7b4` |

## Milestone 4 application and verification

The exact reviewed `20261018104040_account_profiles_private_avatars.sql` (Git blob `ed9ffc16b14823112ac470fe00f301e3ef38f63a`) was applied once through the Supabase migration interface and reported success. Its resulting stored SQL SHA-256 matches the original. No earlier migrations were re-executed.

Post-apply read-only checks confirmed:
- `public.account_profiles` and `private.account_avatar_assets` exist, RLS enabled.
- Authenticated can SELECT own profile only by an RLS policy and cannot directly INSERT/UPDATE either table; anon cannot SELECT either table.
- The `lms-avatars` bucket is private, `image/webp` only, with a 1,048,576-byte file size limit.
- Storage policies permit owner-controlled read, attested insert, and retired delete, not overwrite.
- Private definer functions have fixed empty search paths and deny anon execution; public account RPC is invoker-scoped.
- Existing rows were unchanged in the audited counts: 10 profiles, 2 organizations, 2 courses and 3 offerings before and after.
- New account tables have zero rows and avatar Storage has zero objects immediately after applying (expected).

Security linter reported one new informational finding for the deliberately policy-free, deny-by-default private avatar ledger. Existing Supabase Auth leaked-password-protection warning is about native Supabase Auth, while this app uses Firebase Auth. Those warnings are not evidence of authenticated browser acceptance.

## Migration-version safety gate

**Do not run `supabase db push`, `supabase migration up`, or automatically replay Git migrations against this project.** Four applied migrations have different *history versions* than their Git filenames despite matching SQL. The stock migration CLI will not resolve that discrepancy solely from SQL checksums. Do not rewrite applied SQL files or manually manipulate migration-history rows without a separately reviewed, verified migration-repair procedure.

Keep this mapping and original SQL checksums intact until an explicitly approved repair brings the migration-history versions into canonical alignment. The v1.3 VPS staging manager additionally rejects any unapproved local migration changes; approval of database SQL does not silently approve a website deployment.

## Milestone 5A read-only recheck — 2026-10-18

The connected project still has exactly the same 29 versions/names. The four
**stored remote SQL** checksums above match the ledger. No Milestone 5 objects
exist remotely, and no migration/history repair or mutating test was performed.

One byte-level clarification is required for the source candidate at `0654443`:
the lesson-cover and chapter-metadata Git blobs use LF, while their reviewed,
stored remote SQL uses CRLF. Converting only those line endings reproduces the
ledger hashes exactly; SQL content is unchanged. The earlier statement that all
four current Git blobs match remote SQL byte-for-byte is therefore too broad.
Do not rewrite either historical migration to conceal this distinction.

| Git file | Current Git blob SHA-256 (LF) | Stored remote SHA-256 (CRLF) |
| --- | --- | --- |
| `20261018091735_lesson_covers.sql` | `68a1907106ae42b8e6b689451d35bfd2b5a4def3060850e7ba8981f555c0d7d2` | `e58f0d40a0afaa1b152736c2c66f69b92a4657933b7916f7986216eb5f36fb98` |
| `20261018092002_chapter_metadata.sql` | `9deeec8e295b0d356853d041e0389d8f9a44a2c751f0111bff7e127372b1d755` | `8d0423ab55d7eb729a79c8cebd375114d699c35aa7dacc7532b68c6e2be91f5a` |

The other two mapped files match remote bytes exactly. All 29 original Git blobs
remain unchanged by Milestone 5. The first 25 version/name pairs still match;
several old stored SQL strings differ from Git in line endings or surrounding
whitespace. Three further differences were read and checked: response-size
constraint SQL has comments/line wrapping in Git; course-owner-trigger reuse has
an extra explanatory comment/blank line; organization-creation revocation has
extra explanatory comments. Their executable SQL matches. This audit does not
relabel formatting equivalence as byte-level checksum equality.

Baseline counts were 10 profiles, 2 organizations, 2 courses and 3 offerings.
At the original local-only checkpoint, Milestone 5A was still pending and development had 29 migrations. See the dated application record below.

## Outstanding acceptance

### Milestone 5A — application confirmed read-only, 2026-10-19

Development now has **30 applied migrations**. The reviewed Git SQL file
`20261018203119_academic_programs_stages.sql` is recorded remotely as
`20261018210950_academic_programs_stages`, with exact stored SQL SHA-256
`19ee37c9462e7879b987f013928ef41066e23620e5bbd2226353dd2f5152f8bd`.
This is a fifth historical Git/remote timestamp mapping; do not run automatic
history repair or replay earlier files.

Checkpoint 5B's read-only verification confirmed all five new tables with RLS,
authenticated SELECT-only access on the four public tables, no authenticated
table access to the private version ledger, invoker public RPCs, private definers
with empty search paths, all eight live function bodies matching the reviewed
source, and four SELECT policies. Composite tenant/program foreign keys remain
present. No database mutation or migration application was performed by 5B.

The earlier 29-migration/pending statements in this document and the 5A report
are historical pre-application checkpoints, not the current development state.
This verification does not claim connected authenticated UI acceptance.

The isolated validation at `3855e3a` passed 237 application tests, TypeScript, boundaries, lint (0 errors/10 warnings) and the production Docker build. It did **not** run a full SQL regression replay for the integrated tree or test connected Firebase sessions, onboarding, actual uploads and Storage read/delete, provider login, or desktop/mobile acceptance on the deployed website. Staging is still the previous `a544ced` release. Separate review and authorization are required before staging deployment; production is untouched.

## Milestone 5A development application — 2026-10-19 (Cairo)

The independently reviewed Milestone 5A migration from commit `283641662ae057b6d6beea00eef8ee2b259a0a00` was applied **once** to development Supabase project `gmvouqgjbtbkbhrdruzu` with the Supabase migration interface. Application returned `success: true`. The source file and GitHub blob exactly matched the previously supplied and approved SQL:

| Git file | Applied remote version | History name | Stored SQL SHA-256 |
| --- | --- | --- | --- |
| `20261018203119_academic_programs_stages.sql` | `20261018210950` | `academic_programs_stages` | `19ee37c9462e7879b987f013928ef41066e23620e5bbd2226353dd2f5152f8bd` |

Git blob SHA: `c42fc6cd44dd2627466f95fc427bb7a003efdff8`.

**Actual read-only post-application verification:**
- Migration history contains **30** versions, including the new version and exact stored SQL SHA-256 shown above. None of the first 29 migration SQL files was replayed.
- Present with RLS enabled: `public.academic_programs`, `public.academic_stages`, `public.course_stage_assignments`, `public.student_stage_preferences`, `private.course_stage_versions`.
- Authenticated has SELECT only, not direct INSERT/UPDATE/DELETE, on the four new public tables; anonymous has no SELECT. The private version ledger grants neither authenticated nor anonymous direct table access.
- Reviewed all four new public SELECT policies. The private ledger is intentionally policy-free/deny-by-default.
- `public.academic_command`, `public.set_student_stage_preference`, `public.course_stage_classification` are invoker functions; private implementations are definer functions with fixed empty search paths. Anonymous EXECUTE is denied, authenticated EXECUTE enabled.
- Same-organization course/stage composite FKs, program/stage/preference composite FKs, `courses_academic_tenant_key`, uniqueness and referential constraints verified in PostgreSQL.
- Before/after unchanged existing counts: 10 profiles, 2 organizations, 2 courses, 3 offerings and 3 enrollments. All five new tables initially contain zero rows; no seeded taxonomies were fabricated.

**Do not reapply this migration.** Git version `20261018203119` differs from remote history version `20261018210950` even though the SHA-256 exactly matches. All prior migration-version discrepancies remain unresolved; do not run `supabase db push`, `supabase migration up` or manual history repair without separately reviewed authorization. The code for 5B–5D and real authenticated end-to-end tests are still pending; no website/VPS deployment or production modification occurred.

This ledger-only commit will move the milestone branch past `2836416`; Codex must fast-forward its local branch before making further commits. No original SQL migration or historical database row is changed by recording this information.

## Milestone 6A development application — 2026-10-19

The exact locally audited M6A migration from source commit `b46faff6619e7bb0a664c0e9253a233140c3e231` was independently verified against the uploaded approved source and applied **once** to **development** Supabase project `gmvouqgjbtbkbhrdruzu` using the migration interface. Supabase returned `success: true`. No previous schema migration was replayed.

| Git migration file | Supabase applied version | History name | Stored SQL SHA-256 |
| --- | --- | --- | --- |
| `20261019004546_teacher_websites_public_catalogs.sql` | `20261019132423` | `teacher_websites_public_catalogs` | `e5588657408c7d56364e59cf7d423fb44ab3db073931da7b6a261e3e66149cec` |

Verified GitHub blob SHA: `ffb266022381ba1faa5b1bb1665fee3d9723adad`. The Git file has 34,903 UTF-8 bytes. It exactly matches the approved uploaded source.

**Read-only checks after applying:**
- Total recorded migrations **31**. The M6 history record's persisted SQL SHA-256 matches the source above.
- All **11 new tables** exist with RLS; the five new public-schema tables are authenticated SELECT-only and anonymous table SELECT denied. The six private-schema tables are inaccessible to anon/authenticated table reads/writes and have no permissive policies.
- Five contextual `website_staff_read` RLS policies exist on the new public-schema tables. The `website_public` projection schema exists; anon has USAGE on it, not on `private`.
- All **14 functions** exist: six private helpers/commands, three `website_public` projections and five public wrappers. Public anonymous projection wrappers grant EXECUTE to anon/authenticated; the teacher authoring wrapper denies anon and permits authenticated. Other trusted review grants require continued testing through the actual service boundary before any upload/DNS features are enabled.
- The `lms-website-assets` Storage bucket is **private**, limited to 2,097,152 bytes and PNG/JPEG/WebP. Existing permissive object policies apply only to earlier buckets and the broad `lms_trusted_identity` object policy is **RESTRICTIVE**, not an independent grant. No anonymous image delivery or browser upload route was enabled.
- Original record counts unchanged: 10 profiles, 2 organizations, 2 courses, 3 offerings, 3 enrollments; existing academic programs and stages unchanged (0). New website/publication/domain/asset tables and Storage object contents all start at 0.
- Security advisor: informational `rls_enabled_no_policy` includes the six intentionally deny-by-default private website tables; the prior native Supabase Auth leaked-password-protection warning remains (application uses Firebase). Performance advisor notes a new informational missing-FK-prefix index on `organization_websites(id,published_version_id)`; review during future performance tuning, not an authorization finding. Unused indexes on zero-row fresh tables are expected.

**Never reapply M6A.** Git version `20261019004546` and remote history version `20261019132423` differ. The **six** Git/remote version differences through M6 must be respected. Do not run `supabase db push`, `supabase migration up`, or history repair without separately approved reconciliation. No staging/VPS/production website, Caddy or external DNS/TLS change occurred. M6B editor, M6C public routes, M6D domain verifier and real authenticated/Storage acceptance remain pending.

This is a **ledger-only GitHub commit** made after source commit `b46faff6619e7bb0a664c0e9253a233140c3e231`; the Codex M6 worktree must fetch and **fast-forward** before developing M6B. Do not reset or force-push its local changes. The reviewed SQL and prior migrations remain unchanged.
