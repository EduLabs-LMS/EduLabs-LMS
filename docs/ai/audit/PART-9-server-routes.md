# Part 9: server routes and services that call the database

Read-only. Branch `claude/backend-audit`. No app code, migration, test, config or script was changed. Nothing ran against the VPS, a hosted
Supabase project, Firebase, Brevo, Jitsi or Cloudflare. The one web search (Firebase documentation) is quoted as facts with links.

## Summary

- **Result: no High.** Every route that writes or returns private data was called five ways (anonymous, signed in with no profile, a student of
  another space, a teacher of another space, the right user): 270 calls (54 routes and actions, 5 callers each) against the real production build. Anonymous and no-profile got
  401 every time. Every cross-space caller got 403/404, or a 200 with **0 rows** (checked: `ROWS=0` on the lists). Only the right user changed
  data. A snapshot of 29 tables before and after each call showed no change from any wrong caller.
- **The Next server never holds a service-role key.** Only two scripts do (the push worker and the operator storage script). No secret is
  in a `NEXT_PUBLIC_*` name; the build whitelists public names and requires an `sb_publishable_` key.
- **Token boundary holds.** Expired, other project, wrong audience, wrong signature, `alg none`, disabled, revoked, unverified email, no role,
  `service_role` role: all refused (401/403) at the server. The database refuses the same tokens when called directly. Logout is enforced in the
  database too (old token returns null).
- **13 findings: 0 High, 1 Medium, 7 Low, 5 Note.** The Medium is not in our code: Firebase's own public sign-up and password-mail endpoints
  can be called with the public web key outside our limiter, and nobody has confirmed the Firebase console settings that limit them (A9-01).
- **Live class:** a student can never get a moderator token and no whiteboard can be opened by anyone through Jitsi (checked in code and config;
  not run against a real Jitsi).
- **Cleanup list:** about 70 route and service files are dead or only reachable behind a 503 (list below).

## Inventory

### Route table

Key: **DB key** is the key the server uses to talk to the database: **user** = the caller's own Firebase ID token passed as the Supabase access token
(the database decides), **anon** = publishable key only, **none** = no database call. The Next server never uses a secret key. "Origin" = `validFirebaseOrigin`
(exact `APP_ORIGIN`, `Sec-Fetch-Site` not `cross-site`) on writes; reads use `sameOriginRead`. Body limit: Caddy allows 64 MB for everything; limits below are
ours. Rate limit: only the ones named exist; everything else relies on the database and the 8 s hosted limits.

| Path (method) | Who may call | How checked | DB key | Body limit | Rate limit | Proven |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/health` (GET) | anyone | none (middleware passes it) | none | n/a | none | 200 |
| `/api/auth/firebase/session` (POST) | anyone with a good token | `verifyIdToken(token, true)`, aud/iss, `email_verified`, role claim; Origin | none (Firebase Admin) | token ≤ 16,000 chars; body ≤ 20 KB (413) | none (A9-03) | phase 1 |
| `/api/auth/firebase/provision` (POST) | cookie or token in body | token verify + Admin `getUser`, may set the `role` claim | none | small | none (A9-03) | phase 1 |
| `/api/auth/firebase/logout` (POST) | signed in | Origin; revokes in DB (`tokens_valid_after`) | user | small | none | phase 1 |
| `/api/auth/firebase/account` (POST) | signed in (profile needed) | session + Origin + DB | user | small | none | 401 no profile, anon |
| `/api/auth/firebase/avatar` (POST) | signed in | session + Origin; file checked with sharp; upload token minted | user | image cap (3 MB provider photo; direct upload checked at `finish`) | none | code |
| `/api/auth/firebase/password-reset` (POST) | anyone | Origin, body cap, per-IP and per-email limiter | none (Brevo + Admin) | small | in-memory (A9-10) | Part 7 |
| `/api/exams*`, `/api/homework/*`, `/api/learning/*`, `/api/learning-overview`, `/api/study-groups*`, `/api/student-administration`, `/api/communications`, `/api/teacher/**` | signed in | session + Origin (writes) then the DB function decides | user | `lessons/upload` buffers ≤ 50 MB (A9-06); JSON bodies capped per route | none (DB 8 s limit) | matrix |
| `/api/live-class/open`, `/joined` | signed in | session; DB `live_class_open`/`live_class_joined` decide moderator | user | small | in-memory 30 opens + 60 joined per minute per user (A9-10) | matrix |
| `/api/platform-admin/portals*` (+`/demo`) | platform admins | session, then DB `platform_admin` check; Origin for writes | user | small | none | matrix |
| `/api/teacher-invitations/preview`, `/accept` | signed in | session; DB checks the token against the signed-in e-mail | user | small | none | 401 anon |
| `/api/personalization` (GET) | signed in | session | none | n/a | none | constants in Firebase mode |
| `/t/*` public website pages | anyone on the app's own host | host equals `APP_ORIGIN` (X-Forwarded-Host ignored); rate limit URL set or 503 | anon (8 s client timeout) | n/a | per website (A2b-05, deferred) | code; off in V1 (A2b-10) |
| Legacy: `/api/courses/**`, `/api/admin/**`, `/api/user/*`, `/api/progress/complete`, `/api/support`, `/api/upload/check-limit`, `/api/uploadthing` | nobody in Firebase mode | middleware answers 503 before any code runs | none | n/a | n/a | 503 for all five callers, 45 calls |
| Legacy still allow-listed: `/api/secure-exams/*`, `/api/teacher/website`, `/api/student-academics`, `/api/homework` old actions | signed in | DB authorizes (503 / 400 / 403 in the matrix) | user | small | none | A6b-06, A2b-10, A5-11 |

`middleware.ts`: `/t/*` is 404 unless the site is Firebase staging and the path is public; `/api/health` and `/api/auth/firebase/*` pass straight through; in Firebase mode
an explicit list of exact API path patterns passes and every other `/api` or `/trpc` path gets **503 "legacy workflow is unavailable"** (pages redirect to `/unavailable`).
The matcher includes `/(api|trpc)(.*)`, so a `.json` suffix is not a bypass. The deployed build pins `NEXT_PUBLIC_AUTH_BACKEND=firebase-staging` in `Dockerfile:23,29` and `compose.yaml:20`;
`.env.example:6-8` still says `legacy` / `clerk` (A9-02).

### Service-role table

| File | Creates a service-role client? | What it writes | Notes |
| --- | --- | --- | --- |
| `server/**` (every route and service) | **No.** `grep` finds no `service_role` client and no secret key in the Next server | n/a | `server/integrations/supabase.ts` builds only the user-token and anon clients |
| `scripts/notification-dispatch.cjs` (via `infra/worker.cjs`) | Yes. Key read from the file named by `SUPABASE_SERVICE_ROLE_KEY_FILE`; project id and URL pinned | calls only the RPC `notification_worker` | compose profile "notifications"; no timeouts (A0-06); not running on staging (A7-05) |
| `scripts/lms-storage-maintenance.cjs` | Yes (`LMS_MAINTENANCE_SECRET_KEY`), direct Prisma connection | deletes expired uploads | operator-only, dev only, refuses production (A7-16) |
| `NEXT_PUBLIC_*` | no secret exists: `infra/build-config.cjs` whitelists public names and requires an `sb_publishable_` key | n/a | `.env.example` lists the service-role and VAPID private key under the general app env (A9-07) |

### The server's direct table writes (does any skip a `private.*` command?)

| Write | File:line | Live? | Skips a command? | Already in |
| --- | --- | --- | --- | --- |
| `courses` UPDATE | `server/repositories/teacher-course.ts:23` | live | yes: course PATCH (archive, rename) goes straight to the table, so it is the A0-02 path | A0-02 |
| `course_offerings` INSERT | `server/services/group-course-run.ts:23` | live | yes: skips `student_administration`, no audit | A3-01, A3-06 |
| `media_assets` INSERT | `server/services/exam-runner.ts:94` | legacy secure exams | yes | A6b-01 |
| `media_assets` INSERT, `lesson_progress` UPSERT | `server/repositories/lms.ts:50,59` | dead (only `scripts/lms.test.cjs`) | yes | A2a-12 |
| Prisma writes (personalization, `progress/complete`, `user/status`, `services/user`) | `server/services/*`, `server/http/{progress,user}/*` | Clerk mode only; 503 in Firebase mode | n/a | cleanup |

No new live direct write was found. A9-11 asks for a guard test so a new one cannot appear unnoticed.

## Findings

### A9-01 (Medium, security): Firebase's own endpoints can be called with the public web key, outside our limiter

- **Where:** `shared/` Firebase client (`createUserWithEmailAndPassword`, `sendEmailVerification`, `signInWithEmailAndPassword`, `verifyBeforeUpdateEmail`, `confirmPasswordReset`);
  public key in the page; `.env.example:11` carries a real one (value not repeated here: `<redacted>`). No App Check is initialised anywhere in the code (`git grep -i appcheck` finds nothing).
- **Proof:** code read. The website itself calls these Firebase endpoints directly, so they must be reachable from a browser with the public key; anyone can do the same from a script.
  Our password-reset route (`server/http/password-reset.ts`, limiter) is a second, limited door; Firebase's `accounts:sendOobCode` is a third door we do not control.
- **Impact in plain words:** a script can (a) create unlimited unverified accounts, (b) make Firebase send reset or verification mails to any address, and (c) use up Firebase's daily
  reset-mail quota so real teachers cannot get their reset mail. Whether this is already blocked depends on settings in the Firebase console that nobody has read back (could not verify).
- **Facts from Firebase's documentation (what Firebase lets us turn off or limit):**
  - Email enumeration protection exists and is on by default for projects created on or after 15 Sep 2023; with it on, a reset request for an unknown address does not error.
    [Identity Platform doc](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection), [password-auth guide](https://firebase.google.com/docs/auth/web/password-auth).
  - Daily limits: password reset **150 emails/day on Spark, 10,000/day on Blaze**. [Firebase limits](https://firebase.google.com/docs/auth/limits), [Identity Platform quotas](https://docs.cloud.google.com/identity-platform/quotas).
  - New email/password sign-ups from one IP are rate-limited by Firebase. [Firebase limits](https://firebase.google.com/docs/auth/limits). The security checklist advises tightening the `identitytoolkit.googleapis.com` quota. [Security checklist](https://firebase.google.com/support/guides/security-checklist).
  - `sendOobCode` can require a reCAPTCHA response when Google detects abuse. [REST reference](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode).
  - App Check enforcement can be switched on for Authentication in the console (up to 15 min to apply); unverified requests are then rejected. [Enable enforcement](https://firebase.google.com/docs/app-check/enable-enforcement).
  - API keys identify the project and do not authorize; Google still recommends HTTP-referrer restrictions and an API allow-list per key. [API keys](https://firebase.google.com/docs/projects/api-keys.md.txt).
  - Blocking functions can reject a registration; they do not run for anonymous or custom-token sign-in. [Blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions).
  - The search did **not** confirm where a "disable new sign-up" switch lives for password accounts. Do not rely on it until read in the console.
- **Fix (technical, recommended):** an operator checks and records in `docs/ai/` these console settings, then re-reads them: email enumeration protection on; Blaze plan (10,000/day, not 150);
  the key restricted to the site's referrers and to the Identity Toolkit and Secure Token APIs; App Check (reCAPTCHA Enterprise or v3) initialised in the client and enforced for Authentication;
  an Identity Toolkit quota lowered; and, if new sign-ups are not meant to be public, a blocking function or the console switch (A1-03 already tracks the Supabase side). No product decision needed.

### A9-02 (Low, deploy): the sample environment file defaults to the old Clerk and Prisma system

- **Where:** `.env.example:6-8` (`LMS_DATA_BACKEND=legacy`, `NEXT_PUBLIC_AUTH_BACKEND=clerk`); `middleware.ts` (Clerk branch when not Firebase mode).
- **Proof:** the matrix ran in Firebase mode: the legacy routes all returned 503 before any handler ran (45 calls). Legacy mode was **not** run (it needs Clerk and a Prisma database).
  The Docker build pins Firebase mode (`Dockerfile:23,29`, `compose.yaml:20`), so the deployed build is not affected.
- **Impact:** anyone who builds outside Docker from a copy of `.env.example` ships the old routes, whose Clerk branch has hard-coded admin e-mails and e-mail re-linking (A1-08) and a `/api/support` and `/api/uploadthing` that no longer match the database.
- **Fix:** delete the legacy code (cleanup list) so there is nothing to switch on; until then, make `infra/build-config.cjs` refuse a build whose `NEXT_PUBLIC_AUTH_BACKEND` is not `firebase-staging`, and change the sample file.

### A9-03 (Low, speed/abuse): `session` and `provision` have no rate limit, and `provision` accepts a token whose e-mail is not verified

- **Where:** `server/http/firebase/route.ts:58` (`provision`), `server/services/firebase-auth.ts:13` (`session`).
- **Proof:** `provision` with a validly signed token and `email_verified=false` returned **200**; with a revoked token and no cookie it returned 401. Neither route has a limiter.
  `session` refuses unverified e-mail (403), `provision` does not check it.
- **Impact:** a caller with any valid Firebase account can make the server call Firebase Admin (`getUser`, and `setCustomUserClaims` when the claim is missing) as often as they like and spend our Admin quota. No data is exposed: the database still refuses an unverified token.
- **Fix:** refuse unverified e-mail in `provision` (same check as `session`), and add the existing in-memory limiter keyed by uid and IP to both.

### A9-04 (Low, leak): some routes return the raw validation message to the browser

- **Where:** `server/http/lessons.ts:34` returns `(e as Error).message` for every non-503 error.
- **Proof:** `POST /api/learning/<course>/edit` by the right teacher with a wrong action returned 400 with a raw Zod dump (`[ { "received": "edit_lesson_details", ... } ]`: field names, accepted values).
  503 messages are generic. No token, e-mail or reset link appeared in any response or in the server log (0 token-like strings in two runs).
- **Impact:** low: it shows internal field names to a signed-in user. It is not a database message.
- **Fix:** answer 400 with a fixed "Check the entered details" for Zod and JSON errors (the other routes already do), and log the detail.

### A9-05 (Low, headers): app pages carry no CSP, HSTS, frame-ancestors or Permissions-Policy

- **Where:** `next.config.js:11-12` sets only cache headers for `/email-assets`; `infra/Caddyfile:12-15` sets `-Server`, `X-Content-Type-Options nosniff`, `Referrer-Policy no-referrer`.
  Public website pages (`app/t/_render.tsx`) do set a strict CSP, `frame-ancestors 'none'` and `X-Frame-Options: DENY`; some authenticated pages set `no-store` in middleware.
- **Proof:** response headers of the production build on loopback; Cloudflare in front was not checked (could not verify; it may add HSTS).
- **Impact:** no script-injection hole was found, so this is hardening. The auth cookie is `SameSite=strict`, so a page framed on another site appears signed out; real clickjacking risk is small.
- **Fix:** add `Strict-Transport-Security`, `X-Frame-Options: DENY` (or `frame-ancestors 'self'`), `Permissions-Policy` and a report-only CSP in Caddy or `next.config.js`; the live-class page needs `frame-src` for the Jitsi host.

### A9-06 (Low, speed): a lesson file upload is held entirely in server memory

- **Where:** `/api/learning/<course>/upload` (`server/http/lessons.ts`), up to 50 MB per request, then sharp validation (max 8192 px, 20 Mpx).
- **Proof:** code read; a 1-byte fake png was refused with 400 "File content does not match its type" (type and magic-byte check works). Concurrent large uploads were not run.
- **Impact:** a few teachers uploading 50 MB files at once, or one script with a teacher account, can push the 4 GB Node heap limit set in `Dockerfile:23`.
- **Fix:** cap concurrent uploads per process (a counter of 3), or stream to the signed URL the database already issues.

### A9-07 (Low, secrets hygiene): the sample file holds a real project's config and lists two secrets under the general app

- **Where:** `.env.example:11` (a real Firebase web key; `<redacted>` here), project id and app id nearby; `.env.example:32` (`PUSH_VAPID_PRIVATE_KEY=`) and `:37` (`SUPABASE_SERVICE_ROLE_KEY=`) sit in the app section though only the worker needs them (`infra/worker.env.example` has them correctly).
- **Proof:** `git grep` for keys and tokens found no other secret in the repository. The Firebase web key is public by design.
- **Impact:** a person filling the sample file for the web app would put a service-role key into the web container. Today `compose.yaml` does not pass it to the app.
- **Fix:** use placeholders for the Firebase values; move the two secret names to the worker example.

### A9-08 (Note, token boundary): three small gaps in the server's own token checks

- **Where:** `server/services/firebase-auth.ts:13,16`.
- **Proof:** a token with `iat` 120 s and 10 s in the future was accepted (no clock-skew limit); a token with `auth_time` 60 days old was accepted by the server (the database refuses it only after a logout); `decoded.uid !== decoded.sub` can never be true, the check does nothing.
  Cookie lifetime is `Max-Age=2999`, flags `__Host-` `Secure; HttpOnly; SameSite=strict; Path=/`.
- **Impact:** none found: Firebase signs the tokens, and every data call is re-checked by the database with its own `auth_time` rule.
- **Fix:** delete the dead comparison; optionally refuse `iat` more than 60 s ahead.

### A9-09 (Note, live class): an issued class token cannot be taken back

- **Where:** `server/services/live-class-provider.ts:39-41`: `exp = min(session end + 30 min, now + 3 h)`, `nbf = now - 30`.
- **Proof:** code read. A student removed or suspended after joining keeps a working token until `exp`; the next open is refused by the database.
- **Impact:** small; the room name is 64 random hex characters and only in the token and in a `#fragment`; a removed student must already hold the link.
- **Fix:** none needed for V1; if wanted, shorten to 60 minutes and re-issue on rejoin.

### A9-10 (Note): the rate limiters live in one process's memory

- **Where:** `server/services/password-reset-limiter.ts:16`, `server/http/live-class.ts`.
- **Impact:** a restart or a second app container resets the counts; today one container runs, so limits hold.
- **Fix:** none now; move to the database if the app is scaled out (also noted for A7-06).

### A9-11 (Note): the three live direct table writes need a guard

- **Where:** table above.
- **Proof:** only three live `.from(table).insert/update` calls exist (all already assigned to A0-02, A3-01, A3-06).
- **Fix:** add one source test that fails if any other `server/**` file writes a table directly; it keeps the A0-02 group closed once finished.

### A9-12 (Note): a signed-in non-administrator learns that the platform-admin routes exist

- **Where:** `server/http/platform-admin-portals.ts:41` answers 403 with `reason: forbidden`; anonymous gets 401.
- **Proof:** matrix: student and teacher of another space got 403 on all four admin calls; the database check is before any data. `teacher-invitations/preview` returns only the caller's own state to any signed-in user.
- **Impact:** none beyond knowing the route exists.
- **Fix:** none.

### A9-13 (Low, cleanup): about 70 dead or 503-only files are still compiled and tested

See the cleanup list. They add attack surface (A9-02), slow builds and keep false tests passing. Fix: delete in the order below.

## Cleanup list

Each item: file, proof it is dead, what must change with it. "503" means the middleware answers 503 in Firebase mode (45 calls proven); "no caller" means `git grep` finds no import outside the item and its tests.

| # | Delete | Proof | Tests / locale / other to change |
| --- | --- | --- | --- |
| 1 | `app/api/upload/check-limit/` + `server/http/upload/` | 503; only the dead `uploadthing` flow called it | none besides the route; `scripts/dependency-security.test.cjs` mentions uploadthing |
| 2 | `server/services/storage-cleanup.ts` (A7-17) | only imported by the two legacy routes below | goes with items 1 and 4 |
| 3 | `app/api/support/` + `server/http/support/` (Resend) | 503; Support now uses the database tickets | `scripts/communications.test.cjs` line referencing it; `frontend/features/support/*` still call `/api/support` for old tickets: switch or delete with the support screen; remove `resend` from `package.json` |
| 4 | `app/api/courses/**` incl. `attachments`, `server/http/courses/**` | 503; `/api/courses/*/attachments` imports `storage-cleanup` | `frontend/features/courses/*` (legacy course detail, feedback, video player, homework form) and `scripts/backend.test.cjs`, `firebase-auth.test.cjs` |
| 5 | `app/api/uploadthing/`, `server/http/uploadthing/`, `server/integrations/uploadthing.ts` | 503 | remove `uploadthing` and `@uploadthing/react` from `package.json`; `app/globals.css`, `scripts/check-boundaries*.cjs`, `dependency-security.test.cjs`, `firebase-auth.test.cjs` mention it |
| 6 | `app/api/admin/**`, `server/http/admin/**`, `app/api/user/*`, `app/api/progress/complete`, Prisma `server/db.ts`, `server/queries/*`, `server/services/{user,teacher,course-statistics}.ts` | 503 (Prisma, Clerk only) | `app/(dashboard)/**` pages import `queries/*` and `course-statistics` (`courses/[courseId]/page.tsx:4`): delete those pages with them; `scripts/student-administration.test.cjs`, `backend.test.cjs`, `security-smoke.cjs` |
| 7 | The Clerk branches in `server/services/application-auth.ts`, `server/integrations/supabase.ts`, `middleware.ts`, `server/http/personalization/route.ts` | not reachable when `firebase-staging` is pinned | A1-08; `scripts/firebase-auth.test.cjs` |
| 8 | `server/services/lms-staging.ts`, `server/repositories/lms.ts` (A2a-12) | the `/lms-staging` page redirects to `/home`; only `scripts/lms.test.cjs` and `exam-security.test.cjs` import them | delete both tests' cases; their `media_assets` and `lesson_progress` writes go with them |
| 9 | `server/http/exam-runner.ts`, `server/services/exam-runner.ts`, `app/api/secure-exams/**` (A6b-06, A6b-09) | needs a legacy table that is empty on dev | only after A6b-02 ships (order in FIX_LIST) |
| 10 | `/api/homework` old actions (offerings, save, lifecycle, copy-media, inbox, assignments, grade, release, annotate) (A5-11) | no frontend caller after the teacher screens were removed | `scripts/homework*` tests that call them; middleware allow-list entry |
| 11 | `app/t/**` website, `app/api/teacher/website`, `app/api/student-academics`, `server/http/{website-editor,student-academics}.ts`, `server/services/{public-website,domain-routing,domain-verification,website-image}.ts` (A2b-10) | switched off for V1 by the owner | keep the database functions until A2b-02 to A2b-08 are fixed; delete only the unreachable server code if the owner prefers |
| 12 | `scripts/` browser and unit tests that pin items 1 to 11 | they pass today only because the dead code exists | update with each item; no locale keys were found that belong only to these routes (`frontend/features/support/*` keys stay until the support screen is checked) |

## Fix groups

- **Firebase console and header hardening:** A9-01, A9-05, A9-07, A9-02's build guard. No migration. Operator checks plus a small config change.
- **Auth routes tidy:** A9-03, A9-08, A9-04. Small code change; one test file.
- **Upload memory cap:** A9-06.
- **Server-write guard:** A9-11, ships with the direct-access revoke group (A0-02 and others) as its last step.
- **Cleanup:** A9-13, A9-02, plus A1-08, A2a-12, A4-06, A5-11, A6b-06, A6b-09, A7-17, A8 note on `course-statistics`. Order: items 1 to 5, then 6 to 8 together with their pages, then 9 after A6b-02, 10 after the A5 group.
- **Not changed:** A9-09, A9-10, A9-12 are accepted as written (Notes).

## Checked and fine

- **Token boundary** (phase 1, 26 cases): valid 200; expired, other project (aud and iss), wrong aud, other signing key, `alg none`, disabled, revoked, unknown to Google, token > 16,000 chars, no `idToken`: 401; unverified e-mail, no role claim, `role=service_role`: 403; `GET` on `session`: 405.
- **Database direct** (the same tokens through a Data API stand-in): valid returns the profile id; wrong aud, `email_verified` false or absent, other project and `alg none` return null or are refused at the gateway; anonymous 401.
- **Logout:** cookie cleared; the same token afterwards returns 401 at the server and null in the database; a token with a later `auth_time` works; logout with a foreign Origin is 403.
- **Origin/CSRF:** foreign Origin 403, no Origin 403, `Sec-Fetch-Site: cross-site` 403, trailing slash 403, `same-site` with the right Origin 200, no `Sec-Fetch-Site` with the right Origin 200 (non-browser). Cookie `SameSite=strict`.
- **Route matrix** (270 calls): no wrong caller got a 200 with data or changed a row. Right users changed only their own rows (`exam_attempts`, `exams`, `homework_assignments`, `courses`, `organizations`, live class rows).
- **Live class** (code and config): moderator only if `private.can_manage_group`; student gets "waiting" until staff start; 64-hex room; token window opens 15 min before and closes 30 min after; JWT secret server-side only; toolbar has no whiteboard; `custom-config.js` sets `config.whiteboard.enabled=false`; compose has no whiteboard collab server; Jitsi runs JWT-only with guests off. The EduLabs board page `/class/<id>/board` answers 404 unless `live_class_joined` says staff.
- **SSRF:** the only server-side fetch of a user-influenced URL is the provider avatar: https `*.googleusercontent.com`, no port, `redirect: 'error'`, 3 MB cap. `/t/*` ignores `X-Forwarded-Host` and fetches nothing user-given. Domain verification only does DNS TXT lookups and has no route.
- **Uploads:** paths come from the database (`register_lesson_upload`), not from the user; types are checked by magic bytes; signed URLs last 600 s (lessons, thumbnails), 300 s (homework, exam files), 90 s (avatars).
- **Logs:** only fixed event names and error codes; 0 token-like strings in the server log across both runs. Caddy writes no request log, so invitation tokens in URLs are not stored.
- **Staging/ops code:** `lms-staging.ts` is not reachable (the page redirects). Only Docker's `firebase-staging` build is shipped.

## Could not verify

- The live Firebase console state (A9-01), Cloudflare headers (A9-05), and whether the deployed host is pinned to the Docker build.
- Legacy (Clerk/Prisma) mode: not run.
- Against a real Jitsi: not run; the claims and config were read, not exercised.
- Positive paths of homework `get`/`work`/`upload-intent` and exam `upload intent` for the right student returned 403 in the matrix: my fixture's homework and exam were not in the right state, so those three "right user" cells prove nothing; the wrong-caller cells are still valid.
- Concurrent 50 MB uploads (A9-06) and real rate-limit counts under load.
- Production behaviour of the 8 s limits (the stand-in sets them, as in earlier parts).

## How the proofs ran

A disposable local PostgreSQL 17 on loopback (port 54921, UTC, 60 connections, hosted-like role timeouts), with all 52 migrations replayed into a template, cloned per run. A local stand-in for the Supabase Data API and Storage (RPC by `pg_proc` signature, table select/insert/patch/delete, storage policy checks, signed-URL tokens, third-party-token verification: RS256, issuer pinned, role `authenticated`). A local fake Google (public certificates, `accounts:lookup`, `signInWithCustomToken`) whose locally generated RSA key signed every test token. The real production build of the app (`next start`, `NEXT_PUBLIC_AUTH_BACKEND=firebase-staging`) with the repository's existing `scripts/speed/preload.cjs`, locally generated keys, Jitsi secret random per run. Phase 1 = 26 token and origin cases; phase 2 = 54 routes and actions × 5 callers, with a 29-table change fingerprint around every call. Demo fixtures only (`demo_fill_core`); no customer data. Everything (server, stand-ins, database, keys, the `.next-audit` build) was stopped and deleted afterwards.
