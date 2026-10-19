# Combined M4–M6 real-provider acceptance procedure

**Prepared only. Do not execute without a new owner authorization.**
Projects proposed for approval: Firebase `diagonproduction`, development Supabase
`gmvouqgjbtbkbhrdruzu`. No connected fixtures, accounts, files, DNS records or
certificates were created by 6E. Local fixture browser tests are not substitutes
for this procedure. No production environment is in scope.

## Gate 0 — scope, exact source and cleanup capability

1. Owner approves exact candidate SHA, target projects, controlled test identities,
   fixture manifest, runtime origin, allowed operator and cleanup mechanisms.
   Verify these projects are not serving independent real users before mutation.
2. Use an isolated candidate checkout/build at that exact SHA. Do not test an older
   staging deployment. Use separate ignored output/config hooks, loopback binding,
   a reviewed local HTTPS proxy and fresh Chromium desktop 1440x1000/mobile 390x844
   contexts. Do not stop or repoint existing app/demo servers.
3. Record all 31 migration versions, M6A exact checksum, table/function/RLS/grant
   metadata, reserved hosts, counts and content digests of existing academic rows.
   Never record personal row contents or credentials in reports. Reconcile against
   `development-db-migration-ledger.md`; no migration replay/history repair.
4. Create a unique run UUID. Store a protected ignored manifest of every exact
   created Firebase UID, Supabase profile/org/course/offering/stage/website/asset/
   domain/publication/audit id, Storage bucket+path, session and process id.
   Design dependency-order cleanup before creating anything.
5. Minimum proposed isolated identities: owner A, owner B, ordinary course editor A,
   student A1, student A2 and student B. Use controlled inboxes if email delivery
   is tested. An explicitly approved Admin-provisioned verified synthetic identity
   proves authentication/session behavior only; it does not prove email delivery.
   Random passwords, tokens and browser state remain outside Git and reports.
6. Verify exact Storage API deletion capability before any avatar or website-image
   upload. If only manual dashboard deletion is available, obtain that agreement
   first. Do not create orphan objects or delete `storage.objects` through SQL.
7. Build-time names: `NEXT_PUBLIC_AUTH_BACKEND=firebase-staging`,
   `LMS_DATA_BACKEND=supabase-staging`, existing Firebase public config variables,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Runtime needs exact `APP_ORIGIN` and existing protected Firebase Admin/attestation
   configuration. Never copy credential files or expose privileged keys to browsers.
   Start through the existing reviewed local launcher; validate Secure cookies,
   exact-origin CSRF and authorized Firebase origins. Missing providers/configuration
   are blockers, not permission to change shared settings.

## Gate 1 — read-only/provider checks (no new records)

- Verify project identities, migration checksum/history and current role grants.
  Anonymous direct core-table/column SELECT and authenticated trusted review must
  remain denied. Confirm private website/avatar buckets and restrictions.
- Confirm zero website/domain/catalog/publication fixtures or explicitly document
  any separately authorized existing records; never delete them by naming pattern.
- Inspect deployment configuration and original Data API abuse enforcement
  read-only. Record missing admission services rather than enabling traffic.
- Without a configured gateway the public HTTP route must return sanitized 503;
  no rate-budget/provider acceptance pass is inferred from a fictional stub.
- OAuth availability, email delivery, certificate issuance and upload behavior
  cannot be proven from these checks. Mark them untested until separately approved.

## Gate 2 — approved connected synthetic data and actual sessions

After approval only:

1. Create identities through trusted Firebase tooling; sign in through actual
   Firebase browser SDK and the verified application onboarding/session flow.
   Do not directly insert identity mappings or impersonate another UUID.
2. Provision synthetic organizations A/B and initial active owners atomically via
   the existing trusted manual boundary. Do not regrant self-service organization
   creation. Add contextual editor and enroll students in dedicated offerings
   through authorized workflows; registration alone grants no academic access.
3. Teacher/student login: confirm contextual badges, correct recipient/profile,
   refresh/resume, logout cookie clearing/revocation and protected-route denial.
   Verify A1 cannot read A2 or B private records with app and direct caller-token
   Supabase requests. Never log tokens or reuse a real person's credentials.
4. M4 account: save synthetic first/last name and onboarding; refresh, logout/login
   and verify persistence. Use only run-owned PNG/JPEG/WebP avatar; test invalid
   signatures, size, revision conflict, authorized private delivery, peer denial,
   replacement/removal and real API cleanup. Provider-avatar import and OAuth
   tests need their own controlled provider identity. Test real inbox verification
   delivery/link separately; do not claim Admin verification covers it.
5. M5 teacher: create two programs/stages per organization, edit/reorder/archive,
   classify one synthetic course into multiple same-tenant stages and leave a
   general course. Editor may classify an assigned course but not manage taxonomy.
   Test two-tab 409, archived-choice recovery and foreign-tenant IDs.
6. M5 student: save independent preferences per program, refresh/resume, clear one,
   switch All My Courses/selected stages/general. Verify offering-specific progress
   and the account profile survive. A stage choice must never grant enrollment,
   private lessons, another cohort or draft media. Preserve academic history.
7. Studio: owner creates one draft with explicit public text, eligible published
   public course and stage consent. Ordinary teacher is read-only; student/tenant B
   is denied. Save draft/catalog independently, confirm stale-write 409 retains
   unsaved fields and explicit recovery. Publish through the actual authenticated
   API/RPC and verify real database snapshot/version.
8. Anonymous browser: use a new context with no session/cookies and a real configured
   durable gateway. Browse `/t/[slug]`, stage filters, pagination, course detail and
   sitemap. Confirm true 404/400/409/429/503 states, trusted canonical, no-store,
   CSP, no Firebase payload/cookies/private files. Verify desktop/tablet/mobile/RTL.
9. Change only run-owned course public→private/unlisted/draft/archived; public
   detail/catalog/sitemap must stop exposing it immediately without republishing.
   Test unpublish, organization suspension and live stage archival using approved
   synthetic records only. Restore or delete only manifest-owned fixtures.
10. CTA journey: Sign in/Register/Access stay at the configured platform origin.
    `/access` still requires a valid teacher invitation; a slug or selected stage
    grants nothing. Confirm no customer-domain cookie/identity-provider boundary.
11. Exercise existing Lessons/Exams/Homework/Groups/Notifications/Support navigation
    read-only where possible; any academic submissions must be manifest-owned and
    explicitly approved. Do not weaken grading/retry/media authorization.

## Gate 3 — website images: implementation plus provider acceptance pending

Current Studio upload/review/delivery APIs do not exist and upload is disabled.
The byte normalizer and SQL asset ledger are not a working end-to-end image flow.
Do not treat an environment variable or service key as completing this gate.

Before enabling, implement/review an identity-bound bounded upload/reservation
adapter, actual-byte normalizer, exact-path private Storage writer, operator-only
review, approved public delivery and Storage API cleanup. No such code or schema
change is authorized by this prepared acceptance plan alone.

Once separately approved and implemented:

- Normalize run-owned images; verify decoded signatures, dimensions/single frame,
  output size/hash, metadata stripping and a new dedicated website object.
- Review exact returned bytes through trusted service tooling; owner/student must
  not self-approve. Reference only approved same-site assets and explicitly publish.
- Test real image delivery without leaking object paths, signed private assets,
  avatars or classroom attachments. Revoke approval/unpublish and confirm denial.
- Test forged/cross-site ids, malicious formats, oversized uploads, abandoned or
  failed writes and concurrent replacement. Confirm exact API object deletion
  before deleting dependent run-owned asset ledgers. No upsert over existing files.

## Gate 4 — operational domains, limiter and HTTPS: separate approval required

Use `milestone-6-domain-operations.md`. Nothing in this plan authorizes DNS,
Caddy, certificates, ingress listeners, paid services or provider configuration.

Before execution, review/install trusted operator authentication and runtime-only
credentials, safe binding loader/audit, approved reserved host list in the database,
fixed trusted DNS environment, durable global/domain/site budgets, shared atomic
nonce store, SNI/authority-checking signing gateway, isolated public renderer,
public-only static assets/CSP and real original-Supabase-Data-API controls.
Actual HTTP rendering/asset ingress and operator wiring remain implementation work.
Keep staging Basic Auth and private app routing intact.

Then, with explicit domain-owner and operations approval:

1. Claim a controlled synthetic domain; inspect exact current TXT challenge. Add
   only its approved DNS record. Exercise missing/mismatched/conflicting/rotated/
   expired proof and stale revision; no arbitrary HTTP fetch or user DNS resolver.
2. Run the trusted verifier and inspect actual audit receipt. Verify only DNS
   ownership succeeds; certificate readiness remains false. Teacher/student direct
   review attempts must fail. A/B collision and transfer attempts must fail.
3. Independently verify A/AAAA/CAA/edge eligibility and certificate issuance, chain,
   hostname/SNI and renewal under the reviewed operational plan. DNS is not TLS.
   Record operator eligibility and activate only after real HTTPS validation.
4. Test signed ingress, nonce replay/expiry/skew, forged Host/forwarding headers,
   cross-tenant lookup, private/auth/API path denial, expiry/disable/revocation,
   unpublish during request, cookie isolation and platform canonical fallback.
5. Verify global/site/alias budgets across processes/restarts/concurrent requests;
   outage must fail closed. Test the original supabase.co RPC endpoint separately.
   A WAF on the custom domain is not evidence of original Data API protection.
6. Check browser assets/CSP on the actual HTTPS customer host, desktop/mobile,
   Firefox/WebKit and bounded authorized load. Record renewal/ownership maintenance
   downtime: current review resets active to verified; no seamless renewal claim.

## Cleanup and evidence

Whether acceptance passes or fails:

1. Stop synthetic browser sessions, revoke temporary Firebase sessions, and record
   exact remaining objects before cleanup. Do not delete pre-existing resources.
2. Delete each manifest-owned Storage object via API/dashboard, independently verify
   absence, then remove only its dependent run-owned records. Preserve any manifest
   and report if deletion cannot be completed. Never delete Storage metadata via SQL.
3. Remove only manifest-owned academic/enrollment/preference, publication/domain/
   asset/audit and synthetic organization rows in a separately verified dependency
   order. Respect immutable ledgers/FKs; if privileged cleanup requires a special
   reviewed transaction, prepare it for approval. Never relax constraints to clean up.
4. Remove only run-owned profiles/identity mappings and Firebase users through trusted
   tooling after dependencies and session revocation. Reconcile exact UIDs and IDs.
5. Remove only approved run-owned DNS/certificate/ingress resources if operational
   tests were authorized. Do not remove shared certificates/configuration or weaken
   staging auth. Restore explicitly approved temporary settings to their baseline.
6. Compare original row counts/digests, migrations, policies, grants and protected
   Git refs. Stop only run-owned processes. Record immutable provider audit/usage
   effects and any leftovers honestly; do not promise literal provider restoration.
7. Publish sanitized screenshots/results for each real workflow and browser. Keep
   passwords, tokens, private keys, inbox links, manifests and raw sessions ignored.
   Classify local simulated, real provider passed, failed, blocked and untested
   separately. Owner approval remains necessary for integration/deployment.
