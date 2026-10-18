# Development Supabase migration reconciliation — 2026-10-18

This is an **audit ledger**, not a migration file, and is not permission for unreviewed schema changes.

- Target: Supabase **development only**, project ref `gmvouqgjbtbkbhrdruzu`.
- Source: integration candidate based on `3855e3a67a727df84c6a73b191fba6d9dc68a418`.
- Owner expressly approved applying **only** the Milestone 4 account/private-avatar migration after preflight.
- Connected schema now has **29 applied migrations**. The first 25 foundation versions already match their Git files.
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
Milestone 5A adds a **local pending** migration only; development remains at 29.

## Outstanding acceptance

The isolated validation at `3855e3a` passed 237 application tests, TypeScript, boundaries, lint (0 errors/10 warnings) and the production Docker build. It did **not** run a full SQL regression replay for the integrated tree or test connected Firebase sessions, onboarding, actual uploads and Storage read/delete, provider login, or desktop/mobile acceptance on the deployed website. Staging is still the previous `a544ced` release. Separate review and authorization are required before staging deployment; production is untouched.
