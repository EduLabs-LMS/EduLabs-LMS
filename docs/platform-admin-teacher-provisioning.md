# Platform Admin: Teacher Provisioning V1

Status: implemented locally on branch `claude/admin-provisioning-v1` (base `d3451e5`; release candidate `0f9b889`
plus the uncommitted invitation-link onboarding described below). **The two migrations are authored but NOT applied to any
database.** No provider (Firebase, Supabase, Resend, Cloudflare) was contacted. Local verification used a disposable
loopback PostgreSQL and a fictional-HTTP browser harness only.

## What an administrator can do

1. Create a teacher portal for an intended teacher email (no display name, no website name).
2. Configure the first educational path: Education System, optional Examination Board, Grade
   Level, Subject, First Course. Missing pieces are added inline without losing the form.
3. Review, then create the portal, academic records, empty course and invitation in ONE
   database transaction. Any failure leaves nothing behind.
4. Inspect portals and invitation status; **send the invitation by e-mail**, **copy the invitation link**, replace the
   invitation (supersedes the pending one) or revoke it. The page states honestly whether an e-mail was actually accepted by
   the e-mail service (see "Invitation link onboarding").

The teacher is **not** an owner at creation. Ownership is granted only when the invited
person, signed in with a verified Firebase identity whose verified email equals the invited
email, accepts the invitation.

## How it maps onto the existing model

| Concept | Existing table | Change |
|---|---|---|
| Portal | `organizations` (neutral name, generated slug, no domain, `created_by` null) | none |
| Education System | `academic_programs` | `+ examination_board text null` (optional, 1-120 chars) |
| Grade Level | `academic_stages` | none |
| Subject | **new** `academic_subjects` (tenant-owned, RLS) | new table; there was no subject entity |
| Course | `courses` | `+ subject_id` with composite tenant FK `(organization_id, subject_id)` |
| Course placement | `course_stage_assignments` + `private.course_stage_versions` | none |
| Owner | `organization_memberships` (`owner`) | created only at acceptance |

Everything is tenant-owned; there is no global catalog or preset. Existing tenants and
records are not backfilled or rewritten. The earlier disconnected global catalog
(`education_systems`, `grade_levels`, `subjects`, `grade_level_subjects`) was never applied
and has been removed.

## Security design

- `private.platform_admins` (RLS, no grants) + `private.is_platform_admin()` from the
  verified identity (`private.current_app_user_id()`); never a role badge, claim or client value.
  Administrators receive no implicit tenant read access (tested).
- Invitations live in `private.teacher_invitations`: email-bound, SHA-256 hash only
  (`bytea`), one pending and one accepted per portal, expiring, revocable, auditable.
  The Node server generates the 256-bit secret, sends only its hash, returns the secret once;
  it is never stored or logged.
- `accept_teacher_invitation` locks organization, profile, invitation; requires verified
  email and active Firebase identity; tenant comes from the stored invitation only.
  Errors: `PT404` unknown, `PT409` used, `PT410` revoked/expired, `42501` mismatch.
- `private.platform_audit` is append-only (update/delete/truncate raise `42501`).
- Every privileged RPC re-checks administration in the database. HTTP routes add exact-origin
  checks on writes, JSON-only, 32 KB cap, strict zod bodies, no query strings, `no-store`.

## Routes

`/platform-admin/teachers`, `/new`, `/[portalId]`; `GET|POST /api/platform-admin/portals`,
`GET|POST /api/platform-admin/portals/[portalId]` (`reissue`/`send_email`/`revoke`),
`POST /api/teacher-invitations/preview`, `POST /api/teacher-invitations/accept`; the teacher-facing page is `/teacher-invitation`. All require Firebase staging mode
(`isFirebaseStaging()`); outside it they are 404. **Production prerequisite:** this gate is
a staging-only deployment switch, not an authorization boundary; production activation needs
separate approval.

## Bootstrap

No UI/API grants administration. A trusted operator runs
`supabase/manual/bootstrap_platform_admin.sql` (and `revoke_platform_admin.sql`) with the real
Firebase UID copied from the console. Nothing in the repo contains a real UID.

## Invitation link onboarding

An invitation is a private link, `<APP_ORIGIN>/teacher-invitation#<secret>`. The administrator can e-mail it to the address recorded
with the invitation or copy it to share privately (for example by message). The teacher opens it, signs in with the **existing**
EduLabs sign-in (no separate invitation login, nothing to paste), and explicitly accepts.

### Teacher flow

1. The page reads the secret from the URL **fragment** (browsers never send fragments to servers or in `Referer`), saves it in
   this browser for at most two hours so it survives sign-in, account creation, Google sign-in, e-mail verification and redirects,
   and removes it from the address bar. Nothing is sent to the server before the teacher is signed in.
2. Signed out: links to `/sign-in?next=/teacher-invitation` and `/sign-up?next=/teacher-invitation` (no secret in the redirect).
   `firebase-form.tsx` allows that one extra destination and also returns a signed-in teacher with a stored invitation to it.
3. Signed in but unverified: asks to verify the e-mail first.
4. Verified: `POST /api/teacher-invitations/preview` (read-only, signed-in Firebase viewer, same-origin) returns
   `valid | expired | revoked | used | unavailable`, whether the verified e-mail matches, whether *this* user already accepted it,
   and the invited address **masked** (`t***@example.com`). It never consumes the invitation.
5. Only an explicit click on **Accept invitation** calls `POST /api/teacher-invitations/accept` (the existing RPC, which re-checks
   everything under row locks: verified Firebase identity, exact e-mail match, pending, unexpired, unused). Ownership of the
   teaching space is granted only there; Platform Admin is never granted.
6. If the teacher's account profile has no first and last name, the page asks for them (prefilled from the sign-in provider's name when there is one) **before** offering Accept, saves them through the existing account endpoint and marks the profile complete, and does not accept anything. Accounts that already have a name skip this step and are never rewritten. Success continues to `/teacher/courses`. A network failure or 5xx during accept is an **unknown outcome**: the page never
   resends; it offers "Check status", which uses the read-only preview (an accepted invitation shows as "already accepted by you").

### Security properties

- 256-bit random secret (`randomBytes(32)`, base64url); only its SHA-256 is stored; the secret exists in server memory for the
  request and in the link. Single use, expiry, revocation and exact-e-mail match are enforced by the database.
- The link origin comes only from `APP_ORIGIN` (exact HTTPS origin; `http://localhost` only when `NODE_ENV=development`), never
  from a request `Host`/`X-Forwarded-*` header. If it is missing nothing is created or rotated (`origin_not_configured`).
- **One invitation, one link.** The link secret is `base64url(HMAC-SHA256(INVITATION_LINK_KEY, salt))` with a random 16-byte salt stored
  beside the invitation. The database keeps only the SHA-256 of the secret (checked on acceptance) and the non-secret salt, so a
  database copy cannot reproduce any link; the server key alone cannot either. **Send invitation email** and **Copy invitation
  link** re-derive the same link and never create or rotate anything, so copying cannot invalidate an e-mail that was sent or that
  might have been delivered (for example after a timeout), and a page reload is harmless. Only **Replace invitation**
  (`reissue`) issues a new link, supersedes the old invitation (the old link and any e-mail carrying it stop working) and says so
  before and after. If the salt could not be stored the link is shown once and marked not reusable; Copy/Send then ask for a replacement.
- E-mail goes only to the address stored in the invitation row (`send_email` and `copy_link` accept no body fields at all).
- No server or browser code in this feature logs; error bodies are fixed, localisable messages that never echo the token.
  `/teacher-invitation` and the API replies are `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`,
  `Referrer-Policy: no-referrer`.
- The invitation secret is never in a query string (a query on the API is rejected) and never in analytics.

### E-mail delivery and what "sent" means

Provider: Resend, already used for support mail (`resend` package). Configuration (server only; none of these are `NEXT_PUBLIC_`):

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key (shared with support mail if that is configured) |
| `INVITATION_EMAIL_FROM` | Verified sender, `Name <address@domain>` or a bare address |
| `APP_ORIGIN` | Canonical public origin used in links |
| `INVITATION_LINK_KEY` | Secret server key (at least 32 characters, never `NEXT_PUBLIC_`) from which link secrets are derived. Without it nothing is created, rotated or sent (`link_key_not_configured`). Changing it makes every pending link un-copyable: replace those invitations |

Order of operations for **Send invitation email**: check origin, link key and mailer configuration (no change if missing) -> read the
active invitation's salt and re-derive its link (nothing is rotated) -> record `sending` and receive the attempt number (if this
fails nothing is sent) -> call the provider once with idempotency key `teacher-invitation-<invitationId>-<attempt>` -> record the
verdict. Sending again is a deliberate administrator action that re-sends the same link as a new numbered attempt (at most 5 per
invitation; an attempt with no verdict can be repeated only after 60 seconds). Delivery states shown to the administrator:

| State | Meaning |
|---|---|
| No email sent | No attempt for this invitation |
| Accepted by email service | The provider returned an id. This is **not** proof the message reached an inbox |
| Email not delivered | The provider refused the request (4xx). Nothing was delivered |
| Unconfirmed | No verdict (timeout, 5xx, dropped connection). The e-mail may or may not have been sent; it is **not** retried automatically |

If the provider verdict cannot be saved the administrator is told the real verdict and that the stored status may be stale.

### Final link design (summary)

- Each invitation has a random 16-byte **salt** (stored, not secret) and the link secret is `HMAC-SHA256(INVITATION_LINK_KEY, "teacher-invitation-link-v1:" + salt)`, base64url. The key must be at least 32 characters, lives only in server configuration, and is never sent to the browser or the database. The database stores the secret's SHA-256 (used on acceptance) and the salt.
- **Send invitation email** and **Copy invitation link** reuse the same link for the active invitation; neither rotates, replaces or invalidates anything.
- **Replace invitation** is the only action that rotates: it supersedes the old invitation, so the old link, its salt and any e-mail carrying it stop working immediately, and the new invitation starts with no delivery history.
- **Revoke invitation** ends the invitation: nothing can be copied, sent or accepted afterwards.
- If `INVITATION_LINK_KEY` is rotated or removed, existing pending links can no longer be re-derived (Copy/Send refuse, acceptance of already-shared links stops matching): replace those invitations.

### Staging environment required (names only; values are set by the operator, never committed)

- `APP_ORIGIN` (exact public HTTPS origin used in links)
- `INVITATION_LINK_KEY` (secret, 32+ characters)
- `RESEND_API_KEY` (only for e-mail)
- `INVITATION_EMAIL_FROM` (verified sender, only for e-mail)

### Migration 33

`supabase/migrations/20261025100000_teacher_invitation_delivery.sql` is additive: six `private.teacher_invitations` columns (`delivery_status`, `delivery_attempted_at`, `delivery_provider_ref`,
`delivery_failure`, `delivery_attempts`, `link_salt`), four admin-only functions (record delivery, read delivery, store salt,
read link material) and one signed-in preview function, with `public` invoker wrappers. Replayed over
the 32-migration state on PostgreSQL 17 it changes no existing column, function, policy, constraint or trigger. Rollback:
`supabase/manual/rollback_teacher_invitation_delivery.sql` (refuses if any delivery attempt or link salt is recorded; run before the migration-32
rollback). It stores no secret: the salt is not secret on its own.

## Not built / blockers before staging

- **Teacher display-name onboarding**: after acceptance the teacher lands on the neutral `/teacher/courses` scaffold. The
  existing account dialog collects the teacher's own name when their account profile has none; a dedicated teacher onboarding
  screen (display name, language, time zone, Home introduction) is not part of this foundation (`/onboarding/organization` is
  intentionally a 404 scaffold).
- **E-mail delivery needs configuration**: `RESEND_API_KEY`, `INVITATION_EMAIL_FROM` (a verified sender) and a canonical
  `APP_ORIGIN` are required on the server. Until they exist the admin page says exactly which is missing and nothing is
  rotated or sent; **Copy invitation link** still works.
- **Migration 33** (`20261025100000_teacher_invitation_delivery.sql`) is required for delivery status and for the teacher page's
  status check. It is additive and unapplied; until it is applied the preview endpoint answers "unavailable".
- Arabic-only names produce neutral generated slugs (`education-system`, `subject`, ...).
- Migration not applied; requires owner approval and a pre-apply review of staging data.
- Real Firebase/Supabase end-to-end (JWT claims shape, `email_verified`) is unverified.

## Design system (review-corrections round)

Location: `frontend/design-system/` (`tokens.css`, `components.css`, `index.tsx`). Everything is scoped to `.eds-root`,
so student pages are untouched. Change typography, surfaces, borders, shadows, radii or the dark theme in `tokens.css`
only; components and screens consume `--eds-*` tokens and contain no literal colors or font families (a unit test enforces this).
Fonts are the application's own `next/font` variables (Figtree body, Caprasimo display, Cairo/Lalezar for Arabic); the green is
the brand `#7ed957`; the mark is the real `EduLabsMark`. Admin-only layout lives in `frontend/styles/platform-admin.css`.
Future teacher UI should import the same two stylesheets and wrap its root in `eds-root`.

## Review corrections

- Reissue and revoke: a dropped connection is an *unknown* outcome. Both actions lock, the page explains it, and a read-only
  "Refresh invitation status" reports what really happened. If a replacement link was issued but never reached the page, an explicit
  "Create a replacement link" path appears. No automatic or blind retry.
- Course title is suggested as "Subject - Grade" (plain hyphen), stays editable, and is never overwritten once customized.
- Examination board and invitation settings are collapsed by default; they reopen on their own when they hold a value or an error.
- `scripts/teacher-foundation.test.cjs` no longer asserts a migration count; it checks the provisioning migration exists, names are
  unique, and it sorts after every baseline migration.

## Tests

`supabase/tests/platform-admin-provisioning.sql` (133 checks, rollback; migration unchanged),
`scripts/platform-admin.test.cjs` (33 unit/contract/render tests),
`scripts/platform-admin-browser.cjs` (28 Chromium groups, fictional HTTP, real brand fonts, accessibility/contrast scans,
screenshots in `.local/platform-admin-browser/screenshots`; needs a prior `npm run build` for the font files).

## Create flow: four-step wizard

`provision-form.tsx` shows one step at a time (Teacher, Education, Subjects, First course) above a reusable `Stepper`
(`frontend/design-system`, with `StepPanel` for the entrance transition). Next validates only the current step
(`validateStep` in `frontend/lib/provisioning-draft.ts`), focuses the first invalid field and advances only when valid; an
upcoming step opens only when every earlier step is valid (`canVisitStep`), completed steps can always be reopened. The whole
draft lives in one state object, so nothing is lost moving between steps or to/from Review. Review remains a separate screen
and the only place that sends the (unchanged) create request; duplicate-submit and unknown-outcome protections are unchanged.

## Page layout variants and Settings

Screens pick a design-system `Page` variant instead of hard-coding widths: `focused` (centered workflows such as the
create wizard and its review), `regular` (settings and forms), `wide` (management tables) and `fluid` (dashboards).
The container centers itself with `margin-inline: auto`, so the shell neither narrows nor centers content and no
left margins are hard-coded (RTL-safe). Widths are the `--eds-page-*` tokens.

Language and appearance are no longer in the header. `/platform-admin/settings` (Settings link in the sidebar footer)
holds both, using the existing preference infrastructure (`edulabs-lms-language` localStorage + cookie, and
next-themes `edulabs-lms-appearance`). They are remembered per browser on that device and are NOT synchronized across
devices; the page says so. No Supabase table was added.
