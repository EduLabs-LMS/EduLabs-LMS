# Part 2b: academic programs and stages, the student stage pick, and teacher websites

Read-only audit. No code, migration, test or config was changed. Nothing ran against the VPS or any Supabase project. All evidence
comes from a disposable local PostgreSQL 17.10 on loopback (its own data folder and port, not the shared test server), started with
`-c timezone=UTC` (hosted runs UTC). It was built from the 52 migrations in this tree, as in Parts 0 and 2a, and dropped afterwards.
Prototypes ran in a second throwaway copy (`audit2b_proto`), also dropped. All users are seed or synthetic users. Branch
`claude/backend-audit`, head before this part `1b5f826f894bbe2226b0e4b8dbbdefa3dab8fa50`.

Findings are numbered `A2b-nn` in [FIX_LIST.md](FIX_LIST.md). Part 0 findings that belong to this area (A0-03, A0-08) were measured
again here. Their new evidence is in the first two sections and in their FIX_LIST rows; they keep their IDs.

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| A0-03 (re-measured) | Medium | 300 students picking a stage in the same second take 1.4 s in a queue, and while they queue every new course, upload or notification in the space waits (p50 159 ms, from 0.1 ms). **One student alone can keep the space locked**: repeating the same pick from 20 connections made every such insert wait ~63 ms for as long as it ran. The prototype fix removes both (inserts 0.2 ms), but only with `FOR KEY SHARE`: `FOR SHARE` starved the owner's own program edit for the full 5 s. |
| A2b-01 | Low | Classifying a course and a student-administration action on the same course can deadlock. Proven: one is aborted after 1 s (`40P01`). |
| A2b-02 | Low | The website editor's read cannot open a space with a few thousand course–stage links: from the fourth page on, each page takes 13 s (hosted limit 8 s). |
| A2b-03 | Low | A website catalog cannot hold the 200 courses the rules allow: the 20 KB request limit stops it at about 61 courses with 200-character summaries, about half that in Arabic. |
| A2b-04 | Low | Any space owner or admin can claim any free web address (up to 10) and keep it for ever, even after its 24-hour proof window; the real owner of the address is then refused. |
| A2b-05 | Low | The public website's rate limit counts per website only, so one visitor can use up a teacher's whole budget; and the public functions can be called directly, past that limit. |
| A0-08 (re-measured) | Low | Still true. **Correction to its fix:** `FOR KEY SHARE` on the run and course does **not** stop the failure, because a lesson save and an attendance save take those rows `FOR UPDATE`. Locking only the student's enrollments does (prototype: the pick succeeds while both are held). |
| A2b-06 | Note | For the A0-03 fix: today the space lock is what stops two tabs from both saving a student's first pick. The fix must add a per-student, per-program lock (proven: without it, both tabs succeed and the second silently overwrites). |
| A2b-07 | Note | Every Publish keeps a full copy of the catalog for ever (6,540 link rows each on the largest site) and holds the space row 150–240 ms. |
| A2b-08 | Note | Every teacher and assistant of a space can read its draft website, domain proof codes and catalog directly; the editor hides the proof code from them, the database does not. |
| A2b-09 | Note | Dead code with live grants: `public_teacher_asset` and `resolve_teacher_website` (granted to signed-out visitors), `review_website_resource`, `asset.reserve`, the custom-domain services and two frontend clients have no working caller. |

**For a signed-out visitor (anon), the public website is in good shape:** it can read only what a teacher published, only while the
space is active and each course is still published and public; it cannot reach another space's courses, stages or files; and every
public read costs 1 to 5 ms (100 visitors at once: 75–90 ms in all). Details under "Checked and fine".

## Scope and live versions

Every function below has exactly one `create` statement in all 52 migrations, so the file named is the live version.

**Tables**

| Table | File | Grants to `authenticated` / `anon` | RLS policy |
| --- | --- | --- | --- |
| `academic_programs` | 20261018203119_academic_programs_stages.sql:5 (+ `examination_board`, 20261024120000:40) | select / none | `academic_programs_select` :101 |
| `academic_stages` | 20261018203119:20 | select / none | `academic_stages_select` :103 |
| `academic_subjects` | 20261024120000_platform_admin_teacher_provisioning.sql:44 | select / none | `academic_subjects_select` 20261024120000:69 |
| `course_stage_assignments` | 20261018203119:39 | select / none | `course_stage_assignments_select` :104 |
| `student_stage_preferences` | 20261018203119:57 | select / none | `student_stage_preferences_select` :106 |
| `private.course_stage_versions` | 20261018203119:50 | none | none (RLS on) |
| `organization_websites`, `public_website_assets`, `website_catalog_entries`, `website_stage_selections`, `organization_website_domains` | 20261019004546_teacher_websites_public_catalogs.sql:41, :50, :61, :71, :112 | select / none | `website_staff_read` (`is_org_member`) :137 |
| `private.website_publications`, `_courses`, `_stages`, `_course_stages`, `private.website_reserved_domains`, `private.website_audit` | 20261019004546:79-129 | none | none (RLS on) |
| Storage bucket `lms-website-assets` | 20261019004546:131 | private bucket, **no storage policy at all** | |

No table in scope has an `INSERT`, `UPDATE` or `DELETE` grant to any API role (checked in the catalog). Every write goes through a
function. There are no direct-write paths here of the A0-02 kind. The only triggers are `touch_updated_at` on programs, stages,
subjects and preferences.

**Functions**

| Function | Live file:line | Kind | Who may call |
| --- | --- | --- | --- |
| `private.academic_command` (+ public wrapper :260) | 20261018203119:112 | definer, plpgsql | `authenticated` |
| `private.set_student_stage_preference` (+ :262) | 20261018203119:220 | definer, plpgsql | `authenticated` |
| `private.course_stage_classification` (+ :264) | 20261018203119:250 | definer | `authenticated` |
| `private.can_view_academic_organization`, `can_view_academic_stage` | 20261018203119:74, :85 | definer SQL, policy helpers | `authenticated` |
| `private.website_command` (+ `public.teacher_website_command` :220) | 20261019004546:145 | definer, plpgsql | `authenticated` |
| `private.review_website_resource` (+ :258) | 20261019004546:225 | definer, plpgsql | `service_role` only |
| `website_public.catalog` (+ `public.public_teacher_catalog` :298) | 20261019004546:262 | definer, stable | `anon`, `authenticated` |
| `website_public.domain_lookup` (+ `public.resolve_teacher_website` :299) | 20261019004546:287 | definer, stable | `anon`, `authenticated` |
| `website_public.asset` (+ `public.public_teacher_asset` :300) | 20261019004546:291 | definer, stable | `anon`, `authenticated` |
| `private.website_text`, `website_config_valid`, `website_hostname_valid`, `website_hostname_allowed` | 20261019004546:8, :11, :33, :108 | helpers | `postgres` only |

All definer functions set `search_path=''` and resolve the caller with `private.current_app_user_id()`. The three `public.*` anon
functions are one-line invoker wrappers. The schema `website_public` grants `usage` to `anon` and `authenticated` and is not exposed
by the Data API (`supabase/config.toml:13`). Related functions owned by other parts: `platform_provision_teacher` writes programs,
stages, subjects and classifications (Part 1); the demo clear functions delete classifications (Part 8); `student_administration`
(Part 3) appears here only for lock order.

**Routes and callers**

| Route | Server code | Database calls | Screen today |
| --- | --- | --- | --- |
| `GET/POST /api/student-academics` | `server/http/student-academics.ts`, `server/services/student-academics.ts` | direct selects on programs, stages, preferences, classifications; `set_student_stage_preference` | **none**: the selector is switched off (`shared/contracts/student-academics.ts:26`, `studentAcademicSelectionEnabled=false`) but the route and the function are live |
| `GET/POST /api/teacher/academics` | `server/http/academics.ts`, `server/services/academics.ts` | direct selects; `course_stage_classification`; `academic_command` | the course page reads `kind=classification` (`frontend/features/teacher-course/course-view.tsx:55`); nothing writes |
| `GET/POST /api/teacher/website` | `server/http/website-editor.ts`, `server/services/website-editor.ts` | seven direct selects, `public_teacher_catalog`, `teacher_website_command` | **none** (teacher website removed from V1, V1.md); the route is live |
| `/t/<slug>`, `/t/<slug>/courses/<id>`, `/t/<slug>/sitemap.xml` | `app/t/_render.tsx`, `server/services/public-website.ts`, `server/integrations/public-catalog.ts` | `public_teacher_catalog` as `anon` | public, live; needs the external rate-limit gateway or it answers 503 |
| none | `server/services/domain-routing.ts`, `domain-verification.ts` | `resolve_teacher_website`, `review_website_resource` | not wired to any route (A2b-09) |

## Re-measured: A0-03, a student choosing a stage locks the whole space (Medium)

**Fixture.** Seed space A with 2 programs × 6 stages (made with `academic_command`), 300 synthetic students each enrolled in both
runs of seed course 1, 20 published public courses each classified to 2 stages, and a published website listing them all.

**Method** (`scratchpad/pick.cjs`). Each call is one PostgREST-shaped transaction (`begin; set local role authenticated;
request.jwt.claims; call; commit`) as the signed-in student. A probe connection inserts a row that names the space every 20 ms (the
same foreign-key lock a new course, media upload, membership or notification event takes) and rolls it back.

| Measurement | Live | Prototype v1: space `FOR SHARE` | Prototype v2: space `FOR KEY SHARE`, admin commands `FOR NO KEY UPDATE` |
| --- | --- | --- | --- |
| One pick, warm, median of 15 | 6.2 ms | 5.7 ms | 6.0 ms |
| 300 first picks from 50 connections at once: total | **1,363 ms** | 333 ms | 332 ms |
| … per pick p50 / p95 / max | 174 / 396 / 504 ms | 31 / 198 / 205 ms | 30 / 190 / 220 ms |
| … an insert naming the space meanwhile, p50 / max (alone 0.1 ms) | **159 / 269 ms** | 1.1 / 8.6 ms | 1.5 / 11.8 ms |
| One student repeating its current pick from 20 connections for 5 s | 1,708 calls | 1,758 calls | 1,766 calls |
| … an insert naming the space meanwhile, p50 / max | **63 / 101 ms** | 0.2 / 1.7 ms | 0.2 / 1.6 ms |
| … the owner's `program.edit` meanwhile | 66 ms (44 edits) | **one edit waited 5,050 ms**, the whole run | 2.3 ms (95 edits) |

What this shows:

- "300 students in the same minute" is 5 picks a second and is harmless at 6 ms each. The real case is a teacher telling a class
  "pick your grade now": the picks then queue one by one, and the whole space's inserts queue with them.
- **The lock can be taken at will by any enrolled student.** The only check before the lock is `can_view_academic_organization`
  (`20261018203119:225-227`), which every member and every enrolled student passes. A pick that changes nothing (same stage) or
  has a stale revision still takes the space `FOR UPDATE` first and fails or returns afterwards. The app does not have to be involved:
  the function is granted to `authenticated` and callable directly with the public key. The cost to the space is latency, not an
  outage (each call holds ~6 ms), and it scales with the number of connections the caller uses.
- **The fix must be `FOR KEY SHARE`, not `FOR SHARE`.** Part 0 offered both. With `FOR SHARE`, the students' shared locks overlap
  without a gap and the owner's `FOR UPDATE` waits behind them for as long as they continue (PostgreSQL lets a compatible locker go
  ahead of a waiting writer). With `FOR KEY SHARE` for the pick and `FOR NO KEY UPDATE` for `academic_command`, `website_command`
  and the other space-row takers, none of them conflict with each other or with foreign-key inserts.
- What `FOR KEY SHARE` gives up: a pick may commit in the same instant the platform suspends the space. A stage preference never
  grants access (table comment at :269; ARCHITECTURE.md), so that is harmless.
- Two-session proof (`scratchpad/proofs.cjs`, P1): a pick held open 700 ms; an insert naming the space waited
  (`Lock/transactionid`, blocked by the pick) and finished at 706 ms. With prototype v2 it did not wait.

**Other space-row holders in this part:** `website_command` publish holds the space row 150–240 ms on the largest possible site
(below, A2b-07), and `academic_command` about 2 ms. They are owner/admin actions and rare.

**Suggested fix (not done).** In `set_student_stage_preference`: take the space `FOR KEY SHARE` (or no space lock at all), lock
only the student's enrollment rows (A0-08), and add the per-student lock of A2b-06. In `academic_command`, `website_command`,
`review_website_resource` and the Part 1 holders: `FOR NO KEY UPDATE`. Add the A0-06 `lock_timeout`. Test: the abuse case above
must leave inserts and owner commands unaffected.

## Re-measured: A0-08, a stage pick fails while a teacher saves a lesson or takes attendance (Low)

Two sessions (`scratchpad/proofs.cjs`, P2). The holder locks the row the way the real save does; then student `…0005` picks.

| Holder | Live pick | `FOR SHARE NOWAIT` on that row | `FOR KEY SHARE NOWAIT` on that row | Prototype pick (enrollments only) |
| --- | --- | --- | --- | --- |
| course `FOR UPDATE` (a lesson save, `edit_learning_content`) | `55P03` in 18 ms | `55P03` | **`55P03`** | ok, 25 ms |
| run `FOR UPDATE` (an attendance save, `group_command`) | `55P03` in 3 ms | `55P03` | **`55P03`** | ok, 6 ms |
| course `FOR NO KEY UPDATE` (what the A0-05 fix would take) | `55P03` in 3 ms | `55P03` | granted | ok, 7 ms |

So the fix in the FIX_LIST row ("lock the run and course rows `FOR KEY SHARE`") works only after A0-04 and A0-05 have changed those
saves to `FOR NO KEY UPDATE`. The simpler fix works now: lock only the student's own enrollment rows (`for share of e nowait`). That
is the only thing the comment at `20261018203119:230-231` needs ("so suspension cannot race a preference grant"); course and run
status changes do not have to be held still for a preference that grants nothing. The student's message for `55P03`
("Permissions or enrollment are being updated", `server/services/academics.ts:11`) is also wrong for this case.

## A2b-01: Low, lock order

**Classifying a course and a student-administration action on the same course can deadlock.**

- `academic_command('course.assign')` locks the space `FOR UPDATE` (`20261018203119:130`), then the course `FOR UPDATE` (`:138`).
- `student_administration` locks the run, then the course `FOR SHARE`, then the space `FOR SHARE`
  (`20261106120000_listing_performance.sql:219-228`).
- The two orders are opposite. If an owner classifies a course at the moment a teacher of that course creates a join link or
  approves a request, each waits for the other.

**Proof** (`scratchpad/deadlock.cjs`, real functions on both sides). A third session held the course `FOR SHARE` for a moment only
to widen the window: `course.assign` waited on the course (`Lock/transactionid`), the teacher's `student_administration('link')`
waited on `course.assign`. When the helper released, PostgreSQL reported `deadlock detected` and aborted `course.assign` with
`40P01` after 1,067 ms; the link was created. The server shows "Academic data could not be loaded or saved. Please retry."

**Why Low:** the window is microseconds without the helper, it needs two people acting on the same course at once, and the loser can
retry. The A0-03 fix does not remove it (`FOR NO KEY UPDATE` still conflicts with `FOR SHARE`). **Fix:** `course.assign` does not
need the space lock (its revision is per course); lock only the course. Or have `student_administration` take the space
`FOR KEY SHARE`, which matches the A0-03 direction.

## A2b-02: Low, performance

**The website editor's read cannot open a space with a few thousand course–stage links.**

`websiteEditorService.read()` pages every table 200 rows at a time with `range()` (offset paging; `server/services/website-editor.ts:29`)
and reads all of `course_stage_assignments` for the space (`:40`). That table's policy runs `can_view_course(course_id)` and
`can_view_academic_stage(stage_id)` for every row (`20261018203119:104-105`), about 2 ms a row.

**Measured** on space B with 130 courses × 50 stages = 6,500 links, as the space owner, each page its own request:

| Page | Time | Plan |
| --- | --- | --- |
| 1, 2, 3 | 432, 816, 1,248 ms | index scan, stops after offset + 200 rows |
| 4 to 33 (each) | **~13,100 ms** | seq scan + sort: the policy runs for all 6,500 rows, every page |
| All 33 pages | **395 s** of database time | |

`EXPLAIN (ANALYZE, BUFFERS)` of page 33: 13,053 ms, 988,175 buffer hits, all in the filter
`private.can_view_course(course_id) AND private.can_view_academic_stage(stage_id)`. On the hosted project each page past the third
would be cancelled by the 8 s `statement_timeout`, and the editor would show "Website data is unavailable" for that space. The same
reads on space A (20 courses, 40 links) take 85 ms. The editor's other reads on space B: courses 82 ms, stages 148 ms.

**Why Low:** it needs a space with more than about 4,000 links (locally; fewer on slower hardware), and there is no website screen in
V1. **Fix before the website feature returns:** read the editor state through one definer RPC that checks owner/admin once, or put
the space filter in the policy as a set-returning helper evaluated once per statement (the A0-01 pattern). Never offset-page a
policy-filtered table.

## A2b-03: Low, correctness

**A website catalog cannot hold the 200 courses the rules allow.**

The contract allows 200 courses with a 160-character title and a 1,200-character summary each, and 100 stages
(`shared/contracts/website-editor.ts:7`, `:12`; `website_command` :167). But `website_command` refuses any payload over 20,000
bytes (`20261019004546:149`), and the route refuses a body over 20,000 bytes (`server/http/website-editor.ts:20`). Measured
(the payload's real size as the database counts it):

| Summary length | Stages | Most courses that fit |
| --- | --- | --- |
| empty | 0 | 173 |
| empty | 100 | 138 |
| 100 characters | 12 | 90 |
| 200 characters | 12 | **61** |
| 400 characters | 12 | 37 |
| 1,200 characters (allowed) | 12 | **14** |

Arabic letters take 2 bytes each, so an Arabic catalog fits about half as many. Above the limit the teacher gets "Request too large"
(413) or "Unable to save. Check the website/domain details and current state." Neither says what is wrong. **Fix:** size the limit
from the item limits (200 × the largest entry), or save the catalog in pages; and say "too many courses or text too long" when it
is hit.

## A2b-04: Low, security

**Any space owner or admin can claim any free web address and keep it for ever.**

`domain.claim` (`20261019004546:196-198`) accepts any valid hostname not on the reserved list. `hostname` is unique across the whole
platform (`:114`), and nothing ever releases a claim: the table comment says so (`:304`), and a claim whose 24-hour proof window has
passed still holds the name.

**Proof (rolled back):** space B's owner claimed `physics-teacher-a.com` (state `pending`). Space A's owner was refused
(`23505`). After moving the claim's `challenge_expires_at` 30 days into the past, space A was still refused. The editor shows "That
domain is already claimed. Contact platform support for a reviewed ownership dispute." The limit of 10 also counts disabled and
revoked rows (`:197`), so a space that tried 10 names can never claim another.

**Why Low:** custom domains are switched off (no ingress, `domain-routing.ts` is not wired; `domainRoutingEnabled:false`), and only
owners and admins of a provisioned space can do it. It must be settled before custom domains are turned on. **Recommended:** an
unverified claim expires at `challenge_expires_at` and frees the name; only pending, verified and active claims count toward 10.

## A2b-05: Low, abuse

**The public website's rate limit counts per website only, and the public functions can be called past it.**

- `allowPublicRequest` asks the external gateway with `{bucket:'edulabs-public-websites', site, cost}`
  (`server/services/public-website.ts:18-29`). There is no visitor key, by design ("no client IP headers"). So one visitor who
  reloads a teacher's page fast enough uses up that website's whole budget, and every other visitor of that teacher gets 429.
- `public_teacher_catalog`, `resolve_teacher_website` and `public_teacher_asset` are granted to `anon`. Anyone can call them through
  the Data API with the public key, never passing the gateway. Measured cost per call: catalog 1–5 ms (largest site, 50 courses:
  4.1 ms), address lookup 0.4 ms (0.8 ms with a 100,000-character name), asset 0.7 ms. `anon` has `statement_timeout=3s`.
- Neither leaks anything (see "Checked and fine"). The exposure is load and one teacher's site being made unavailable.

**Fix:** give the gateway a per-visitor key as well as the per-site one (for example a keyed hash of the connecting address made at
the edge), and decide whether the Data API's anon functions need their own limit. The gateway's configuration is not in this
repository (could not verify).

## A2b-06: Note, for the A0-03 fix

Today two tabs saving a student's first pick for one program at the same moment give one success and one "changed; reload"
(`PT409`), and one row with revision 1. That relies on the space lock: the preference row does not exist yet, so its own
`FOR UPDATE` (`20261018203119:241`) locks nothing, and both would pass the revision check.

**Proof** (`scratchpad/proofs.cjs`, P3): a copy of the function with the space lock relaxed and no other lock: **both tabs
succeeded** and the row ended at revision 2, the second silently replacing the first. With the prototype's per-student lock
(`pg_advisory_xact_lock(hashtextextended('stage-preference:'||user||':'||program,0))`): one success, one `PT409`, revision 1, as
today. The A0-03 fix must include that lock (or an equivalent insert-then-lock).

## A2b-07: Note, growth

**Every Publish keeps a full copy of the catalog for ever.** `publish` (`20261019004546:176-189`) inserts a new
`website_publications` row and copies every course, stage and course–stage link, even when nothing changed. The copies are
`ON DELETE RESTRICT` and nothing removes them. On the largest site (130 courses × 50 stages): each Publish adds 6,540 link rows and
holds the space row `FOR UPDATE` 150–240 ms (three Publishes: 2 → 5 publications, 6,540 → 26,040 link rows). **Recommended:** skip
a Publish that changes nothing, and keep only the last few publications.

## A2b-08: Note, read access

`website_staff_read` lets every member of a space (owner, admin, teacher, assistant) read its `organization_websites` (draft
config), `organization_website_domains` (including the `challenge` proof code), `public_website_assets` and catalog rows directly
(`20261019004546:137`). Proof: the assistant `…0004` read the space's site, 10 asset rows, 20 catalog rows and a domain with its
challenge. The editor deliberately hides the challenge from non-managers (`server/services/website-editor.ts:57`); the database does
not. Harm is small: the challenge is published in DNS anyway, and staff may see the draft. Students and signed-out visitors read
nothing (proof: 0 rows). **Recommended:** restrict these policies to owner/admin when the website feature returns, so the database
and the editor agree.

## A2b-09: Note, dead code with live grants (Part 9)

| Item | Grant | Why it is dead |
| --- | --- | --- |
| `public_teacher_asset` | `anon`, `authenticated` | no caller anywhere; no route serves website images |
| `resolve_teacher_website` | `anon`, `authenticated` | only caller is `anonymousDomainLookup` in `server/services/domain-routing.ts`, which no route imports |
| `review_website_resource` | `service_role` (no time limit, takes the space `FOR UPDATE`) | only reached through `createTrustedDomainReviewPort`, which nothing calls; asset review has no caller at all |
| `website_command('asset.reserve')` | `authenticated` (owner/admin) | not in the route contract; the bucket has no storage policy, so a reserved image can never be uploaded or approved. 10 reservations block any further one for good (proof: the 11th is refused), and no owner action removes one |
| `website_command('domain.activate')` | same | not in the route contract |
| `server/services/domain-routing.ts`, `domain-verification.ts` | | imported only by tests |
| `frontend/lib/academics.ts`, `frontend/lib/website-editor.ts` | | imported by nothing |
| the student stage selector | `/api/student-academics` and `set_student_stage_preference` stay live | switched off by a constant (`shared/contracts/student-academics.ts:26`); the endpoint is what A0-03's abuse case uses |

Removing them is cleanup, not a security fix. The live endpoint behind the hidden selector is worth a decision in Part 9: keep it
(the selector may return) or switch the route off with the screen.

## Checked and fine

- **Signed-out visitors (anon).** `anon` has no table grant and executes exactly the three `public.*` website functions (catalog
  check). What they return:
  - `public_teacher_catalog` returns a website only if it is `published` and its space is `active` (`:266`). Courses come from the
    published copy and are kept only while the live course is still `published` and `public` and in the same space (`:276-277`).
    Stages are kept only while the live stage and program are `active` and in the same space (`:270`). Images are named only if
    `approved` and of this website (`:274`, `:284`). The configuration shown is the published one, never the draft.
  - A course page (`p_course_id`) or a stage filter for anything not in this website's publication returns nothing (`null`), the
    same as an unknown or unpublished website. So a visitor cannot tell an unpublished website from a missing one, and cannot reach
    a private, draft or archived course, or another space's course, stage or image, by guessing ids.
  - `resolve_teacher_website` answers only for an `active`, verified, unexpired, certificate-ready address of a published website of
    an active space, and returns only the slug and publication id. `public_teacher_asset` returns only an approved image's id, type,
    size and hash, never the bytes or a storage path.
  - A visitor cannot list spaces, teachers, courses or files: every function needs the exact slug, and every id it returns is one the
    teacher published. Published website slugs can be guessed, which is expected for public pages.
  - Cross-space links cannot be written: catalog rows, stage selections and images are tied to the website's own space by composite
    foreign keys (`(organization_id, course_id)`, `(organization_id, stage_id)`, `(organization_id, website_id, asset_id)`), and
    classification refuses another space's stage (proof: `42501 Stage unavailable`).
- **Public read cost** (anon, warm; `scratchpad/web.cjs`, auto_explain on the inner statements):

  | Read | 20-course site | Largest site (130 courses, 100 stages, 50 per course) |
  | --- | --- | --- |
  | Home, 12 courses | 1.1 ms | 2.2 ms |
  | 50 courses (the most a page allows) | 1.0 ms | 4.1 ms |
  | Stage filter | 0.9 ms | 1.8 ms |
  | One course page | 0.7 ms | 1.0 ms |
  | Page 2 plus its cursor check (2 calls) | 1.6 ms | 2.7 ms |
  | Unknown slug | 0.2 ms | 0.1 ms |
  | 100 visitors at once (20 connections; 1 in 4 filtered, 1 in 10 a course page) | 75 ms in all, p50 3.1 ms | 90 ms in all, p50 6.6 ms |

  Every inner statement uses the primary keys or the slug; the course list stops at `limit + 1` before building the expensive JSON
  (Merge Join → Limit, 51 rows). No per-row policy is involved (definer, no RLS). The JSON for 12 courses of the largest site is 44 KB.
- **The public page itself** buffers before answering (a missing site is never a streamed 200), sends `no-store`, a
  `default-src 'none'` CSP with no script, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, refuses repeated query keys,
  checks the Host header against `APP_ORIGIN`, and fails closed (503) without the rate-limit gateway (`app/t/_render.tsx`,
  `server/services/public-website.ts`). The anon client never sends the visitor's session (`server/integrations/public-catalog.ts`).
- **Callers are checked before the space lock** in `academic_command` (`:125-129`) and `website_command` (`:148`): a student calling
  them is refused without queueing (proof: `42501` for both). Both re-check the role after their locks, and take the caller's
  membership `NOWAIT` so the reverse order of `protect_last_owner` fails fast instead of deadlocking (existing concurrency suite).
- **Stale-edit checks.** Programs, stages, classifications, preferences, the website and each domain carry a revision; a stale save
  gets `PT409` (existing suite `scripts/academic-programs-concurrency.cjs`, `website-concurrency.cjs`, `domain-concurrency.cjs`).
- **Roles.** Programs, stages and the website: space owner/admin only. Classification: anyone who may edit the course
  (`can_edit_course`, so course-staff editors too; proof: the editor `…0004` classified seed course 1). Classification is not
  publishing (A2a-05's rule); it reaches the public site only through an owner's Publish. A student can pick a stage only in a space
  where they hold an active enrollment (proof: another space → `42501`). Staff of the space may also save a preference (proof:
  teacher `…0002`); a preference grants nothing, so this is harmless. Suspended profiles resolve to no one.
- **NULLs and bad input.** A null program, stage list or revision fails with `42501`, `22023` or `PT409`, never a partial write.
  Unknown keys, wrong JSON types and payloads over the size caps are refused. Slugs and labels are checked by constraints and
  functions; a duplicate slug becomes 409 "already in use".
- **Archiving.** An archived program or stage disappears from the student list and the public site at once, its classifications and
  preferences are kept, and a student can still clear a preference that points at it (`:237`). A stage cannot be re-activated under
  an archived program (`:203`).
- **Course classification read** for the course page (`course_stage_classification`): 0.9 ms, checked with `can_edit_course` once.
- **Time zones.** The only time logic is the domain proof window (`clock_timestamp() + 24 hours`, 7-day verification), all
  `timestamptz`. Nothing depends on the session time zone.
- **Student academics read** (route live, screen off): student `…0005` reads programs 4.6 ms, stages 32 ms (12 rows; the stage
  policy costs ~2.7 ms a row, so ~270 ms for 100 stages), preferences 2.8 ms. Acceptable for a screen that is off; it should use the
  A0-01 pattern if it returns.

## Could not verify

- **The rate-limit gateway** (`PUBLIC_WEBSITE_RATE_LIMIT_URL`): its budget, its keys and whether it is configured on any
  environment. Without it every `/t/` page answers 503.
- **Whether the Supabase API gateway limits anonymous Data API calls** on the hosted project.
- **Hosted hardware and pool size.** The 13 s editor page (A2b-02) and the 6 ms pick were measured on the 20-core audit machine.
- **Real data sizes.** No real website or classification data was used; the largest site here is the largest the payload cap allows.
- **How often the two-way deadlock (A2b-01) can happen naturally.** Proven only with a helper widening the window.
- **PostgreSQL writer starvation on the hosted project.** Measured locally (5 s); the same rule applies to any PostgreSQL 17.

## Evidence scripts (scratchpad, not committed)

`build.cjs` (replay into a disposable database), `fixture.cjs` and `fixture-b.cjs` (synthetic spaces), `pick.cjs` (stage pick,
burst and abuse), `proto.sql` and `proto2.sql` (prototype functions, throwaway copy only), `proofs.cjs` (P1 space lock, P2 A0-08,
P3 two tabs), `deadlock.cjs` (A2b-01), `web.cjs` and `edpages.cjs` (public and editor reads, EXPLAIN), `size.cjs` (A2b-03),
`probes.cjs` (A2b-04, A2b-07, A2b-08, A2b-09 and the access checks). All ran only against the disposable local databases, which
were then dropped.
