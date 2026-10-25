# Platform Admin: Teacher Provisioning V1

Status: Admin V1 is based on branch `claude/admin-provisioning-v1` (release candidate commit
`0f9b889b392d5af8bf6406151a4d515dd67da5ed`). The teacher acceptance UI follow-on is developed on
`codex/teacher-invitation-acceptance`. This follow-on changes no database schema and does not
apply SQL or mutate Firebase, Supabase, Brevo or Cloudflare. Operator-attested migration history
must be verified independently; the staging manager cannot prove remote SQL execution.

## What an administrator can do

1. Create a teacher portal for an intended teacher email (no display name, no website name).
2. Configure the first educational path: Education System, optional Examination Board, Grade
   Level, Subject, First Course. Missing pieces are added inline without losing the form.
3. Review, then create the portal, academic records, empty course and invitation in ONE
   database transaction. Any failure leaves nothing behind.
4. Inspect portals and invitation status; reissue (supersedes the pending code) or revoke.

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
`GET|POST /api/platform-admin/portals/[portalId]` (`reissue`/`revoke`),
`POST /api/teacher-invitations/accept`. All require Firebase staging mode
(`isFirebaseStaging()`); outside it they are 404. **Production prerequisite:** this gate is
a staging-only deployment switch, not an authorization boundary; production activation needs
separate approval.

## Bootstrap

No UI/API grants administration. A trusted operator runs
`supabase/manual/bootstrap_platform_admin.sql` (and `revoke_platform_admin.sql`) with the real
Firebase UID copied from the console. Nothing in the repo contains a real UID.

## Remaining blockers and follow-up work

- The follow-on branch `codex/teacher-invitation-acceptance` adds a staging-only page at
  `/accept-teacher-invitation` for invitation-code entry, verified-email sign-in continuation,
  English/Arabic copy, safe unknown-outcome handling and a success state. It calls the existing
  acceptance API and adds no migration. It remains a release candidate until isolated validation
  and a real Firebase/Supabase staging acceptance test pass.
- Display name, language, time zone and Home introduction are out of scope for this acceptance flow.
- **Email delivery**: not connected. The UI states "No email was sent"; the code must be
  shared manually. Brevo/email branch not merged.
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
  "Refresh invitation status" reports what really happened. If a replacement code was issued but its secret was lost, an explicit
  "Issue a replacement code" path appears. No automatic or blind retry.
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
