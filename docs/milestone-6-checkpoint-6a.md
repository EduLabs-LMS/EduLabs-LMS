# Milestone 6A — website database and security checkpoint

Date: 2026-10-19 (Africa/Cairo). **Local implementation; awaiting exact development
migration approval.** This does not enable public application routes or uploads.

Branch: `codex/milestone6-teacher-websites-catalogs`.
Separate worktree: `E:/EduLabs-Milestone6`.
Starting remote HEAD: `a78f6911279b5409f4fe60d3cb9ccb00fc8baf0b`, descending from
the preserved M5 draft PR #15 HEAD `75a3a7d291830afc832567fc4f7fe9bac30a057b`.
The implementation checkpoint SHA is recorded in the delivery response and Git
history; the commit containing this report is the completed 6A checkpoint.

## Exact migration submitted for review

File: `supabase/migrations/20261019004546_teacher_websites_public_catalogs.sql`.
Created with the existing Supabase CLI's `migration new` command. Canonical bytes
are protected by an exact `-text` Git attribute.

SHA-256:

```text
E5588657408C7D56364E59CF7D423FB44AB3DB073931DA7B6A261E3E66149CEC
```

This is the only new migration. All **30 historical migration blobs are unchanged**.
Do not apply this file, run `supabase db push`, replay earlier files, or repair
history without a new explicit owner authorization. Approval would add migration
31 and the objects below, with zero seeded websites or academic backfills.

## Audit of the existing application

The M6 contract, migration ledger, existing course/status/visibility model,
organization helpers, M5 taxonomy, Firebase viewer/session integration, access
request/invitation service, middleware, Next configuration and Caddyfile were
reviewed before implementation.

Organizations remain tenants, not programs or websites. Existing staff-managed
organization provisioning and `create_organization` revocations remain intact.
Firebase issuer/subject verification resolves the existing profile UUID; roles
come from active contextual organization membership. No email identity matching
or global teacher permission is introduced.

Existing student access requests require a valid invitation/request-link token;
registration and a public catalog do not grant enrollment. Generic public CTAs
can currently lead to `/access`, not an invented tokenless public enrollment flow.
The shared CTA contract permits only sign-in, sign-up and access route tokens.
For custom domains, the future UI must resolve those paths against a configured,
allowlisted **platform origin**, never a visitor-controlled Host header.

The existing Caddy staging host is protected by HTTP Basic Auth. Caddy, middleware,
Next configuration, auth/session code, existing application routes, DNS and OVH
were not changed. No anonymous browser route is enabled in 6A.

## Architecture decisions and objects

### Private authoring, explicit immutable publication

Five new public-schema tables all have RLS and authenticated SELECT-only grants:

| Table | Purpose |
| --- | --- |
| `organization_websites` | Exactly one website per organization; globally unique stable slug; draft config, draft/published/unpublished state, optimistic revision and current publication pointer |
| `website_catalog_entries` | Explicit teacher-approved public course title/summary and optional approved image; composite tenant/course/site FKs |
| `website_stage_selections` | Explicit consent to publish selected same-tenant stage/program names |
| `public_website_assets` | Dedicated image reservation/review ledger, not a reference to private academic media or avatars |
| `organization_website_domains` | Globally unique canonical ASCII hostname, ownership challenge, expiry, verification/certificate gates, state and revision |

Six new private-schema tables have RLS, no authenticated/anonymous table access
and no permissive policies:

- `website_publications`: append-only through RPCs; frozen approved config per revision.
- `website_publication_courses`: frozen public copy for explicitly selected courses.
- `website_publication_stages`: frozen approved names and program/stage positions.
- `website_publication_course_stages`: normalized frozen classification links.
- `website_reserved_domains`: trusted operator-controlled platform/provider suffixes.
- `website_audit`: immutable through application roles, recording publication,
  authoring, resource review, rotation, activation and revocation evidence.

All IDs are UUIDs; dates are timestamptz. Deliberate RESTRICT foreign keys retain
history and prevent cross-tenant references; archive/unpublish replaces deletion.
PK/unique indexes cover FK prefixes where possible; additional indexes cover
course, stage, asset, actor and tenant traversal without a duplicate asset-site
prefix index. No existing table, trigger, policy, function or grant is replaced.

Config is bounded structured JSON: public text, locale (`en/ar`), reviewed theme
and accent tokens, CTA token, section order and asset UUIDs. Unknown fields,
HTML/control characters, arbitrary CSS/JS, iframes, external URLs and duplicate
sections are rejected. Public summaries are separate plain-text approved fields;
the LMS course description/title, profile or staff details are never automatically
copied into a public response.

The owner/admin must explicitly publish. Publication validates every selected
course is currently `published` and `visibility='public'`, every selected stage
and program is active, and every image is approved for that same site. An invalid
entry blocks publication rather than silently publishing a partial selection.
Empty sites/catalogs are permitted intentionally. Maximums: 200 selected courses,
100 stages, ten non-revoked image reservations and ten retained domain bindings.

Publishing atomically writes a new snapshot and swaps the site's pointer. Draft
edits do not alter public output, including taxonomy labels/classification until
republished. Public reads still recheck **current** organization, course visibility,
publication status, stage/program active state and asset revocation. Thus changing
a course to private/unlisted/draft/archived or unpublishing the site suppresses it
without destroying history. Archived taxonomy is omitted from public filters.

### Command, locking and retry contracts

`public.teacher_website_command(p_action text, p_organization_id uuid,
p_revision bigint, p_data jsonb default '{}') -> jsonb`

Public invoker wrapper calls a private definer with empty search path. Only active
organization owner/admin can mutate. Early denial prevents outsiders queueing on
another tenant's lock. Commands then lock organization, profile and membership,
recheck identity/role and lock website/resource rows. Membership SHARE NOWAIT avoids
inverting the existing last-owner trigger's lock order. Stale website/domain
revisions raise `PT409`; temporary lock contention is retryable, not bypassed.

Actions: `create`, `draft`, `catalog`, `publish`, `unpublish`, `asset.reserve`,
`domain.claim`, `domain.rotate`, `domain.activate`, `domain.disable`. Inputs are
strictly allowlisted and bounded to 20 KB. Catalog replacement is transactional;
failed tenant/FK validation rolls back deletions. Duplicate requests with an old
revision cannot create another website, claim, reservation or publication.
Slugs are immutable in this slice to avoid implicit redirect/reclaim semantics.

Return: `{website, asset|null, domain|null}` to authorized managers only. Resource
reviews serialize on the same organization/site locks but version their resource
independently; they do not silently modify an owner's draft.

### Anonymous projections, not anonymous academic tables

A separate **non-exposed projection schema** `website_public` grants anonymous
USAGE only there, not on the existing private helper schema. Its three reviewed
definers have empty search paths and fully qualified table references. Public
invoker wrappers expose only these necessary operations. Even if that schema were
accidentally added to the Data API, its callable functions return the same bounded
allowlisted projections, never raw academic rows.

| RPC | Anonymous public result |
| --- | --- |
| `public_teacher_catalog(p_slug text,p_stage_id uuid=null,p_after uuid=null,p_limit integer=20,p_course_id uuid=null)` | Exact public site snapshot, approved taxonomy and live-eligible course summaries; limit 1–50, deterministic UUID keyset pagination with `hasMore/next` |
| `resolve_teacher_website(p_hostname text)` | `{slug,version}` only for verified, activated, certificate-ready, unexpired binding to a published site in an active organization |
| `public_teacher_asset(p_slug text,p_asset_id uuid)` | `{id,mime,size,sha256}` only for an approved image referenced by the currently published site or an eligible public course |

Unknown/unpublished sites, unauthorized course details, unapproved stage filters,
unusable domains and unpublished/revoked images return SQL NULL. Future HTTP
handlers must translate that into consistent 404 behavior, not private previews.

Exact catalog DTO:

```text
{slug, version, revision,
 site: {displayName,heroTitle,heroSubtitle,about,locale,theme,accent,
        ctaLabel,ctaTarget,sections,logoAssetId?,heroAssetId?},
 stages: [{id,label,programId,programLabel,position,programPosition}],
 courses: [{id,title,summary,assetId,stageIds}],
 hasMore, next}
```

The revision/version belongs to the frozen public snapshot, not the live draft.
No org/user/profile IDs, personal email/phone, raw course descriptions, offerings,
enrollments, student lists, lessons, media URLs, grades, answers, challenges or staff
identities are returned. Approved course/stage/asset UUIDs are public facts, not
authorization capabilities. Strict TypeScript/Zod contracts reject extra fields.

### Publication assets: approval before bytes can be public

The new `lms-website-assets` bucket is **private**, max 2 MB, PNG/JPEG/WebP only;
SVG/HTML is excluded. No anonymous Storage SELECT policy, browser upload grant or
delivery route is created. Existing private Storage buckets/policies are untouched.
Reservations use immutable `website-uuid/asset-uuid.image` keys and belong to one
site/org. Private academic media and avatars cannot be referenced as branding.

`public.review_website_resource(p_kind text,p_id uuid,p_revision bigint,
p_approve boolean,p_evidence text,p_data jsonb default '{}') -> void`

This invoker/private-definer review boundary grants EXECUTE **only to the trusted
service role**, not owners, teachers, students or anon. For assets, it requires a
dedicated object with matching MIME/size/SHA metadata and a bounded review receipt;
for domains it requires the exact current challenge and certificate eligibility.
Review/revocation is versioned and audited. Revoked asset descriptors immediately
disappear from public projections, including hero/logo references.

**SQL metadata checks are not image-byte validation.** A separately implemented
trusted upload adapter must decode, normalize, strip metadata, measure dimensions,
hash actual bytes and reject spoofed files before invoking approval. No such upload
flow is enabled in 6A. Synthetic SQL Storage metadata tests are not real file/API
delivery acceptance. Public image delivery needs a separately reviewed scoped
handler/read policy; never expose arbitrary private object paths or service keys.

### Domain state machine, proof and operational boundary

`pending -> verified -> active -> disabled/revoked`. A disabled binding can rotate
to a fresh pending challenge; a revoked binding is terminal in these RPCs.

- Globally unique lowercase ASCII DNS names, valid full labels/length. URLs,
  userinfo, ports, IP literals, localhost/internal suffixes, whitespace and invalid
  authorities are rejected. IDN/`xn--` names are deliberately rejected until a
  reviewed UTS46/IDNA adapter exists, rather than partially normalizing them.
- Reserved platform/provider suffixes are checked at claim, verification,
  activation and resolution. Before 6D, operators must register the actual platform,
  staging and callback hostname suffixes; configured production hosts are not
  guessed from request headers or environment files in a migration.
- Two independent random UUIDv4 values form a 64-hex-character challenge; TXT
  proof is intended at `_edulabs-verification.<hostname>`, with a 24-hour challenge
  validity. Only a trusted external verifier may attest that DNS proof was observed.
- Verification lasts seven days. The database refuses active state without an
  expiry and certificate readiness. Expired bindings stop resolving automatically;
  rotation invalidates old proof/readiness. Reverification requires current proof
  and explicit activation, not reliance on a stale ownership claim.
- Owner/admin cannot self-verify or assert certificate readiness. Trusted receipts
  are a privileged boundary, not an automatic DNS checker. No DNS/HTTP/TLS request
  or Caddy configuration occurs in SQL.
- Disabled, expired and revoked hostnames remain reserved to prevent dangling-domain
  takeover. There is **no automatic reclaim/transfer**. Collision with a stale or
  malicious claim requires operator investigation and a separately reviewed,
  audited fresh-proof reassignment procedure. This favors security over availability;
  per-site claim bounds limit abuse but do not replace operator collision handling.

The future 6D verifier must query TXT through a trusted resolver with bounds and
timeouts, never fetch an attacker-supplied URL, and validate any address use against
private/metadata destinations. Host routing must validate exact trusted proxy
authority and ignore untrusted X-Forwarded-Host. The database lookup is a safe
public projection, not permission to select private tenant data from raw headers.
Existing platform `__Host-` Firebase cookies/CSRF origin remain unchanged and must
not be shared across teacher domains.

## Privilege matrix

| Actor | Private site draft/ledger tables | Author/publish/domain commands | Trusted approval | Public DTOs |
| --- | --- | --- | --- | --- |
| Anonymous | Denied | Denied | Denied | Published allowlist only |
| Student, including enrolled | Denied | Denied | Denied | Same public allowlist |
| Active contextual organization staff | Own org preview SELECT on new public tables | Denied unless owner/admin | Denied | Same public allowlist |
| Owner/admin | Own org preview SELECT | Own org, revision checked | Denied | Same public allowlist |
| Other-tenant staff | No private cross-tenant rows | Denied | Denied | Intentionally published facts only |
| Trusted service operator | Reviewed resource functions; server-only credentials | No browser privilege elevation | Versioned approval/revocation | Same public projections if explicitly authorized |

All six private tables remain denied to application roles. No anonymous SELECT or
policy is added on any existing LMS table. Students gain no enrollment, private
taxonomy, lesson or teacher permission by browsing a site or guessing a UUID.

## Threats, limits and remaining transport requirements

Addressed in database/tests: BOLA/tenant forgery, public/draft confusion, private
rich-text leakage, unlisted discovery, answer-key/student disclosure, copied
private assets, fake ownership receipts, domain collisions, expired/revoked proof,
stale or concurrent publication, membership revocation during waits, mass-assignment,
malformed/oversized JSON, unsafe hosts/URLs and unsafe definer search paths.

Public queries are bounded to 50 courses from a maximum 200 selected courses and
100 stages; no arbitrary SQL/joins/sort clauses or URL fetch is accepted. HTTP
rate limiting is **not claimed implemented** by SQL. Initial 6C gateway policy
should be a reviewed 60 requests/minute per client plus aggregate tenant limits,
with bounded bursts, provider Data API protections and observability. Client-
supplied IP headers cannot establish trusted identities. Direct Data API RPC
abuse also needs provider/gateway limits before a public launch.

6B/6C handlers must use existing verified Firebase identity and exact-origin CSRF
for writes, stream-bounded JSON, validated UUIDs and sanitized failures. Public
responses should initially be `Cache-Control: no-store`; snapshot version alone
is not a sufficient cache validator because live course privacy/organization state
can change without republishing. Any later cache requires tenant-safe keys and
reliable invalidation. Canonicals/sitemap/robots must use configured allowed
origins and published routes, never arbitrary Host headers. Unknown sites are 404.

## Actual local verification

| Check | Result |
| --- | --- |
| Application tests, serial | **276 passed**, including seven new website contract/boundary tests |
| Strict non-incremental TypeScript | Passed |
| Architecture boundaries | Passed |
| ESLint | 0 errors, same 10 existing warnings |
| Native PostgreSQL upgrade replay | All **31 local migrations**, all **21 SQL suites** passed |
| Native PostgreSQL fresh-install replay | All **31 local migrations**, all **21 SQL suites** passed |
| New website SQL suite | **114 assertions** passed in each final replay |
| Independent-session concurrency | **104 cases** passed per final replay: 96 preserved plus eight website cases |
| Migration preservation | 77 existing table/data/RLS/grant baselines, 204 function definitions/grants, 116 policies preserved across M6 |
| Historical Git/secret/whitespace audit | Passed |

The eight website races cover stale drafts, atomic snapshot versus draft save,
unpublish versus stale publish, two-tenant hostname collision, rotated challenge
versus stale trusted receipt, suspended role after lock wait, early outsider denial
and independent tenant editing. SQL tests use actual anon/authenticated/service
roles, native PostgreSQL RLS/FKs and isolated synthetic academic fixtures. Existing
M4 account, M5 stage preferences, Exams, Lessons, Homework, Groups, Notifications,
Support and student-administration suites remain passing.

Early SQL runs found variable/alias collisions; those were fixed. A later test
needed its domain-row assertion scoped after adding a second binding fixture.
Those failures are retained in ignored local logs and are not counted as passes.
The NULL-expiry constraint was tightened and tested explicitly before final replay.

Tests ran against a new loopback-only cluster and random disposable databases,
never connected Supabase. Each harness database was dropped; final cleanup verified
zero remaining test databases and stopped only the M6 cluster. No Firebase identities,
customer records, real Storage files or provider configuration were changed.

The worktree reuses the existing dependency installation through a node_modules
junction; no install or modification of that installation occurred. An interrupted
dependency copy is preserved under ignored `.local/dependency-copy-incomplete`.
No secret/environment files were copied. The M5 source/worktree/ref remains intact.

This database-only checkpoint does **not** claim browser, real Firebase, real
Storage-byte validation, live custom domains, DNS/TLS or production-build acceptance.
Those belong to subsequent authorized checkpoints; no UI has been fabricated.

Reproduction uses the normal package test list with controlled concurrency:

```powershell
$files = ((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test -split ' ') | Select-Object -Skip 2
node --test --test-concurrency=1 @files
npm run typecheck
npm run lint
npm run check:boundaries
$env:LMS_SQL_RUNTIME = '<existing optional pg/native PostgreSQL runtime node_modules>'
node scripts/exam-sql-local.cjs --postgres
node scripts/exam-sql-local.cjs --postgres --fresh-install
```

The optional native harness requires its own running loopback PostgreSQL cluster
and ignored `.local/step03a/pg-port.txt`; it creates and drops a random database.
Never configure it against a connected project.

## Connected development baseline — read-only only

Project `gmvouqgjbtbkbhrdruzu` remains at **30 applied migrations**. M5A stored SQL
at remote version `20261018210950` still has the exact reviewed SHA-256
`19ee37c9462e7879b987f013928ef41066e23620e5bbd2226353dd2f5152f8bd`.
The five historical timestamp mappings remain unchanged; no history repair ran.

Before/after read-only counts: 10 profiles, two organizations, two courses, three
offerings. M6 website/domain tables and the website-asset bucket are absent.
No connected website/public projection or schema change has been applied.

## Proposed effects, recovery and approval gate

An approved application would create eleven empty RLS tables, fourteen functions,
one projection schema and one private asset bucket, with narrowly explicit grants.
It would introduce three anonymous **Data API RPCs**, even before frontend routes
exist; their availability is part of the SQL approval, not hidden UI behavior.
All return NULL for unknown/unpublished sites. No existing organization is seeded,
published or assigned a hostname, and no existing academic row is changed.

The migration is transactional (`begin/commit`); a pre-commit failure should roll
back the new DDL. After application, prefer disabling publication/grants rather
than dropping history or restoring vulnerable permissions:

- Owner/admin calls `unpublish` with the current website revision.
- Disable domain bindings; trusted operator can revoke proof/asset approval.
- If emergency public-read containment is required, separately authorize revoking
  anon/authenticated EXECUTE on the three public wrappers **and** the three
  `website_public` projections. Keep RLS enabled; do not grant core table access.
- Preserve snapshots/audit and use a reviewed additive corrective migration if a
  schema fix is needed. No destructive down migration or data reset is proposed.
- Do not automatically restore removed grants after a failed regression test.

**STOP here and request new explicit approval for this exact migration/checksum
before touching development Supabase.** Reverify the project, all 30 versions,
baseline and source checksum immediately before any future approved application.

## Remaining 6B and later work

After owner approval, exact remote application and verification: generate connected
database types; implement the existing-dashboard website editor/preview using
the command contracts and contextual owner/admin checks; add a trusted byte-
validated image upload/review/cleanup adapter before enabling uploads. Keep V2 UI.

6C adds explicit public routes, no-store/404/SEO behavior, rate controls and the
existing safe auth/access journey. 6D adds tested TXT verification, explicit host
trust, revalidation scheduling, operational reservation/reclaim policy and a
separately reviewed Caddy/DNS/TLS runbook. No live domain support is claimed here.

No push, PR creation/modification, merge, deployment, protected-branch change,
OVH/Caddy/DNS action or M5 alteration was performed. Stop for owner review.
