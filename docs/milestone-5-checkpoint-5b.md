# Milestone 5 — Checkpoint 5B: teacher academic management

Date: 2026-10-19. Branch: `codex/milestone5-academic-programs-stages`.
Status: **implemented and locally validated; ready for 5C**.

## Source and database checkpoint

Read the full milestone contract, 5A report and development ledger before coding.
The feature started from `283641662ae057b6d6beea00eef8ee2b259a0a00` and was
safely fast-forwarded to the remote's documentation-only application record
`d134b0fe5612bde0cfedbf128816b81b0317bf5a` before this checkpoint commit.
Uncommitted implementation was preserved/restored with a named task stash.
There was no merge commit, protected-branch update or PR merge.

Read-only inspection of development project `gmvouqgjbtbkbhrdruzu` confirmed:

- **30 applied migrations**; 5A recorded as `20261018210950_academic_programs_stages`.
- Stored SQL SHA-256 exactly matches reviewed Git file
  `20261018203119_academic_programs_stages.sql`:
  `19EE37C9462E7879B987F013928EF41066E23620E5BBD2226353DD2F5152F8BD`.
- All five expected tables exist with RLS. Authenticated has SELECT-only access
  to the four public tables and no direct private version-ledger access.
- The three public invoker RPCs and private definers retain restricted grants
  and empty search paths. All eight live function bodies were compared with
  the reviewed source and match. All four SELECT policies and seven composite/
  identity foreign keys were inspected.

The ledger records this fifth Git/remote timestamp mapping. No migration was
replayed/applied, no schema/grant/provider configuration changed, and no remote
fixtures were created. All 30 migration files remain unchanged in 5B.

## Implemented experience

### Existing teacher dashboard

The existing Teaching tools and course-management page link to
`/teacher/programs`, inside the existing teacher layout. This is not a second
dashboard or a tenant per academic stage. Legacy Clerk mode redirects this new
Firebase-only page to its existing teacher courses page.

Active staff can choose among their authorized organizations. Owners/admins
create, edit, archive and restore programs/stages. Other active staff have a
read-only taxonomy view; assigned contextual course editors still classify
their own courses. There is no global teacher shortcut or staff-role mutation.

Programs and stages support teacher-defined titles, explicit stable slugs,
optional plain-text descriptions, status and integer order. Ordering is edited
as a numeric position, not a new drag/drop redesign; equal values retain the
database's stable ID tie-break. Duplicate titles are allowed with distinct
slugs; duplicate slugs return a useful 409. Names are not used as identity keys.

The program/stage lists paginate 50 rows at a time. Archived entries remain
visible to staff with clear status. Archived parents block adding/reactivating
stages as required by 5A. Empty, loading and failed-response states are distinct;
failed reads never become an empty success. Switching organizations clears old
selection/form state, aborts old requests and prevents stale response display.

### Existing course editor

A new V2 panel classifies a course into up to 50 stages across multiple programs
of its own organization. Program/stage choices paginate without losing selected
IDs. The saved classification explicitly displays **Unassigned** when empty.
Existing unclassified courses are not hidden or automatically assigned.

Classification has its own optimistic version, independent of course metadata,
publication, offerings, enrollments, lesson progress and academic history. A
409 retains the draft; the teacher explicitly discards/reloads before retrying.
Archival does not silently remove saved links. Archived selections are labelled
and must be explicitly removed before a new assignment save, or restored in
management. An empty saved selection deliberately clears classification.

Green/cream/black V2 styles, established Figtree/Caprasimo typography and existing
navigation remain intact. No shared branding, animation, auth/session or
student navigation component was redesigned.

## API and authorization

`GET` and `POST /api/teacher/academics` are narrowly allowlisted in Firebase
middleware. The handler checks the mode and verified Firebase application
viewer, validates every scope/ID/query/body, applies exact-origin CSRF to writes,
and uses private/no-store responses. POST accepts JSON only, bounded to 16 KB;
query parameters cannot be duplicated; pages and arrays are bounded; unknown
and identity/privilege fields are rejected.

Read kinds are `programs`, `stages` and `classification`. The service uses the
existing caller-scoped Supabase client, checks active membership and active
organization, binds parent-stage reads to the requested organization/program,
and checks course identity plus existing contextual edit permissions for
classification. It never uses a service-role client.

Writes call only `academic_command`, passing the validated organization,
action, entity, current revision and allowlisted metadata. The database remains
authoritative and revalidates permissions under its locks. Students cannot use
this teacher endpoint, including when they can read taxonomy via enrollment.
There is no preference/enrollment/role mutation action in this handler.

SQL errors are sanitized: stale writes and duplicate slugs produce 409,
forbidden/unavailable scoped targets 403, malformed data 400, transient lock
contention 503 with a clear retry message, and unknown failures a generic 503.
Raw database statements/stacks are not returned. Incomplete classification
detail responses fail visibly instead of being labelled Unassigned.

Type definitions for the four new public tables were extracted from the
development type generator; the three RPC signatures were added while retaining
existing application-specific type definitions.

## Actual validation

| Check | Result |
| --- | --- |
| Application test file list, serial execution | **252 passed**, including 15 new contract/service/HTTP tests |
| Strict TypeScript (`tsc --noEmit`) | **Passed** |
| Architecture boundaries | **Passed** |
| ESLint | **0 errors, 10 existing warnings**, no new warnings |
| Native disposable PostgreSQL | All **30 migrations replayed**, all **20 SQL suites passed** |
| Academic SQL tests | **101 assertions passed** |
| Independent-session concurrency | **96 cases passed**, including 12 academic cases |
| Preservation during 5A replay | 72 existing table/data/RLS/grant baselines, 196 function definitions/grants and 112 policies preserved |
| Chromium desktop/mobile component workflows | **10 scenarios passed**, no page exceptions or horizontal overflow |
| Migration/secret/whitespace audit | Passed; no SQL or environment changes |

The application checks ran the same test-file list as `npm test`, with
`--test-concurrency=1`, followed by boundaries, strict TypeScript and lint.
No exhausted process is counted as a pass. The first strict TypeScript run
identified three real ES5 iterator-spread errors; those were fixed using
`Array.from`, and subsequent strict compilation plus the complete check stages
completed successfully. The 5A memory-blocked status is historical.

New unit tests cover strict payloads, parent immutability, tenant/role checks,
contextual course editors, direct unauthorized writes, exact RPC scope/version,
bounded deterministic pagination, incomplete data, sanitized errors, CSRF,
unauthenticated/legacy-mode requests, invalid/oversized JSON, forged fields and
duplicate query parameters. SQL tests cover actual database RLS/forged
references, archival, enrollment/identity revocation and lock/stale-write races.

Browser tests bundle the **actual components, theme and fonts**, but use an
explicitly fictional HTTP adapter. They verify program/stage creation, edits,
ordering, archival/restoration, refresh persistence in fixture state, 409 draft
recovery, organization switching, genuine empty versus failed reads, retry,
read-only staff presentation, multi-program assignment, explicit clearing,
archived assignment handling, pagination, keyboard focus and overflow.

**These are not real Firebase-authenticated/Supabase browser acceptance tests.**
No real teacher/student data, provider account or connected Storage object was
used. Firefox/WebKit and load testing were not run. Full production builds and
connected end-to-end acceptance remain part of 5D; they are not claimed here.

Reproduction:

```powershell
$testFiles = ((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test -split ' ') | Select-Object -Skip 2
node --test --test-concurrency=1 @testFiles
npm run check:boundaries
npm run typecheck
npm run lint
$env:LMS_SQL_RUNTIME = '<optional local PostgreSQL/pg runtime node_modules>'
node scripts/exam-sql-local.cjs --postgres
$env:LMS_BROWSER_RUNTIME = '<existing Playwright/esbuild node_modules>'
$env:LMS_COMPONENT_FONT_BUILD = '<existing local Next build directory>'
node scripts/academics-browser-components.cjs
```

This run used the existing optional tool runtimes and bundled local font build.
No dependencies, environment files, public configuration or credentials were
changed. SQL fixtures were isolated to a random loopback database, dropped in
the harness cleanup. Zero owned databases remain and the task-owned cluster is
stopped. Browser contexts/server were closed. No remote fixtures need cleanup.

## Screenshots

Sanitized actual-component renders, not evidence of connected authentication:

- [Programs desktop](evidence/milestone5b/programs-desktop.png)
- [Programs mobile](evidence/milestone5b/programs-mobile.png)
- [Course assignment desktop](evidence/milestone5b/course-stages-desktop.png)
- [Course assignment mobile](evidence/milestone5b/course-stages-mobile.png)

## Remaining work for 5C and 5D

5C: student program/stage selection per program and identity; recovery for
archived choices; authorized Home/Self Learning discovery/filtering that retains
all independently enrolled and unassigned offerings; responsive interaction and
isolation tests. Do not turn a selection into enrollment or staff membership.

5D: full integration checks/builds, explicitly authorized real authenticated
acceptance, and a draft PR targeting `integration/milestone4-candidate`. No PR,
push, merge, staging deployment or production change was performed in 5B.

## Changed-file inventory

The commit contains only the new academic teacher UI/API/contracts/tests/types,
small existing teacher entry-point/middleware changes, sanitized evidence and
this report/ledger clarification. The exact paths are listed below.

- `app/(dashboard)/(routes)/teacher/programs/page.tsx`
- `app/(dashboard)/_components/website-pages.tsx`
- `app/api/teacher/academics/route.ts`
- `docs/development-db-migration-ledger.md`
- `docs/evidence/milestone5b/course-stages-desktop.png`
- `docs/evidence/milestone5b/course-stages-mobile.png`
- `docs/evidence/milestone5b/programs-desktop.png`
- `docs/evidence/milestone5b/programs-mobile.png`
- `docs/milestone-5-checkpoint-5a.md`
- `docs/milestone-5-checkpoint-5b.md`
- `frontend/features/teacher/academics/course-stages.tsx`
- `frontend/features/teacher/academics/program-workspace.tsx`
- `frontend/features/teacher/courses/course-editor.tsx`
- `frontend/features/teacher/courses/course-list.tsx`
- `frontend/lib/academics.ts`
- `middleware.ts`
- `package.json`
- `scripts/academics-browser-components.cjs`
- `scripts/academics.test.cjs`
- `server/http/academics.ts`
- `server/services/academics.ts`
- `shared/contracts/academics.ts`
- `shared/contracts/database.types.ts`
- `shared/website-routes.ts`
