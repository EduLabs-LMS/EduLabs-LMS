# Milestone 6D — inactive custom-domain rollout runbook

Status: design for a separately approved deployment. **Nothing here is installed or enabled.**
The current `infra/Caddyfile`, Compose files, staging Basic Auth, listeners,
Firebase configuration and connected database are unchanged.

## Boundaries and deployment topology

Keep the existing exact staging host and its entire Basic Auth block. It continues
proxying only to the private LMS. Do not use `PUBLIC_WEBSITE_ALLOWED_HOSTS=*`,
remove Basic Auth, add arbitrary customer hosts there, or forward public requests
to the private application with an overridden staging Host.

Future public topology:

1. TLS edge accepts only reviewed customer names. At the TLS edge require HTTP
   authority to equal validated SNI; reject missing/multiple authorities and
   unknown names, including before redirect construction. Never redirect to an
   unvalidated raw Host. Keep the staging hostname on its existing protected route.
2. A separate signing gateway strips client `X-Edulabs-*`, `Forwarded`,
   `X-Forwarded-Host`, Authorization and Cookie headers. It canonicalizes the exact
   public authority and request target once, authenticates to a private renderer,
   and generates the HMAC envelope implemented in `domain-routing.ts`.
3. The public renderer accepts requests only from that gateway over an isolated
   network/mTLS and the configured exact transport authority. It has a publishable
   Supabase key only, no Firebase Admin/service-role credentials, no private LMS
   routers, no customer cookie forwarding and no general proxy/fetch endpoint.
4. Renderer uses only `resolve_teacher_website` and the 6C anonymous public catalog
   projection. Binding is checked before and after catalog loading. Canonical URLs
   stay at the platform `/t/[slug]` fallback. No cross-domain login session is set.
5. Global/domain and per-site durable admission services fail closed. They cannot
   be bypassed by directly reaching the renderer's port. Bind internal listeners to
   the private container network; firewall them externally.

The reusable resolver is implemented; **the gateway, isolated renderer HTTP entry
point, mTLS/nonce store and custom-domain asset delivery are not deployed or wired**.
The current app exposes no custom-domain handler. Stock Caddy does not implement
our HMAC signing protocol; use a separately reviewed gateway, never a fabricated
Caddy directive. A plain `reverse_proxy app:3000` does not satisfy this boundary.

For the first rollout, prefer an explicit allowlist of a few reviewed hostnames.
A reviewed change to the existing edge can add public routes while preserving the
exact staging matcher and Basic Auth. Alternatively use a separately authorized
public IP/ingress host. Do not bind a second service to the existing 443 listener
or purchase anything without approval. No catch-all TLS issuance is enabled now.

## Claim and operator verification

Owner/admin uses Website Studio to claim an ASCII hostname. The existing database
retains a unique binding even when disabled/revoked; collisions require an audited
support dispute. There is no automatic transfer. Normal teacher/assistant roles
can view status but cannot mutate claims. The application omits their TXT proof;
this is not treated as a secret (it eventually appears in public DNS).

Before any real activation, reserve **all actual platform/staging/ingress suffixes**
in `private.website_reserved_domains` through a reviewed operation. Fixed provider
suffixes are already reserved. `APP_ORIGIN` and optional comma-separated
`WEBSITE_RESERVED_HOSTNAMES` also block application claims; the verifier and routing
settings must independently receive the canonical complete reserved list. Database
reservation remains essential because direct RPC clients can bypass application
validation. No reserved-domain rows were changed in 6D.

TXT record:

- Full name: `_edulabs-verification.<claimed-hostname>`.
- Value: exact current 64-character challenge, no literal surrounding quotes.
- Registrar UI may require a relative label if it appends the zone.
- The challenge expires in 24 hours. Rotation immediately invalidates old proof,
  certificate eligibility and active state. Disabled claims can rotate to pending;
  revoked claims cannot be revived. Retained history counts toward the ten-claim cap.

Provision a least-accessible trusted operator process, with separately stored
runtime-only service credentials, authenticated operator identity, approval ticket,
strict audit and request budget. Do not add a service key to Next public variables,
website API handlers, images or browser bundles. The existing service-only
`review_website_resource` RPC is the privilege boundary; owners cannot impersonate it.
The injected loader must return the exact binding and active organization; no
arbitrary organization chosen by a browser may substitute its record.

`verifyDomainOwnership` checks organization/site/id/revision and current proof,
performs one TXT lookup using the server's configured OS DNS resolver, then
rechecks scope, revision, proof and deadline before the locked RPC. Node resolver
tries once with a two-second native timeout and three-second hard deadline;
responses are bounded to eight records, eight chunks per record and 1 KiB aggregate.
Split strings are reassembled; duplicate identical records are accepted; conflicting,
missing or oversized responses fail closed. No user resolver, HTTP URL, A-record
fetch or private-address HTTP probing is supported. Use trusted public recursive
DNS in the eventual operator environment; split-horizon DNS and DNS compromise
are operational threats, not proof of publicly reachable HTTPS. No DNSSEC validation
or live public DNS acceptance is claimed by this adapter.

DNS success sends a scoped audit receipt and **`certificateReady:false`**. The
configured adapter currently always returns 503 before DNS/review. A separately
reviewed operator integration must enable it; there is no teacher verification API.

## HTTPS eligibility, issuance and renewal

After separate owner authorization:

1. Verify ownership and approved published site; confirm exact host, revision,
   reserved-name exclusions, no ownership dispute and unexpired verification.
2. Ask customer to create A/AAAA to the approved edge; a subdomain may CNAME an
   approved ingress name. Do not publish AAAA unless IPv6 actually works. Root
   CNAME/flattening depends on DNS provider. Treat these as DNS instructions, never
   an automatic DNS update. Do not take customer DNS-provider API credentials.
3. Check routing, CAA, external reachability and ACME eligibility through reviewed
   operator tooling. Use ACME staging for a separately approved certificate test.
   Keep certificate storage persistent, encrypted/backed up with restricted access.
4. Record a distinct operator certificate-eligibility review using the exact
   current proof and fresh domain revision. The existing review RPC can set
   `certificateReady:true`; this is eligibility, **not proof of a certificate**.
5. Obtain and externally validate the actual certificate/SNI chain before allowing
   content routing. If issuance/probe fails, keep content disabled and remove
   eligibility through trusted review. An ask/issuance service must be internal,
   bounded and fail closed; do not use the active-only public resolver to decide
   initial issuance, which would create a verification/activation cycle.
6. Activate through the existing owner-authorized RPC only after successful
   operator HTTPS approval and the separate ingress readiness gate. The teacher
   website API deliberately has no `domain.activate` action yet. Enabling that
   UI/HTTP flow requires a separate reviewed change. Re-read publication and
   ownership status on every public request; no indefinitely cached mapping.

Automatic HTTPS is described by [Caddy's official documentation](https://caddyserver.com/docs/automatic-https).
If later adopting on-demand TLS, configure an explicit authorization decision and
issuance budget; never allow arbitrary client SNI to trigger unrestricted issuance.
Preserve staging's static exact-host configuration. Renew only currently eligible
names, monitor renewal failures, certificate expiry and ownership expiry separately.
Certificate renewal does not extend the database's seven-day ownership validity.

**Existing SQL lifecycle limitation:** review resets even an active domain to
`verified`, and requires the 24-hour challenge still to be valid. Review grants
seven days of ownership. Revalidation therefore needs deliberate rotation, new
TXT proof, DNS review, certificate eligibility and reactivation; it can interrupt
routing. Schedule controlled maintenance before expiry, alert at least 48/24 hours
before ownership expiry, and use the stable platform fallback during maintenance.
Seamless background proof renewal requires a separately approved SQL design; do
not change expiry values directly or silently claim continuous availability.

## Signed ingress contract

Trusted server settings: exact HTTPS platform origin, exact private transport
Host, random minimum-32-character secret from runtime secret storage, canonical
reserved host list, enabled flag. Current exported status remains disabled.
No environment switch currently exposes an HTTP endpoint.

Headers are `X-Edulabs-Authority`, `X-Edulabs-Issued-At` (epoch milliseconds),
`X-Edulabs-Nonce` (128-bit random lowercase hex), `X-Edulabs-Signature` (SHA-256 HMAC
lowercase hex). Sign these exact newline-separated fields, with no final newline:

```
edulabs-domain-v1
<canonical-public-host>
<GET-or-HEAD>
<pathname-plus-query>
<issued-at>
<nonce>
```

Maximum age is 30 seconds, allowed future skew five seconds. Share atomic nonce
consumption across all instances with expiry; record before rendering and never
use a process-local fallback. Rotate proxy secrets through a separately reviewed
cutover; a mismatched secret must deny requests. HMAC covers path/query/method;
forwarded headers never select a tenant. Enforce trusted SNI/Host equality at edge
and exact canonical signed host/transport Host at renderer.

Only `/` and `/courses/<uuid>` are allowed. Root query accepts unique `stage`,
`after`, `limit` (6/12/24); course URLs accept no query. All auth, admin, API,
review, private assets, unknown routes and custom-host sitemap paths are denied.
The platform sitemap remains authoritative. Returned platform paths are validated
local public paths; never use arbitrary redirects or private-route rewrites.

A future renderer must preserve 6C no-store, CSP, no cookies, no private error
messages, canonical platform links, anti-indexing for errors and HTTP status
semantics. It must explicitly serve only approved immutable public CSS/font assets
or use a separately reviewed public asset origin/CSP. Do not forward arbitrary
`/_next` or private image/media paths. Do not enable customer domains before those
asset/CSP and real-browser HTTPS checks are complete.

## Durable abuse controls and direct Data API exposure

6C already POSTs to a configured exact HTTPS decision URL with a runtime bearer
credential, `{bucket:'edulabs-public-websites',site,cost}`, three-second deadline,
no redirects and strict bounded response `{allowed,retryAfterSeconds}`. Absent or
failed enforcement returns 503; denial returns 429. This is a contract, not a
running limiter service. The new resolver additionally requires atomic nonce,
global/domain budget **and per-site budget** ports before projection. Map aliases
to a single website/site budget so ten domains cannot multiply its quota.

Provision a durable Redis transaction/Lua or equivalent atomic service. Example
initial review targets (not active configuration): global 120 requests/second,
site 30/minute with burst ten, domain 30/minute, issuance five/day/site. Charge by
query cost (one normal page; bounded larger pages/sitemaps cost more). Choose exact
limits from an approved capacity/cost test, not from these examples alone. Expire
counter keys; bound unknown-host cardinality; admit only configured sites; apply
small global budgets before database lookup. A limiter outage denies public
traffic, never falls back to unlimited service. Monitoring itself must be bounded.

Gateway credentials identify the application service; no client IP header is
trusted. If visitor limits are added, accept only identity from the authenticated
edge and use short-lived salted hashes, never raw IPs in routine logs. Protect
the decision service with private networking/mTLS and credential rotation. Don't
rely on a reusable static browser token or untrusted `X-Forwarded-For`.

**Hard launch blocker: direct Supabase anonymous RPC traffic.** A WAF on a customer
hostname cannot protect the project's original `*.supabase.co/rest/v1/rpc/...`
endpoint. Anonymous projection EXECUTE remains intentionally granted. RLS and safe
DTOs protect confidentiality; they do not enforce request/cost budgets. Before
public launch, implement and verify provider-native API enforcement that covers
that original endpoint, or separately approve a PostgREST pre-request durable
limiter that also covers these RPCs. A database pre-request hook only covers the
Data API, not every Supabase product; assess exposed products separately. If the
chosen provider tier cannot enforce this, stop public launch and review a
server-only projection boundary instead. No such permission/schema change is
included in 6D. See [Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api).

Acceptance before exposure must send direct original-endpoint requests as well as
routed requests; verify aggregate/global/site limits across instances, aliases,
restarts and concurrency, bad credentials, replay, timeouts and limiter outage.
Measure p95 latency, DB connections/CPU/egress, denial rate and monetary budget.
No public load test, real provider enforcement or production cost claim has been
made in this checkpoint.

## Monitoring, incident response and rollback

Emit sanitized request id, binding id, publication version, decision/status,
latency and coarse failure reason. Never log TXT proof, HMAC, cookies, tokens,
private payloads or full URLs/query strings. Use bounded log retention and
provider budget alerts. Monitor DNS failures, expiry, disabled-domain hits,
issuance rate, certificate expiry, 409/421/429/503, API egress and role changes.

On suspected ownership loss: deny the host in the edge eligibility service,
disable binding through the authorized workflow (revocation for an adjudicated
permanent incident), invalidate any mapping/cache, stop renewals, retain audit
history and notify the owner. A valid leftover TLS certificate must not restore
content routing. Do not automatically release/transfer a retained hostname.

Rollback public ingress by removing only its approved route/gateway, disabling
custom-domain serving and restoring the reviewed prior Caddy configuration.
Keep the exact staging matcher/Basic Auth and private LMS untouched. Revalidate
configuration before any reload. Platform `/t/[slug]` remains the fallback only
when its separate public abuse controls are configured. No database downgrade,
RLS relaxation, migration replay or customer record deletion is part of rollback.

6E must obtain separate approval for credentials, DNS, certificates and deployment,
then prove real HTTPS/SNI, session isolation, cache/CSP/assets, original-Data-API
abuse protection, cross-browser/mobile and controlled load behavior. None of these
external operations are authorized or performed by this document.
