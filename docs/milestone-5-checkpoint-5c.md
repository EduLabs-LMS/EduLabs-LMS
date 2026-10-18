# Milestone 5 — Checkpoint 5C: student academic selection

Completed locally on 2026-10-19, on
`codex/milestone5-academic-programs-stages`, starting at
`20c014528fe5b0c7139dfb00984c5008c176f3ef` (completed 5B).
This report covers 5C only. No push, merge, deployment, connected mutation,
new migration, provider identity or real academic fixture was created.

## Implemented behavior

Home and Self Learning use a shared student academic selector alongside the
actual existing V2 components. Eligible students see their enrolled organizations,
teacher-defined active programs and active stages. Each program has an independent
saved preference. Students can save, change and explicitly clear it. Selection
is never inferred from enrollment. Reads always use the current authenticated
identity; preferences live in PostgreSQL rather than browser storage.

The default view is **All My Courses**. Students can explicitly choose their
selected stages plus general courses, or general courses alone. Filters operate
only on existing authorized course/offering IDs. The unchanged offerings and
assessment panels remain accessible, and individual course/lesson routes retain
their original authorization. Home's global progress totals remain based on all
authorized lessons, while its journey cards can be filtered. Lesson numbering,
offering-specific progress, covers, chapter ordering and existing lesson URLs
are preserved.

“General” means **no active classification visible to this student**, not a claim
that the course never had historical assignments. The existing RLS intentionally
hides archived taxonomy links from students. General courses therefore remain
included in the selected-stage view. Other stages remain available through the
prominent All My Courses button; filtering never changes learning permissions.

The selector includes loading, empty, saved, failed-read/retry and stale-write
states. A 409 retains the unsaved draft and blocks further saves until explicit
reload. Archived selections show a recovery warning; students may choose another
active stage or clear the preference. Archived program names are not fetched
through elevated privileges: recovery uses the student's own saved preference
and the label “Unavailable saved program.” Clearing retains the database version
tombstone and academic history.

Native labelled selects/buttons support keyboard interaction. Responsive panels
reuse the existing green/cream/black styles and bundled Figtree/Caprasimo fonts;
shared navigation, branding and animations are unchanged. Filtered empty results
do not falsely claim the teacher has not published lessons. Failed catalog reads
leave all existing authorized learning content visible with an explicit error.

## Security and database boundary

`GET/POST /api/student-academics` is narrowly allowlisted in Firebase middleware.
The handler requires the verified Firebase application viewer and uses the
existing caller-scoped Supabase integration. No service-role credentials or
browser-owned identity/role fields are accepted.

Student API eligibility derives from that identity's active, unexpired enrollment
in an active offering, published course and active organization. Future-dated
enrollments are excluded. Offering end dates do not independently revoke an
otherwise valid enrollment, preserving the established `private.is_enrolled`
policy. Staff membership alone does not qualify for this student interface.
The teacher API and contextual teacher permissions are unchanged.

Every read is RLS-scoped and explicitly bounded. More than 500 enrollments,
programs, stages or preferences yields a recoverable overview-size error rather
than silently treating truncated data as empty. Classification reads are batched
over at most 50 authorized courses, with a 2,500-link bound per batch. Broader
catalog pagination is a future scaling improvement, not hidden partial success.

Writes accept only program UUID, nullable stage UUID and safe integer revision.
The organization is derived from an authorized active program, or from an own
saved preference when clearing an archived program. The existing identity-bound
`set_student_stage_preference` RPC rechecks tenant/program/stage eligibility,
current identity, permissions and revision under its existing concurrency locks.
There are no enrollment, membership, role or publication writes.

POST requires exact-origin CSRF validation, JSON content type, no query string,
and a streamed 2 KB maximum body. GET rejects unknown/duplicated parameters.
Responses are private/no-store, vary on Cookie, and sanitize database failures.
The TypeScript RPC argument now correctly represents SQL's nullable stage input;
this is a typing correction, not a schema change.

## Connected development verification (read-only)

Project `gmvouqgjbtbkbhrdruzu` still has **30 migrations**. Stored 5A SQL at
remote version `20261018210950` matches the exact approved checksum:

```text
19EE37C9462E7879B987F013928EF41066E23620E5BBD2226353DD2F5152F8BD
```

Local file: `supabase/migrations/20261018203119_academic_programs_stages.sql`.
All 30 source migration blobs remain unchanged. The migration ledger's five
Git/remote timestamp mappings remain applicable; no replay or history repair ran.

Read-only catalog verification confirmed RLS on the four public academic tables,
authenticated SELECT and no direct UPDATE. The preference RPC remains public
invoker/private definer, both with empty search paths, authenticated EXECUTE and
no anonymous EXECUTE. No connected records, functions, policies or grants changed.

## Actual verification results

| Check | Result |
| --- | --- |
| All application tests, serial execution | **265 passed**, including 13 new student academic tests |
| Strict TypeScript | Passed, no memory-exhausted run counted as passing |
| Architecture boundaries | Passed |
| ESLint | 0 errors, the same 10 existing warnings |
| Disposable native PostgreSQL replay | All 30 migrations, all **20 SQL suites passed** |
| Academic SQL suite | **101 assertions passed** |
| Independent-session concurrency | All **96 cases passed**, including the existing 12 academic cases |
| Chromium actual-component workflows | **12 scenarios passed**, no page exceptions or horizontal overflow |
| Whitespace/migration/secret audit | Passed |

New application tests cover enrollment-only eligibility, two independent students
in different organizations, forbidden forged scopes, expiry/suspension/future
enrollment, unpublished courses, post-offering-end policy preservation, own
preference persistence, clear/version conflicts, archived recovery, another
student's saved records, truncated/failed data, multi-program/general discovery,
CSRF/session/mode checks, request bounds and actual Home/Self Learning wiring.

Existing native SQL tests exercise real PostgreSQL RLS, distinct students and
tenants, same-program/tenant constraints, multi-program persistence, archival,
identity/enrollment revocation and no enrollment elevation. Existing independent
database sessions cover conflicting preference saves, clear/archive races and
revocation under locks. No database logic changed, so no new race mechanism or
SQL suite was required. Exams, Lessons, Homework, Groups, Notifications, Support,
student administration, teacher taxonomy and account suites all passed.

Chromium renders the actual selector, StudentHome, SelfLearningView, lesson cards,
Tailwind theme and fonts. HTTP catalog/persistence, identity and group hooks are
explicitly synthetic adapters. Scenarios cover save/refresh, independent programs,
filter/all-course recovery, desktop/mobile, stale draft recovery, archived stage
and program clearing, failed reads, genuine empty data, keyboard focus, original
lesson links, preserved Home totals and accurate no-match empty states.

**This does not prove real Firebase login/logout/session restoration or connected
Supabase browser persistence.** No provider accounts or connected mutation were
authorized for this checkpoint. Those end-to-end gates remain for separately
authorized 5D acceptance. Firefox/WebKit, load tests and production builds were
not run in 5C; production builds remain the explicit 5D integration gate.

The first browser iterations exposed a test locator that omitted existing
formatted module titles and a test waiting for an old select before a completed
save. The harness was corrected to use actual rendered titles and await the
updated value. The final run passed all scenarios; failed runs are not counted.

Reproduction (PowerShell, from the milestone worktree):

```powershell
$testFiles = ((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test -split ' ') | Select-Object -Skip 2
node --test --test-concurrency=1 @testFiles
npm run check:boundaries
npm run typecheck
npm run lint
$env:LMS_SQL_RUNTIME = '<existing local pg/PostgreSQL runtime node_modules>'
node scripts/exam-sql-local.cjs --postgres
$env:LMS_BROWSER_RUNTIME = '<existing Playwright/esbuild node_modules>'
$env:LMS_COMPONENT_FONT_BUILD = '<existing Next build with bundled fonts>'
node scripts/student-academics-browser-components.cjs
```

Local SQL used an owned loopback cluster and a random disposable database.
Cleanup verified zero owned databases remaining, then stopped only that cluster.
Browser contexts and the local component server were closed. No remote fixtures,
Storage objects, credentials or provider accounts require cleanup.

## Screenshots (component acceptance, not provider acceptance)

- [Home desktop](evidence/milestone5c/home-desktop.png)
- [Home mobile](evidence/milestone5c/home-mobile.png)
- [Self Learning desktop](evidence/milestone5c/self-learning-desktop.png)
- [Self Learning mobile](evidence/milestone5c/self-learning-mobile.png)

## Next checkpoint

5C requires **no new database work**. Stop for owner review. 5D remains: full
integration/build verification, explicitly authorized real authenticated browser
acceptance and a draft PR against `integration/milestone4-candidate`. No protected
branch, PR #13/#14, staging service or production configuration was modified.

## Changed files

- `app/(dashboard)/_components/website-pages.tsx`
- `app/api/student-academics/route.ts`
- `frontend/features/dashboard/student-home.tsx`
- `frontend/features/self-learning/academic-selection.tsx`
- `frontend/features/self-learning/student-learning.tsx`
- `middleware.ts`
- `package.json`
- `scripts/student-academics.test.cjs`
- `scripts/student-academics-browser-components.cjs`
- `server/http/student-academics.ts`
- `server/services/student-academics.ts`
- `shared/contracts/student-academics.ts`
- `shared/contracts/database.types.ts`
- `docs/milestone-5-checkpoint-5c.md`
- `docs/evidence/milestone5c/home-desktop.png`
- `docs/evidence/milestone5c/home-mobile.png`
- `docs/evidence/milestone5c/self-learning-desktop.png`
- `docs/evidence/milestone5c/self-learning-mobile.png`
