# Part 1: accounts, teaching spaces, members, invitations and platform admin

Read-only audit. No code, migration, test or config was changed. Nothing ran against the VPS or any Supabase project. All evidence
comes from a disposable local PostgreSQL 17.10 on loopback (its own data folder and port), started with `-c timezone=UTC`, built from
the 52 migrations in this tree as in Parts 0 to 2b, and deleted afterwards. All people are seed or synthetic users. Branch
`claude/backend-audit`, head before this part `9aef11ee0f461d44295bc167a74a33452bd24b5a`.

Findings are numbered `A1-nn` in [FIX_LIST.md](FIX_LIST.md). A0-11 and A0-14 were re-checked here (end of this report).

## Summary

| ID | Severity | Finding |
| --- | --- | --- |
| A1-01 | **High** | Every signed-in page reads **every space and every course on the platform** through per-row permission checks. With 200 spaces (2,005 courses) each of the two reads takes **7.4–7.6 s**, for every user (a student, the owner of a 2,000-student space, the owner of a small one). Hosted cancels at 8 s. Any signed-in user, even a brand-new one, can also start such 7 s queries directly. A prototype that works out the caller once gives the same rows in about 25 ms. |
| A1-02 | Medium | A space **admin** can rename the space and change its address name directly (the rename function allows only the owner, and nothing is recorded), and can add any person as admin, teacher or assistant without that person agreeing. An owner can make a student an owner and leave. The app never makes these writes. |
| A1-03 | Medium (Note if hosted sign-up is off) | The database still trusts Supabase's own sign-in. A Supabase account gets a working EduLabs profile automatically, without Firebase or its email check, and the database sign-out cannot revoke it. |
| A1-04 | Low | Anyone can save their own display name directly with no limit: a 1,000,000-character name with a right-to-left override character was proven. Teachers see these names. |
| A1-05 | Low | A password change, a disabled account or a revocation in Firebase does not reach the database: the old sign-in keeps working against the database directly for up to an hour. The app's own server refuses it. |
| A1-06 | Note | A space can end with no owner who can sign in: the last-owner rule counts an owner whose account is suspended. |
| A1-07 | Note | An invitation that expires leaves its empty space for ever, and inviting the same email again creates a second space. |
| A1-08 | Note | Dead or legacy account code: the Clerk/Prisma user and admin routes (hard-coded admin emails, email-based account re-linking) are closed in Firebase mode but still buildable; `create_organization` has no grant. |

**Sound:** identity mapping, invitations, last-owner protection, suspension, leaving a space, platform-admin access and what a new user can see. Each was proven with real sessions, including the three races the task asked for (details under "Checked and fine").

## Scope and live versions

**Tables**

| Table | Live file | API grants (`authenticated`; `anon` has none) | RLS |
| --- | --- | --- | --- |
| `public.profiles` | 20261001230352_lms_schema.sql:9 (FK to `auth.users` dropped in 20261010123515) | select; **update(display_name, avatar_path, phone)** | `profiles_select` (`can_view_profile`), `profiles_update` (own row), restrictive `trusted_identity` (20261001230357:63-67; identity rewrite 20261010100545) |
| `public.organizations` | 20261001230352:25 | select; **update(name, slug)** | `organizations_select`, `organizations_update` (owner/admin), `trusted_identity` (:69-73) |
| `public.organization_memberships` | 20261001230352:27 | **select, insert, delete; update(role, status, joined_at)** | select/insert/update/delete policies (:75-83), `trusted_identity` |
| `public.account_profiles` | 20261018104040:12 | select | `own_account_profile` |
| `private.account_avatar_assets` | 20261018104040:2 | none | RLS on |
| `private.external_identities` | 20261010100545:3 (+ `tokens_valid_after`, 20261010123515:6) | none | RLS on |
| `private.platform_admins`, `private.platform_audit`, `private.teacher_invitations` | 20261024120000:11, :110, :75 (+ delivery columns, 20261025100000:11; `portal.rename` action, 20261105130000:12) | none (not even `service_role`) | RLS on |
| Storage bucket `lms-avatars` | 20261018104040:26 | policies `avatar_owner_read`, `avatar_attested_insert`, `avatar_retired_delete` | |

**Functions** (every one has `search_path=''`; definer unless marked; callers checked in the catalog)

| Function | Live file:line | Callable by |
| --- | --- | --- |
| `private.current_app_user_id` | 20261010123515:42 | `authenticated` |
| `private.is_trusted_identity_token` (invoker) | 20261010123515:31 | `authenticated` |
| `public.current_profile_id` (invoker) | 20261010123515:54 | `authenticated` |
| `private/public.onboard_firebase_profile` | 20261010123515:61, copied to private and wrapped by 20261010124048:3-14 | `authenticated` |
| `private/public.revoke_my_firebase_identity` | 20261010123515:85, same | `authenticated` |
| `private.create_profile` (trigger on `auth.users` insert) | 20261010123515:11 | trigger |
| `private.disable_native_identity` (trigger on `auth.users` delete) | 20261010123515:21 | trigger |
| `private.is_active_user`, `has_org_role`, `is_org_member`, `can_view_profile`, `can_view_course` | 20261001230357:3, :7, :11, :55, :39 (bodies rewritten to `current_app_user_id()` by 20261010100545:28) | `authenticated` (helpers) |
| `private.protect_last_owner` (trigger on memberships) | 20261010144028:4 | trigger |
| `private.create_organization` + wrapper | 20261001230606:3 | nobody (revoked, 20261011184623) |
| `private.is_platform_admin` + wrapper | 20261024120000:22, :30 | `authenticated` |
| `platform_provision_teacher` | 20261105130000:17 | `authenticated` (checks platform admin) |
| `platform_reissue_teacher_invitation`, `platform_revoke_teacher_invitation`, `accept_teacher_invitation` | 20261024120000:292, :321, :338 | `authenticated` |
| `platform_portal_overview`, `platform_portal_detail` | 20261105130000:135, :162 | `authenticated` (admin) |
| `platform_record_invitation_delivery`, `platform_invitation_delivery`, `platform_store_invitation_salt`, `platform_invitation_link`, `teacher_invitation_preview` | 20261025100000:28, :57, :67, :84, :98 | `authenticated` |
| `platform_rename_teaching_space`, `rename_my_teaching_space` | 20261105130000:196, :213 | `authenticated` |
| `platform_set_demo_space` | 20261030120000:37 (Part 8) | `authenticated` (admin) |
| `private.account_profile`, `avatar_capability`, `account_avatar_access` | 20261018104040:48, :28, :37 | `authenticated` |
| `teacher_invitation_guard`, `platform_audit_append_only` (triggers) | 20261024120000:100, :123 | trigger |

No live function still contains `auth.uid()` (catalog search).

**Routes**

| Route | Server code | Database |
| --- | --- | --- |
| `POST /api/auth/firebase/session`, `/provision`, `/logout` | `server/http/firebase/route.ts` | `onboard_firebase_profile`; `revoke_my_firebase_identity` on logout (plus Firebase `revokeRefreshTokens`) |
| every signed-in page | `server/services/application-auth.ts:17` (`current_profile_id` + own `profiles` row); `server/services/website.ts:17` `getWebsiteContext`, called by `app/(dashboard)/layout.tsx:16` | `organizations`, `courses`, `course_offerings`, `organization_memberships`, `course_staff`, `offering_staff` selects (`server/repositories/website.ts:25-29`) |
| `POST /api/auth/firebase/password-reset` | `server/services/password-reset.ts` | none (Firebase Admin only) |
| `POST /api/auth/firebase/account`, `/avatar` | `server/http/account.ts`, `server/services/account.ts` | `account_profile`, storage `lms-avatars` |
| `PATCH /api/teacher/space` | `server/http/teacher-space.ts` | `rename_my_teaching_space` |
| `/api/teacher-invitations/accept`, `/preview` | `server/http/platform-admin-portals.ts`, `server/services/platform-provisioning.ts` | `accept_teacher_invitation`, `teacher_invitation_preview` |
| `/api/platform-admin/portals[/<id>[/demo]]` | same + `server/services/platform-admin.ts` | `is_platform_admin`, the `platform_*` functions |
| `/api/admin/*`, `/api/user/*` (legacy Clerk/Prisma) | `server/http/admin/*`, `server/http/user/*` | Prisma (not Supabase); answer 503 in Firebase mode (`middleware.ts`, last rule) |

## A1-01: High, performance

**Every signed-in page reads every space and every course on the platform, row by row.**

`getWebsiteContext` (`server/services/website.ts:17`) runs on every page through the dashboard layout. Among other reads it asks for
`organizations` (`order by id limit 101`) and `courses` (`order by id limit 101`) **without any filter**
(`server/repositories/website.ts:25`, `:29`). The database therefore checks every row in both tables:

- `courses_select` calls `can_view_course(id)` for each course on the platform (20261001230357:85, :39).
- `organizations_select` calls `is_org_member(id)` for each space, then `can_view_course` for **every course of every space** in its
  `exists` (:69).

Each check is expensive because nothing caches who the caller is. `current_app_user_id()` parses the token and joins
`external_identities` and `profiles` on every call (0.29 ms). `can_view_course` calls it through `can_edit_course`,
`is_course_staff`, `can_support_offering`, `is_enrolled`, `has_org_role` and `is_active_user`.

**Measured** (warm, each call one PostgREST-shaped transaction). The fixture is 200 spaces provisioned with the real
`platform_provision_teacher` and accepted by their teachers, 10 published courses with one run each, and one space with 2,000 students
(4,000 enrollments) and 20 staff. In all: 203 spaces, 2,005 courses, 2,228 profiles.

| Read | Student of the big space | Owner of the big space | Owner of a small space |
| --- | --- | --- | --- |
| `current_profile_id` | 0.6 ms | 0.4 ms | 0.5 ms |
| organizations, `limit 101` (returns 1) | **7,645 ms** | **7,566 ms** | **7,561 ms** |
| courses, `limit 101` (returns 2 / 10 / 10) | **7,423 ms** | **7,354 ms** | **7,358 ms** |

| One helper call | Time |
| --- | --- |
| `current_app_user_id` | 0.29 ms |
| `is_active_user` | 0.32 ms |
| `has_org_role` / `is_org_member` | 0.69 / 0.71 ms |
| `can_edit_course` | 1.29 ms |
| `can_view_course` | **3.95 ms** |

`EXPLAIN (ANALYZE, BUFFERS)` of the courses read: index scan on `courses_pkey`, filter `can_view_course(id)`, **2,003 rows removed**,
571,045 buffer hits, 8,358 ms. The organizations read: 202 rows removed. Its `SubPlan` runs a seq scan of `courses` with
`can_view_course(id)` twice per row: 570,083 buffer hits, 7,781 ms.

What this means:

- The cost grows with the **size of the platform**, not with the user's own spaces: about 3.7 ms × every course on the platform, for
  each of the two reads, on every page.
  - At 200 courses (about 20 spaces) that is roughly 0.75 s per read.
  - At 200 spaces the reads reach the hosted 8 s `statement_timeout`, and every signed-in page fails.
  - Both reads run in parallel on the same request and hold two of the 60 hosted connections.
- **Anyone signed in can trigger it on purpose.** A student's direct Data API call `select count(*)` cost 6,680 ms on `profiles`
  (`can_view_profile` per row), 7,722 ms on `courses` and 7,592 ms on `organizations`. A brand-new account with no space can do the
  same. A few such calls at once fill the connection pool.
- An owner reading their 2,000 students' names straight from `profiles` takes 4.2 s (the app reads names through definer
  functions instead, so no screen does this today).

**Prototype** (throwaway database only): `private.proto_my_scope()` resolves the caller once and returns the ids of the caller's
spaces and courses (memberships, course staff, run staff, active enrollments, with the same status rules as the helpers). The pages
then read those rows by id.

| | Student | Owner of the big space |
| --- | --- | --- |
| Scope function | 1.9 ms | 1.7 ms |
| Then spaces by id | 16.8 ms | 1.2 ms |
| Then courses by id | 8.4 ms | 8.0 ms |
| Same rows as today | yes | yes |

**Fix (not done):**

1. The every-page context gets the caller's spaces and courses from one definer function that resolves the caller once (as the
   prototype does), then reads them by id.
2. For the direct-call abuse case, use the A0-01 pattern on `courses`, `organizations` and `profiles`: a set-returning "rows I may
   see" helper that is evaluated once per statement, instead of a helper per row.
3. Recommended: cache the resolved caller once per statement (for example `set_config` within the transaction) so that every
   helper stops re-reading the token.

A0-01 (lesson read) has the same root cause and should be fixed with the same helper.

## A1-02: Medium, security

**A space admin can rename the space and change who belongs to it directly, without the owner and without a record.**

`authenticated` has `INSERT`, `DELETE` and `UPDATE(role, status, joined_at)` on `organization_memberships` and `UPDATE(name, slug)` on
`organizations` (20261001230357:73, :83). The policies let an owner do anything and an admin do anything except touch an owner row
(:71, :77-81). No server code makes these writes. A search of `server/` finds none; the only writer is `accept_teacher_invitation`.

Proven as seed user 2, admin of space B (each probe rolled back):

| Direct call | Result |
| --- | --- |
| Rename space B (`update organizations set name=…`) | **1 row**; no `portal.rename` audit row |
| Change its slug | **1 row** |
| The same rename through `rename_my_teaching_space` | `42501 Only the owner of a teaching space can rename it` |
| Add a student of B (user 7) as **admin** | **1 row** |
| Add the owner of space A (user 1) as assistant of B | **1 row** (no consent; any profile id works) |
| Suspend or delete the owner's membership | 0 rows (protected) |
| Insert an owner, or make self owner | `42501` (protected) |
| A teacher (not admin) adds a member | `42501` |
| Owner of A makes student 5 an **owner**, then leaves | both succeed: the space now belongs to a student who never agreed |

The product rule recorded in `20261105130000` is "only the owner renames"; the database lets admins do it unrecorded. Adding a
person also silently gives them access to the space's courses, rosters and files.

**Fix:** as for A0-02, revoke the direct writes (memberships insert/update/delete, organizations update) and drop the policies that
only served them. Rename already has its function. Staff management, when it gets a screen, goes through an audited definer function
that also asks the added person to accept (like the teacher invitation). **Needs owner decision** when that screen is planned: may a
space admin add or remove staff, or only the owner?

## A1-03: Medium (Note if Supabase sign-up is off everywhere), security

**The database still trusts Supabase's own sign-in, outside Firebase.**

`is_trusted_identity_token` accepts the project's Supabase issuer (`aud=authenticated`) beside Firebase (20261010123515:31).
A new row in `auth.users`, which is what a Supabase sign-up creates, fires `create_profile` (:11). That creates a profile and an
**active** identity mapping.

**Proof:** an `auth.users` insert produced an active `supabase` identity, and a Supabase-shaped token then resolved to the new profile
through `current_app_user_id`. Such an account:

- needs no Firebase account and no Firebase email verification;
- is outside the database sign-out: `revoke_my_firebase_identity` answers `42501 Verified Firebase identity required`, and
  `tokens_valid_after` applies to Firebase identities only (:47);
- cannot accept a teacher invitation (proof: `42501 A verified email is required`);
- can do anything a new student can, such as joining a course through a student link (Part 3).

`supabase/config.toml` (local stack) has `[auth] enable_signup = true` and email `enable_confirmations = false`. Whether the
**hosted** projects allow Supabase sign-up could not be checked from here. The seed and test users use this issuer, so the tests rely
on it.

**Fix:** recommended: trust the Supabase issuer only where tests run (the per-environment issuer setting of A0-11), turn Supabase
sign-up off on every hosted project, and stop `create_profile` from creating identities there. Until then, the owner's chat checks the
hosted sign-up setting. If it is off on every environment, this finding is a Note.

## A1-04: Low, integrity

**Anyone can set their own display name, photo path and phone directly, with no limits.**

`UPDATE(display_name, avatar_path, phone)` on `profiles` with the own-row policy (20261001230357:65-67). The account screen's function
`account_profile` limits names to 60 + 60 characters without control characters (20261018104040:62), but the direct write skips it.
The columns have no checks.

**Proof:** student 5 stored a **1,000,000-character** display name ending in U+202E (right-to-left override), a URL as
`avatar_path` and a 100,000-character `phone`. Teachers see `display_name` in their student lists, reports, notifications and exam
marking, all through definer functions that return it unchanged. The app never writes these columns directly, and nothing reads
`avatar_path` or `phone`.

**Fix:** revoke the direct `UPDATE` on `profiles` (names change only through `account_profile`), and add length and
control-character checks on `display_name`.

## A1-05: Low, security

**Revoking a sign-in in Firebase does not reach the database.**

The server checks revocation on every request (`verifyIdToken(token, true)`, `server/services/firebase-auth.ts:13`). The database
cannot: it refuses only tokens signed in before `tokens_valid_after`, which only the app's own Sign out sets (proof: after Sign out
the old token resolves to nobody; a new sign-in works).

A password change or reset, a disabled account, or a revocation in the Firebase console leaves the database unaware. The person's
current ID token (at most one hour) keeps working against the Data API directly. Someone who copied a token keeps access to the
database for that hour after the victim changes their password. Through the app it fails at once.

**Fix:** recommended: accept the one-hour window (Firebase ID tokens cannot be revoked faster without a check on every call), or
have the operator tools that disable an account also set `tokens_valid_after` through a service function. Owner's chat decides.

## A1-06: Note, correctness

**A space can end with no owner who can sign in.** `protect_last_owner` (20261010144028:4) counts active owner memberships, not
whether the person's profile is active.

**Proof:** space A with two owners, the second owner's profile suspended. The first owner left (1 row), and the space then had 0
usable owners. Suspension itself has no tool: it is set only by SQL.

**Fix:** count only owners whose profile is active. Recommended: also show the platform admin a "space has no usable owner" state.

## A1-07: Note, data growth

**An expired invitation leaves its empty space for ever.** `platform_provision_teacher` creates the space, programs, subjects and
first course before anyone accepts. When the invitation expires, nothing removes them. Provisioning the same email again is allowed
(proof) and creates a second space, while the first stays in the admin list as "expired". The admin page offers "Reissue" for the
right path, but nothing stops the double. **Recommended:** refuse a new provisioning while the same email has an expired, never
accepted space and point to Reissue, or let the admin archive the old one.

## A1-08: Note, dead and legacy code (Part 9)

| Item | State |
| --- | --- |
| `server/http/admin/{users,students,submissions,groups,waitlist}`, `server/http/user/{status,sync}`, `server/services/user.ts`, `server/services/teacher.ts` | Clerk + Prisma. `syncCurrentUser` promotes hard-coded admin emails (`server/services/user.ts:7`) and **re-links an account by email** when a Clerk user is re-created. `isAdminOrTeacher` trusts `NEXT_PUBLIC_TEACHER_ID`. Closed in Firebase mode (`middleware.ts` returns 503 for every non-listed `/api/`), but still built and live if the Clerk fallback is selected |
| `create_organization` | no grant since 20261011184623; dead |
| `server/repositories/lms.ts` `organizations`/`memberships` | only the `/lms-staging` page |
| `create_profile`, `disable_native_identity` | part of A1-03 |

## Checked and fine

**Identity mapping** (`current_app_user_id`, `onboard_firebase_profile`):

- A person is the pair (token issuer, subject). It is never linked by email: a second Firebase account with the same email (different
  case) got a **separate, empty profile** (proof). A deleted and re-created Firebase user gets a new subject, so a new empty profile:
  it cannot take over the old one.
- Signing in twice gives the same profile (advisory lock on issuer and subject, then `FOR UPDATE`). A token without `auth_time`, with
  an unverified email, from an identity marked `disabled`, or for a suspended profile resolves to nobody (proofs). Onboarding with
  an unverified email: `42501`.
- Sign out: the old token resolves to nobody; signing in again works (proof). The server also verifies every request with
  Firebase's revocation check and keeps the token only in an `HttpOnly`, `SameSite=Strict` cookie of at most 1 hour.
- `email_verified` is required by the server (`server/http/firebase/route.ts`) and by the database for Firebase tokens.

**Suspension stops every path.**

- Profile suspended: `current_app_user_id` returns nothing, so every policy (restrictive `trusted_identity` on every public table)
  and every function refuses. Proof: `rename_my_teaching_space` answers `42501 Sign in required`, and the server's viewer lookup
  returns signed-out.
- Membership suspended or deleted: the course editor lost view and edit of the course at once (proofs), although their
  `course_staff` row stays (every staff helper also requires an active membership in an active space).
- Space suspended: `has_org_role` and `is_enrolled` both require an active space.

**Roles.** A teacher or assistant cannot change memberships (`42501`). An admin cannot touch an owner row or create an owner (proofs;
the other admin powers are A1-02). Nobody can raise themselves to owner.

**Last owner.**

- The only owner cannot leave or demote themselves (`23514`, proofs).
- **Two owners leaving at the same moment** (two sessions): the second waited on the first (`Lock/transactionid`, the space row the
  trigger locks), then got `23514`. One owner remains.

**Invitations.**

- The secret is `base64url(HMAC-SHA256(server key, random salt))`, 43 characters, and only its SHA-256 is stored.
- Acceptance needs both the secret and a verified Firebase email equal to the invited one, compared lower-cased. Mixed case was
  accepted; other Unicode forms are refused, which is the safe direction.
- Proofs:
  - wrong email: `42501 issued to a different email address`;
  - unverified email: refused;
  - a Supabase account: refused;
  - a guessed secret: `PT404`;
  - after Revoke or expiry: `PT410`;
  - used again: `PT409`;
  - Reissue after acceptance: `PT409`.
- **The same teacher accepting twice at the same moment:** the second waited, then got `PT409 Invitation already used`.
- **Double provisioning** (two admin submits for one email at once): the second waited on the per-email advisory lock, then got
  `23505`. One space was created.
- The preview tells someone holding a link only its state and a masked address (`r***@…`), and never consumes it.

**Platform admin.**

- Only rows in `private.platform_admins` count. No API role (not even `service_role`) can read or write that table; rows are added
  by the operator SQL procedure only. A suspended admin profile loses the role.
- Every `platform_*` function checks it first. A new user gets `false` / `42501` (proofs).
- Platform admin gives no power inside a space: no space helper looks at it.

**A brand-new signed-up user with no space** sees exactly one row in all public tables: their own profile (sweep of every public
table). `create_organization`: no permission. Admin functions: `42501`. They can still trigger the slow reads of A1-01.

**Deleting.** Nothing the API can call deletes a person or a space. Profiles are referenced `ON DELETE RESTRICT` from identities,
enrollments, work and audit, so a profile cannot be deleted while it has history. Memberships, course staff, run staff, account
profile and live-class joins cascade. Spaces are `RESTRICT` from courses, media, notifications, programs, websites, invitations and
audit, and only memberships cascade.

**Locks.**

- The space row is taken `FOR UPDATE` by `accept_teacher_invitation` (0.8 ms p50 over 200 acceptances), by Reissue, Revoke and
  Rename (rare admin actions), and by `protect_last_owner` (only when an owner changes).
- Provisioning takes a per-email advisory lock (2 ms p50 for 200 spaces with 6 grades and 3 subjects).
- No lock is taken by sign-in other than the per-identity advisory lock, and none of these locks waits behind a student action.
- These functions belong in the A0-06 `lock_timeout` list with the others.

**Other cost** (warm):

| Call | Time |
| --- | --- |
| Sign-in: `onboard_firebase_profile` (existing) | 0.9 ms |
| `current_profile_id` | 0.6 ms |
| Own profile row | 1.2 ms |
| Own memberships | 0.9 ms |
| `account_profile('get')` | 1.6 ms |
| Platform admin: `platform_portal_overview` 50 of 204 spaces | 3.9 ms (`EXPLAIN`: 615 buffers) |
| `platform_portal_overview` 100 | 5.6 ms |
| `platform_portal_detail` | 1.8 ms |
| Owner: staff list of the big space (21 rows) | 8.6 ms |

**Time zones.** Expiry and revocation use `clock_timestamp()` and epoch seconds, all `timestamptz`. Nothing depends on the session
time zone.

**Password reset** has no database side. It runs on Firebase Admin, sends the same reply for every address, and is rate-limited in
memory per server process (`server/services/password-reset-limiter.ts`).

## Re-checked: A0-11 and A0-14

- **A0-11** (hard-coded issuers, one Firebase project for every environment): unchanged. Both issuers are literals in
  `is_trusted_identity_token` and `create_profile` (20261010123515:11, :31). A1-03 adds that the Supabase issuer is the second door.
  The status stays "deferred to production prep", and the A1-03 fix should be made with it.
- **A0-14** (`is_enrolled` uses `now()`): unchanged (20261001230357:35). It is now evaluated inside every course check of A1-01. Within
  one statement `now()` and `clock_timestamp()` differ by milliseconds, so there is still no wrong answer. The A1-01 fix rewrites
  this path and should use `clock_timestamp()` there.

## Could not verify

- Whether Supabase sign-up (email, and any other provider) is enabled on the hosted projects (A1-03).
- How many spaces and courses dev and production hold today, so how close A1-01 is now. The formula: about 3.7 ms × all courses
  on the platform, per read, per page. Hosted hardware may be slower than the 20-core audit machine.
- Whether the Supabase API gateway limits direct Data API calls per user (A1-01 abuse case).
- Firebase project settings (one account per email, email enumeration protection, password policy).

## Evidence scripts (scratchpad, not committed)

- `build.cjs`: replay into a disposable database.
- `p1fix.cjs`: 200 provisioned spaces, 2,000 students.
- `p1ctx.cjs`, `p1ex.cjs`, `p1h.cjs`, `p1pr.cjs`: A1-01 timings, `EXPLAIN` and helper costs.
- `p1proto.sql`, `p1pt.cjs`: the A1-01 prototype.
- `p1sec.cjs`: access and identity probes, each rolled back.
- `p1race.cjs`, `p1race2.cjs`: two-session races and invitation rules.
- `p1perf.cjs`: sign-in, admin and member reads.

All ran only against the disposable local database, which was then deleted.
