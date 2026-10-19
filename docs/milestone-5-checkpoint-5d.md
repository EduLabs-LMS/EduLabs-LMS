# Milestone 5D — integration and release candidate

Date: 2026-10-19 (Africa/Cairo).
Branch: `codex/milestone5-academic-programs-stages`.
Stacked target: `integration/milestone4-candidate` at
`d264556480d81f64f3c3e5cc6fce84f7c9bbabdb` (draft PR #14).

**Ready for draft integration review, with real-provider acceptance pending.**
Local automated verification and both production builds passed. This is not
production-launch or deployment approval. No connected mutating acceptance ran.
The final delivery HEAD is recorded by the draft PR and delivery response; the
exact tested implementation commit is
`643e10fd2931fb8b02f389bc850df998cd27225b`.

## Preserved history and implementation

| Checkpoint | Commit |
| --- | --- |
| Plan | `06544439fe2c056793e72a34c275689931c11638` |
| 5A schema and local SQL proof | `283641662ae057b6d6beea00eef8ee2b259a0a00` |
| Development application ledger | `d134b0fe5612bde0cfedbf128816b81b0317bf5a` |
| 5B teacher management | `20c014528fe5b0c7139dfb00984c5008c176f3ef` |
| 5C student selection | `eccce464a4b09e1f0766743009baf5a444dbbcbb` |
| 5D integration corrections | `643e10fd2931fb8b02f389bc850df998cd27225b` |

All checkpoints are additive descendants of the existing Milestone 4 candidate.
No commit was reset, rebased, replaced or omitted. Before delivery the remote
milestone branch was `d134b0f`; fetching confirmed it was an ancestor of local
HEAD with no remote-only commits. Only the milestone branch is authorized for
normal push. The draft targets the candidate, not live staging or main.

The milestone adds same-organization programs, ordered stages, many-to-many course
classification and private per-student/per-program preferences. Teacher management
lives in the existing dashboard/course editor. Student Home/Self Learning reuse
the existing V2 components and offer All My Courses, selected-stage discovery and
general content. Classification and preference writes never create enrollments,
memberships or permissions and never publish content.

## Audit findings and narrow corrections

1. Student assignment reads previously requested up to 2,501 rows per 50 courses.
   PostgREST's normal 1,000-row ceiling could clip that response without tripping
   the application's larger bound, misclassifying omitted links as general.
   Reads now use ten courses and a 501-row sentinel, deterministic course/stage
   ordering and the existing 500-row complete-response check. The RPC permits at
   most 50 assignments per course. Overflow produces an error, not a false empty
   category. A new test verifies multiple batches and overflow rejection.
2. Course-classification editor state now remounts on organization/course identity.
   A previous course's draft/version cannot carry into a reused editor instance.
   Actual Chromium navigation regression verifies the old selection disappears.
   Student discovery state similarly resets on organization scope changes.
3. Teacher POST rejects unexpected query strings, matching the student endpoint's
   strict contract. Unknown status-bearing errors return a generic 503 rather than
   their internal message. Regression tests cover both cases.

These changes require no new SQL or permission changes. The earlier 5C description
of 50-course/2,500-link batches is historical and is superseded by correction 1.
No redesign or new feature was introduced.

Reviewed integration paths include the teacher route/editor/list, student Home and
Self Learning, offering-specific lesson projections/progress, route allowlists,
verified Firebase viewer resolution, caller-scoped Supabase and RPC wrappers.
Milestone 4 auth/session/account sources, Exams, Lessons, Homework and Groups
implementation files are unchanged from the candidate. Their application/SQL
regressions and migration preservation checks passed.

## Verification actually executed

| Check | Result |
| --- | --- |
| Complete application test list, serial execution | **269 passed**, 0 failed/skipped |
| Strict TypeScript, including independent final non-incremental run | Passed |
| Architecture boundaries | Passed |
| ESLint | 0 errors, 10 existing warnings |
| Native loopback PostgreSQL upgrade replay | All **30 migrations** passed |
| SQL regression suites | All **20 passed**; academic suite **101 assertions** |
| Independent-session concurrency | All **96 passed**, including 12 academic races |
| Firebase/Supabase production build | Passed, generated all 30 static pages |
| Clerk/Prisma fallback production build | Passed, generated all 30 static pages |
| Chromium teacher actual-component workflows | **11 passed** |
| Chromium student actual-component workflows | **12 passed** |
| Browser exceptions / horizontal overflow | None at desktop 1440 and mobile 390 |
| Migration integrity, changed-file secret audit, whitespace | Passed |

Application checks ran the unchanged `npm test` file list with
`--test-concurrency=1`, followed by boundaries, strict compilation and lint.
Four focused 5D regressions increase 265 tests to 269. No memory-exhausted,
skipped or failed process is counted as passing.

The SQL harness preserved 72 existing table/data/RLS/grant baselines, 196 existing
function definitions/grants and 112 policies across migration 30. Real PostgreSQL
tests cover same-tenant constraints, independent students, cross-tenant denial,
anonymous/forged writes, scoped editors, unpublished-course access, own-only
preferences, multiple programs, archive/clear recovery and no enrollment changes.
Concurrent database sessions cover stale taxonomy/classification/preference writes,
archive versus selection, revoked membership/enrollment/identity and lock ordering.
No SQL changes were made in 5D, so existing 96 race cases remain sufficient.

Both builds used the actual source and protected Next configuration, with ignored
launchers changing only backend selectors, one-worker compilation, isolated output
directories and temporary extending tsconfigs. Root `strict: true` was retained;
Next's generic “Strict-mode is set to false by default” diagnostic did not change
the root config. Existing Tailwind ambiguity and native-image lint warnings remain.
Builds loaded existing local configuration into process memory; no environment or
credential files were copied or committed. Both build processes exited zero.

An additional isolated production-runtime smoke check verified Firebase-mode
health 200, sign-in 200, unauthenticated student/teacher APIs 401 and cross-origin
preference POST 403. Its local process was stopped afterward. Legacy health/startup
passed, but legacy sign-in returned **500 because local Clerk keys are missing**.
Authenticated legacy runtime is **BLOCKED by configuration**, not reported as a
passing acceptance check. The fallback build passed; no Clerk credentials were
invented, searched for elsewhere or configured and no legacy auth code was changed.

The component browsers use actual V2 React components, theme and bundled fonts
with fictional HTTP and identity/group adapters; nonlocal requests are blocked.
They verify discovery, correct links, progress preservation, multiple programs,
conflicts, archived recovery, error/retry/empty states, keyboard access, teacher
permissions/pagination and editor scope changes. **They are not real Firebase or
connected Supabase acceptance.** Firefox/WebKit and load testing were not run.

## Database reconciliation and security review

Read-only MCP verification of development `gmvouqgjbtbkbhrdruzu` confirmed exactly
**30 applied migrations**. Milestone 5A is recorded as
`20261018210950_academic_programs_stages`; local source remains
`supabase/migrations/20261018203119_academic_programs_stages.sql`.

Exact stored/local SHA-256:

```text
19EE37C9462E7879B987F013928EF41066E23620E5BBD2226353DD2F5152F8BD
```

All 29 pre-milestone Git migration blobs and the reviewed 5A file are unchanged.
The ledger's five timestamp mappings remain in force, including the two earlier
LF/CRLF distinctions. No replay, migration repair, connected fixture or record
mutation occurred. Do not run `supabase db push` against this history.

Live schema verification confirmed:

- All eight academic function-body hashes equal the reviewed migration bodies.
- Public wrappers are invoker; private helpers/commands are definer with empty
  search paths. Anonymous EXECUTE is denied; authenticated EXECUTE remains scoped
  by verified identity and contextual checks, not email/global role claims.
- All five new tables have RLS. Four public tables permit authenticated SELECT
  only; the private version ledger has no authenticated table access.
- Four SELECT policies preserve tenant visibility and own-only preferences;
  seven foreign keys enforce organization/program relationships.
- Writes retain database authorization/revision revalidation under locks. No
  service-role client, public catalog, self-enrollment or organization creation
  permission was introduced.

HTTP checks cover exact-origin CSRF, JSON-only bounded bodies, unknown/duplicate
query rejection, allowlisted IDs/fields and sanitized failures. All My Courses
retains independent enrollment access. Filters do not alter server routes,
offering permissions or progress. Archived/missing choices recover without
deleting learning history. No unresolved privilege escalation was found in this
milestone. This audit is not a claim of a complete platform penetration test.

The native disposable database was dropped after the harness completed; cleanup
then verified zero owned databases and stopped only the task-owned cluster.
Component and runtime servers/browser contexts were closed. No remote cleanup is
required. Immutable local logs/build artifacts remain Git-ignored under `.local/`.

## Screenshot evidence

Fresh 5D renders below are byte-identical to the committed evidence, so duplicate
binary copies were not added:

- [Teacher desktop](evidence/milestone5b/programs-desktop.png)
- [Teacher mobile](evidence/milestone5b/programs-mobile.png)
- [Student Self Learning desktop](evidence/milestone5c/self-learning-desktop.png)
- [Student Self Learning mobile](evidence/milestone5c/self-learning-mobile.png)
- [Student Home desktop](evidence/milestone5c/home-desktop.png)
- [Student Home mobile](evidence/milestone5c/home-mobile.png)

These are component evidence with synthetic data, not screenshots of an approved
deployment or real authenticated account.

## Pending real Firebase/Supabase acceptance — executable procedure

**Status: NOT EXECUTED; separate explicit authorization required.**

Prerequisites before mutation:

1. Approve an exact candidate SHA and either an isolated localhost HTTPS server
   running that build or a separately approved staging deployment. An older
   deployment does not verify this candidate. Do not change live staging implicitly.
2. Confirm Firebase `diagonproduction` and Supabase `gmvouqgjbtbkbhrdruzu` as the
   approved disposable-testing targets. Record sanitized baseline counts, all 30
   migration versions and the academic SQL checksum before any account creation.
3. Approve manifest-owned synthetic identities: A owner/admin, A assigned course
   editor, two distinct A students and a B owner/student control. Use controlled
   test inboxes with actual verification links, or separately approve Admin-
   provisioned verified reserved-domain fixtures. The latter does not test real
   email delivery. Passwords, tokens and Firebase UID details stay in protected
   ignored manifests, never this report or the PR.
4. Provide the existing protected Firebase Admin credential **path**, not its
   JSON contents, only to the trusted fixture/server process. Normal browser login
   and the verified onboarding/provision/session flow must create identity mappings;
   do not insert fake mappings or associate identities by email.
5. Approve trusted atomic tenant/initial-owner provisioning and exact synthetic
   academic setup/cleanup. A needs published courses in two stages plus a general
   course, active offerings/enrollments, a published lesson with known progress,
   and an inaccessible draft lesson/course. B needs private controls. Use no real
   student records. Organization self-service remains revoked. Assigned editors
   classify only permitted courses; owner/admin manage taxonomy.

Required local environment variable names: `NEXT_PUBLIC_AUTH_BACKEND`,
`LMS_DATA_BACKEND`, `APP_ORIGIN`, `NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
`NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`.
Retain any already-required server attestation configuration in protected local
configuration. Do not share `.env` or service-account files.

For a newly approved local run from the exact candidate checkout, configure
existing protected credentials without printing them, then in PowerShell:

```powershell
$env:NEXT_PUBLIC_AUTH_BACKEND = 'firebase-staging'
$env:LMS_DATA_BACKEND = 'supabase-staging'
$env:APP_ORIGIN = 'https://localhost:3199'
npm run build
npm run start -- -H localhost -p 3198
```

Supply a separately approved loopback HTTPS proxy from `https://localhost:3199`
to that server; do not expose the port to the Internet. Keep the exact origin for
CSRF and Secure cookies. Use fresh isolated browser contexts at 1440x1000 and
390x844. No provider settings need changing if localhost is already authorized;
stop and report missing provider prerequisites rather than modifying them.

Run these steps using normal navigation and real Firebase sessions:

1. A owner signs in, confirms contextual STAFF and opens `/teacher/programs`.
   Create two named programs and two stages in each, set ordering, edit metadata,
   and refresh. Verify actual authorized GET responses, not intercepted fixtures.
2. Open `/teacher/courses/<owned-course-id>` and assign stages across both programs;
   keep the general course unassigned. Verify no publication/enrollment changes.
   Assigned editor can classify the permitted course but cannot administer taxonomy
   or edit another teacher's course.
3. Student A1 signs in, opens `/home` then `/self-learning`, sees only legitimately
   enrolled organizations and no inferred stage. Save a stage for each program;
   confirm real `POST /api/student-academics` and subsequent GET preferences.
4. Refresh, sign out, confirm protected-route/API rejection, sign back in and
   verify both preferences restore. Change one; ensure the other is unchanged.
   Clear one and verify the stored revision advances and the choice stays cleared.
5. Select My selected stages & general. Verify expected authorized lessons, real
   lesson links and unchanged offering-specific progress. All My Courses restores
   different-stage enrolled content. General content remains accessible. Open
   Lessons/Exams/Homework/Groups from existing navigation without creating attempts.
6. In another teacher tab archive the selected stage, then its program in a
   separate case. Student refresh shows recovery and permits clear/change without
   disclosing archived private names or deleting preference/progress history.
7. Two tabs load one revision; save A, then save B. B must receive 409, retain its
   draft and require reload before it can save against the new revision. Repeat
   for teacher metadata and course classification. Verify actual RPC state.
8. Student A2 must not read A1 preferences. A/B student or staff must not read/write
   another organization's private catalog/classification or gain access by forged
   organization/program/stage IDs. Test both app HTTP and caller-token direct
   Supabase reads/RPCs. Never log tokens. Selecting a stage must not unlock draft
   lessons, an unenrolled offering or a private media URL.
9. With manifest-owned fixture approval, suspend/expire only a synthetic enrollment
   and verify loss of catalog/learning eligibility; restore its exact prior state
   or remove it in cleanup. An otherwise active unexpired enrollment after an
   offering ends retains the established learning policy.
10. Open Milestone 4 account/profile UI, verify identity/display name remain correct
    and academic preferences survive normal session restoration. Photo upload or
    account editing requires explicit manifest-owned fixtures and Storage cleanup;
    do not modify pre-existing accounts. Record desktop/mobile screenshots and all
    failed/pending outcomes separately.

Cleanup after separately authorized tests: revoke synthetic sessions, delete only
manifest-owned Firebase identities and synthetic academic rows in dependency
order, verify original records/migration history unchanged and stop only test
processes. If Storage is exercised, use its API/dashboard to delete exact objects
before dependent ledger cleanup; never delete Storage metadata through SQL.
Preserve the manifest and report exact leftovers if cleanup cannot be completed.

## Remaining release gates and boundaries

- Owner review of the draft and its Milestone 4 dependency; no auto-merge.
- Real-session procedure above, including signup/email-delivery testing if claimed.
- Authenticated legacy runtime needs valid Clerk configuration if required.
- Provider/OAuth/Storage/device behavior, Firefox/WebKit and realistic load remain
  unverified here. Catalog overviews deliberately fail visibly above bounded limits;
  large-catalog pagination remains a scaling extension.
- A separately approved deployment-manager migration baseline is needed before VPS
  staging deployment because Git and remote history versions differ. No SQL replay.
- No VPS connection, staging deployment, production change, main change or PR
  #13/#14 mutation occurred. Creating/pushing the draft may trigger existing GitHub
  preview automation; no manual deployment is requested or performed.

Stop after draft delivery. Milestone 6 and unrelated features were not started.
