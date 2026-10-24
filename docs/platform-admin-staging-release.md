# Platform Admin V1: staging release plan

Status: release candidate prepared; nothing has been applied, deployed or approved on staging.
Everything below is a plan for the owner to review. The staging manager, Supabase, Firebase and
Cloudflare were not touched while preparing it.

## What is being released

- Branch `claude/admin-provisioning-v1`, based on the clean foundation `d3451e5` (student V2 design,
  Continue Learning and the sign-in/splash fixes intact; teacher presentation screens remain retired).
- One new migration: `supabase/migrations/20261024120000_platform_admin_teacher_provisioning.sql`
  (migration number 32). The 31 existing migration files are byte-identical to the approved baseline.
  The exact SHA-256 is recorded in the release report and in `supabase/migrations/` checksums; the
  manager hashes the Git blob (`git archive`), so `.gitattributes` marks the file `-text` like the
  other pinned migrations, and the hash must always be taken from `git show <sha>:<path>`, not a
  Windows working copy.
- The migration is additive. Replayed on a disposable PostgreSQL 17 database over the 31 baseline
  migrations it changes no existing column, function, policy, grant, constraint or trigger; it adds
  4 tables (`private.platform_admins`, `private.teacher_invitations`, `private.platform_audit`,
  `public.academic_subjects`), 21 functions, 1 policy, 4 triggers, and two nullable columns
  (`courses.subject_id`, `academic_programs.examination_board`). It seeds no administrator and
  copies no data.

## Behaviour before the migration is applied

Only `/platform-admin/**`, `/api/platform-admin/**` and `/api/teacher-invitations/accept` use the new
objects. Before the migration, `is_platform_admin` does not exist, so the guard answers the same 404
as an unknown route (and the invitation accept endpoint reports "unavailable"). Student, teacher and
other staff flows never reference the new objects. No page links to `/platform-admin` for non-admins.

## Proposed activation order (each step needs separate owner approval)

1. Push the reviewed branch (done in the release checkpoint) and run, on the VPS,
   `sudo edulabs-staging validate claude/admin-provisioning-v1`. It builds and tests in a
   network-isolated container and reports the 32nd migration as "NOT APPROVED"; it never switches the
   running site. It must say `NOT DEPLOYABLE YET: review/apply migration separately`.
2. Capture evidence (read-only): remote migration history is exactly the 31 expected versions
   (`select version,name from supabase_migrations.schema_migrations order by version`), and the
   platform tables/functions listed above do not already exist.
3. Take a restore point: confirm a Supabase backup/PITR point exists and note its timestamp.
4. Apply migration 32 once, from the exact reviewed file bytes (SQL editor or `supabase db query`
   as the database owner). The file is its own `begin; ... commit;`, so a failure leaves nothing
   behind. Do not use `supabase db push`, which would also try to reconcile history. Record the remote
   version assigned (earlier migrations have remote versions that differ from file names).
5. Verify read-only: 32 history rows with the new one last; the four tables exist with RLS enabled;
   `anon` and `authenticated` hold no table privileges on the three `private.*` tables;
   `select count(*) from private.platform_admins` is 0.
6. Extend the manager's schema approval to the 32nd migration (next section), then
   `schema-status`, `plan claude/admin-provisioning-v1`, `deploy claude/admin-provisioning-v1`.
7. Only after deployment and owner acceptance: bootstrap the first platform administrator with
   `supabase/manual/bootstrap_platform_admin.sql` (a trusted-operator action, never in a migration).

## Rollback

- Application: `sudo edulabs-staging rollback` (code-only). The manager's rollback does not re-check
  migrations, and the additive schema is invisible to the previous image (`d96c40e`), so the previous
  application keeps working with migration 32 applied.
- Database: `supabase/manual/rollback_platform_admin_provisioning.sql`. It refuses, changing nothing,
  if any administrator, invitation, audit record, subject, course subject reference or examination board
  exists. Tested on a disposable database: after it runs the catalog equals the 31-migration baseline
  exactly, and re-applying the migration reproduces the first application exactly. The operator must
  also delete the new row from the remote migration history, and restore
  `/etc/edulabs/staging-build/migrations.json` from its `schema-baseline-backups/` copy.
- Once real portals or invitations exist there is deliberately no automatic rollback: use the
  restore point and a reviewed forward fix.

## Staging manager v1.4.0: what it enforces today

Source: the installed executable is byte-identical (SHA-256 `0c908c9f5d17d4c65972e0c1a320974a241b617cf0ea4b109e78792081d18724`)
to the reviewed `edulabs-staging` in the v1.4 package.

- `validate` accepts added migration files but reports them "not approved"; `plan`/`deploy` call
  `verify_migrations` without additions, so a branch with 32 files is refused with
  `Migration mismatch` until the pinned baseline `/etc/edulabs/staging-build/migrations.json` contains
  the new file's hash.
- `approve-schema` cannot approve migration 32: it is hard-wired to branch `integration/staging`,
  commit `dbd93662eab1a01a38f23642390cd1790acd066c`, exactly 31 files and exactly three named
  additions. The v1.4 README states a 32nd migration needs another separately reviewed approval revision.
- The manager cannot query Supabase migration history; the operator verifies it independently.
- `deploy` itself accepts any pushed branch (it does not require `integration/staging`), so the feature
  branch can be deployed without merging it anywhere, once the baseline matches.
- The manager's own validation runs `npm test`, typecheck, lint and boundaries on Linux in Docker
  with no network. That Linux run was not performed locally (no Docker daemon); the same checks pass
  here on Windows and on a clean `git archive` of the release commit.

## Proposed manager v1.5 (not implemented, not installed)

A deliberately narrow revision, delivered like v1.4 (package with `upgrade.sh --check`, offline tests):

1. Pin, in source, a second reviewed approval: filename, SHA-256, the exact release commit SHA, the
   source branch name (`claude/admin-provisioning-v1`), the staging Supabase project and a new command
   `approve-schema-admin`. No generic "approve additions" switch.
2. Preconditions it enforces: the current baseline is exactly the 31 approved hashes (the full manifest
   hash is embedded and compared, including the three v1.4 entries); the fetched commit equals the pinned
   SHA and the remote branch head; the checkout has exactly 32 migration files and the only difference
   from the baseline is the pinned file with the pinned hash; `build_settings()` confirms project
   `gmvouqgjbtbkbhrdruzu` and Firebase `diagonproduction`; app and Caddy healthy.
3. Remote history stays operator-verified (the manager holds no database credential and should not gain
   one). The operator passes the remote version they recorded in step 4 as an argument; it is shown in the
   prompt and written to the history event. The typed confirmation is
   `APPROVE SCHEMA <commit> <migration-sha256-prefix>`.
4. Atomic write with a timestamped backup of `migrations.json` (same as v1.4), history event, no SQL, no
   image or Compose change, no restart.
5. Upgrade safety (same pattern as v1.4's `upgrade.sh`): requires the installed binary to be exactly
   v1.4.0 (`0c908c9f...`), healthy app/Caddy, a 31-file baseline, flock, offline tests; backs up the
   installed executable, replaces it atomically, runs `doctor` and CLI smoke tests, and restores the
   backup automatically if either fails. Manual restore: copy the
   `/var/lib/edulabs-staging/manager-backups/edulabs-staging-before-v1.5-*` file over
   `/usr/local/sbin/edulabs-staging`.
6. Offline tests to add: wrong hash, extra or missing file, edited historical migration, wrong project,
   wrong commit, moved branch, canceled prompt, partial baseline, non-TTY, re-run is a no-op.

Read-only inspection commands for the operator (nothing here changes the VPS):

```bash
sudo edulabs-staging status
sudo edulabs-staging schema-status
sudo sha256sum /usr/local/sbin/edulabs-staging
sudo python3 -c "import json;d=json.load(open('/etc/edulabs/staging-build/migrations.json'));print(len(d));print(*sorted(d.items()),sep='\n')"
sudo ls -l /var/lib/edulabs-staging/schema-baseline-backups /var/lib/edulabs-staging/manager-backups
sudo tail -n 20 /var/lib/edulabs-staging/history.jsonl
```

## Compatibility with the running commit (`d96c40e`)

Deploying this branch replaces the running application. The deployed commit is the clean base plus the
teacher redesign, the "shared look" restyle of student/admin screens and a few display-only helpers. This
candidate intentionally does not include those. See the release report for the file-level comparison.
