# Milestone 6 — Teacher Websites, Branding, Public Catalogs and Custom Domains

Status: **implementation contract; 6A not started.** Owner chose to build this milestone before the combined real-provider acceptance and staging deployment for Milestones 4–5.

## Source of truth and boundaries

- Repository: `EduLabs-LMS/EduLabs-LMS`.
- Work branch: `codex/milestone6-teacher-websites-catalogs`, created from the verified Milestone 5 draft PR #15 HEAD `75a3a7d291830afc832567fc4f7fe9bac30a057b`.
- Stacked ancestry: M6 -> M5 draft PR #15 -> M4 draft PR #14 -> `integration/staging`.
- No modifications to the heads of `main`, `integration/staging`, `integration/milestone4-candidate`, `codex/milestone5-academic-programs-stages`, or PRs #14/#15. Do not merge, force-push or deploy.
- No VPS changes, Caddy changes, DNS/TLS automation, production edits, remote fixture changes, or connected Supabase schema writes without separately approved explicit scope.
- Development Supabase project `gmvouqgjbtbkbhrdruzu` currently has **30 applied migrations**, including M4 private account profiles and M5A academic taxonomy. Consult `docs/development-db-migration-ledger.md`. Five historical Git filenames have distinct remote migration versions. The M5A Git file `20261018203119_academic_programs_stages.sql` was applied remotely as `20261018210950_academic_programs_stages`, SHA-256 `19ee37c9462e7879b987f013928ef41066e23620e5bbd2226353dd2f5152f8bd`.
- **Never run automatic Supabase db push/migration up or repair migration history.** New M6 SQL is local-only until individually reviewed, approved, applied once and verified.
- Existing app authentication is Firebase + verified subject/UUID identity, Supabase RLS is the source of authorization. Do not use Clerk/Prisma for Firebase staging flows. Existing organization provisioning is staff-managed, not tenant self-service.

## Product outcome

One teacher organization operates one existing teacher dashboard and one configurable PUBLIC teaching website. The public site presents the teacher's approved branding, programs/stages and explicitly published course catalog; students can learn about courses anonymously, then sign in/register and follow an existing valid access-request/invitation workflow. Website editing is a staff-authorized feature of the organization, **not** a new tenant or a new dashboard.

The existing course flags are `courses.status` = draft/published/archived and `courses.visibility` = private/unlisted/public. Reuse them. A course appears in general public catalogs ONLY when published + visibility='public', within an active organization, its website is explicitly published, and any other reviewed public-read constraints pass. Unlisted/private never enter browse/search/sitemap. If an unlisted link is offered in the future, design separate explicit capability semantics and do not accidentally publish it now. No public lessons, lesson blocks, videos, assessments/answer keys, homework, profiles, enrollments, progress, student lists, personal emails/phone numbers, private media, tokens or staff records.

## Milestone feature specification

### A. Teacher-controlled presentation

- Each existing organization can manage a website (draft or published) with friendly public slug, organization display name, hero title/subtitle, about section, CTA labels/links, theme preset/accent tokens, optional approved branding imagery, course card presentation and section ordering.
- Make tenant-safe, constrained structured metadata (not arbitrary HTML/CSS/JS, markdown rendering without sanitization, remote iframes, script blocks or user-controlled redirects). Bound every field and enforce safe URLs and asset capability.
- Reuse the green/cream/black EduLabs V2 language (including mobile, RTL Arabic/English and accessible contrast) while allowing teacher branding inside constrained design tokens. Site owner/admin can edit/publish/unpublish; other staff can read preview as appropriate; contextual course-edit rights do NOT grant global site publish/domain rights.
- Draft preview is accessible only to authorized staff. Published public pages never leak draft metadata even if an attacker guesses IDs/slug/Host.
- Treat initial organizations without a site as unpublished; do not auto-migrate existing private data into a public site. An explicit preview and publish operation is required.
- Branding assets require an approved publication workflow: never expose private Supabase storage object URLs or private avatar/course attachments. Design a bounded verified public-asset mechanism and test it before enabling uploads.

### B. Public teacher landing and catalog

- A tenant's public landing page shows approved branding plus explicit published course listings and the teacher-approved, active program/stage names used for filtering.
- Anonymous visitor should be able to view public landing and public course summary/detail pages on an explicitly public URL path such as `/t/[slug]`; choose an architecture compatible with Next.js and the existing Firebase middleware. Don't enable anonymous reads of existing core LMS tables.
- Implement purpose-built allowlisted public DTOs/RPCs/procedures returning ONLY public facts. A `SECURITY DEFINER` function, if used, must have a fixed empty search path, explicit schemas, ownership/permissions reviewed, bounded pagination, tenant scope and grants only for the necessary operations. Existing course, student and staff RLS must not be widened as a shortcut. Avoid service-role-based unfiltered reads.
- A public catalog should never expose private/unlisted/draft/archived courses, draft site content, unpublished programs/stages, enrollment details, teacher/staff identities, private files or unpublished offerings. Be deliberate about which offering metadata, if any, is safe for anonymous viewers; default to none.
- Add safe browser-facing filtering by active program/stage; only public courses are eligible. Existing unassigned public courses appear as general if the teacher chooses to publish them. Maintain deterministic pagination with explicit overflow signals, no truncated-as-empty semantics.
- SEO: metadata, title/description/canonical, robots/sitemap only for verified published routes, no private page indexing. Escape all teacher-controlled text. No cross-origin open redirects, unsafe outbound links, host-header spoofing or cache bleed. Return 404 for unknown/unpublished sites.

### C. Visitor journey

- Public CTAs direct anonymous visitors to existing /sign-in or /sign-up with a validated first-party return target; they do NOT create enrollments, organizations, permissions, Firebase user mappings or make a teacher site an identity provider.
- A signed-in eligible person may continue into the existing access/invitation flow. Never imply a guaranteed enrollment or a working checkout. Existing /access behavior is authoritative; identify any missing join/request capability and mark it explicitly pending instead of inventing a grant.
- Cross-tenant cookies and role context remain on the platform's secured domain; don't casually share auth cookies with arbitrary teacher domains. Model cross-domain login redirects carefully, including exact-origin CSRF and reserved callback domains.
- Payment, automated self-enrollment and public teacher messaging/contact forms are OUT OF SCOPE unless separately approved.

### D. Custom domains (implement safe state machine, no real DNS cutover)

- Platform-owned preview path is first-class and works in local/isolated tests without DNS. A future platform subdomain or teacher custom domain can resolve the same published site through a **verified, unique, normalized, activated binding**.
- Store domain lifecycle as pending -> verified -> active -> disabled/revoked with proof-of-control challenge, last verification, audit/revisions and revalidation policy. Define collision/reclaim/revocation, lowercase/IDNA handling and DNS-change/expiry defenses. Avoid allowing two orgs to claim the same hostname or platform/reserved/staging hostnames.
- Host routing must use an explicit trusted Host/proxy authority allowlist and binding lookup, reject malicious Host/X-Forwarded-Host, IP literals, localhost/loopback/internal targets and suspicious ports. Never use a hostname supplied by an untrusted header to decide which private tenant records to query.
- Any DNS check must NOT fetch arbitrary attacker-provided HTTP URLs or reach local metadata services (SSRF). Design testable DNS TXT ownership proof and explicit trusted-operator certificate eligibility. Prevent dangling-domain takeover on reassignment.
- The existing OVH `infra/Caddyfile` has HTTP Basic Authentication for `APP_HOST`, to protect staging review. **Do not remove it or enable public traffic by broadly changing that host.** Public host TLS/listener, Caddy on-demand TLS policies, certificates and DNS changes require a separate design review, owner approval and operational deployment. Implement local preview/mocked domain-resolution tests and prepare exact staged rollout instructions; if safe public-host DNS/TLS cannot be fully validated, mark as pending rather than claim live custom-domain support.

## Data & security architecture choices for 6A proposal

The existing `organizations` table has id/name/slug/status only; there is no current website/domain schema. Propose additive, tenant-constrained tables such as:
- `organization_websites`: one per organization, private draft and immutable published version snapshot/revision, published/disabled state, bounded configuration fields.
- `organization_website_domains`: normalized globally unique hostname, owner org/site, verification state/challenge/expiration, and activation audit.
- `public_website_assets` or equivalent: references only explicitly approved public images, never a leak of `media_assets` or private Storage.
- Optional `public_site_versions` for atomic publication and consistent public snapshots, if needed after threat-model review.

Use explicit safe public functions and immutable publication constraints; avoid duplicating course identifiers and do not extend enrollment/catalog permissions on existing tables. If course descriptions are rich text/HTML, sanitize and/or provide a safe approved public summary instead of returning private authored HTML.

Do not implement speculative architecture before inspecting all existing schema/helpers/routes and reviewing actual publication semantics. All new data structures must preserve existing academic rows. Archive/unpublish rather than silently delete previously issued domain bindings or published revisions. Define RLS, row grants, executable grants, exact query/data shapes, rate limits, tamper protection, race/optimistic versioning and rollback/recovery.

## Checkpoints and stop conditions

### 6A — Schema, security model and local SQL proof
1. Audit the actual repository branch, database types and migrations, Caddy/Next middleware, existing published course flags and current enrollment request flow.
2. Write the precise website/catalog/domain schema proposal, public/private privilege matrix, threat model and architecture decision records. Explicitly enumerate public DTO fields.
3. Implement additive SQL migrations + functions/RLS in local branch only with safe idempotent tenant and publication rules. Never edit the 30 historical SQL migrations.
4. Run full disposable PostgreSQL replay and existing regression suites; add native SQL tests for anon/public projection, forged tenant/hostname, draft/unlisted/private exposure, unauthorized publish, cross-org asset leaks, domain claims, concurrency, unpublish/archival and migration preservation.
5. Run application tests, typecheck, lint/boundaries at controlled concurrency.
6. STOP with exact file names, SHA-256 checksums, proposed remote effects, regression outcomes, rollback/recovery plan and database baseline. Request a **new explicit owner approval** before touching development Supabase. Prior approvals do not cover M6.

### 6B — Teacher website editor
1. Use approved schema after verified remote apply, only when owner authorizes. Do not apply by default.
2. Add a staff-authorized website settings/editor integrated in existing teacher dashboard with branding, localized copy, catalog configuration, public/draft toggles, live preview, responsive and accessible components. Course public status remains separate from website publication.
3. Use existing session/CSRF/role/RPC patterns. Test forbidden staff roles, org swaps, optimistic conflicts, false success, asset approval, sanitization and preview-only draft access. Keep original V2 UI intact.

### 6C — Public routes & discovery
1. Add safe anonymous public landing, catalog, course summaries and taxonomy filters with accurate 404/robots/cache semantics.
2. Wire existing signup/sign-in/access journey, preserve user identity and enrollments, never allow public pages to inherit private dashboard authorization.
3. Test two organizations, private/unlisted/draft classifications, markup injection, cache/canonical leakage, pagination and mobile/RTL, as well as SEO semantics.

### 6D — Domain claims, HTTPS rollout design and security tests
1. Implement authorized domain binding management and proof verification state machine.
2. Implement local-only routing for verified domains through a trusted-host resolver; test host/X-Forwarded-Host attacks, spoofing, rebinding/races, port and IDNA edge cases.
3. Produce OVH/Caddy/DNS/TLS runbook including a separate public host and operational checks. Do not activate external domain/DNS/cert changes or relax existing Basic Auth. Mark external end-to-end HTTPS pending until approved.

### 6E — Integrated release candidate, PR, acceptance plan
1. Full application, TypeScript, boundaries, lint, native DB replay, SQL/concurrency/browser mobile/desktop tests and both supported production builds; no fake pass claims.
2. Security review across existing auth/RLS, M4 account, M5 stage choices, new anonymous websites and header/caching protections.
3. Read-only verify development Supabase migrations/history/privileges and prepare exact real-provider + DNS acceptance plan, using synthetic fixtures with owner authorization.
4. Create DRAFT stacked PR targeting `codex/milestone5-academic-programs-stages`; do not merge/deploy.
5. Record exact commits, SQL mappings, pending real-login, Storage, public-domain, DNS and staging gates. Keep all prior drafts and branches unchanged.

## Completion criteria

One organization can configure/preview a branded teaching site and explicitly publish a safe public catalog with only intended published course facts, teacher-approved taxonomies and access CTAs. Domain claim and routing are secure in local tests, with real HTTPS cutover explicitly gated. Student login, classroom and academic data remain protected. Original database is not behind the code: every new milestone schema must be reviewed, individually approved and verified in development Supabase before completion, and old migrations must never be replayed.

Real Firebase/Supabase account/Storage acceptance for M4–M6 and public-domain operations remain a separately authorized combined release gate.
