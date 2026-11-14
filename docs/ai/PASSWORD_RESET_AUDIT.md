# Password reset: audit (`claude/password-reset`, 2026-11-14)

Written before any code, from the tree at `3fb6d88` (`claude/exams-student`). Nothing here was run against Firebase, Brevo or any
provider; it is a reading of the source, the lockfile and `node_modules` typings.

## 1. How sign-in works today

- **Client:** `firebase` 13.0.0 (`firebase/auth`). `frontend/features/auth/firebase-form.tsx` is the sign-in and sign-up form (email and
  password, Google popup/redirect, Apple off until configured). `frontend/lib/firebase.ts` creates the app from public
  `NEXT_PUBLIC_FIREBASE_*` values and sets `browserLocalPersistence`.
- **After a sign-in:** `synchronizeFirebaseSession` (`frontend/components/providers/firebase-auth-provider.tsx`) posts the ID token to
  `/api/auth/firebase/provision`, then `/api/auth/firebase/session`. The provider repeats this on every token change, so **any
  signed-in Firebase user in a page that sits under the root layout gets a session cookie**.
- **Server:** `firebase-admin` 14.5.0, `server/integrations/firebase-admin.ts` (`getFirebaseAdminAuth()`; a service account from
  `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`, a credential file, or ADC; refuses the emulator).
- **The session is not a Firebase session cookie.** `server/services/firebase-auth.ts`: an HttpOnly, SameSite=Strict cookie
  (`__Host-lms-firebase-id` in production) holds a real, short-lived **ID token**. Every request verifies it with
  `verifyIdToken(token, true)`, which includes the **revocation check**, and checks project, issuer and subject. Logout
  (`server/http/firebase/route.ts`) calls `revokeRefreshTokens(uid)` and clears the cookie.
- **Consequence for a password change:** Firebase treats a password change as a major account change: it moves the account's
  `tokensValidAfterTime` and invalidates refresh tokens. Because the app checks revocation on every request, an old browser's cookie is
  refused at its next request. (Firebase's documented behaviour; **not observed against a real project here**.)
- **Password rule in the app:** at least 12 characters, matching confirmation (`firebase-form.tsx` sign-up, `frontend/lib/account-security.ts`).
  There is no other rule (no class mix, no list).
- The sign-in page's own copy is English only today (its harness says so); Arabic shows the mirrored layout.
- Language: a same-origin cookie `edulabs_lms_language` plus `localStorage` (`shared/language.ts`); no account-level language is stored
  where the server can read it by email, and the server holds no service-role key to look one up.

## 2. Does "forgot password" exist?

Yes, and it is Firebase's default. `firebase-form.tsx` line 67: a "Forgot password?" button calls the client
`sendPasswordResetEmail(auth, email)`. That sends **Firebase's own email** (Firebase's template and sender) whose link opens **Firebase's hosted
page** (`<authDomain>/__/auth/action`). The button swallows `auth/user-not-found` so it shows one message
("If an account exists, a password reset email has been sent."). No custom page, no custom email, no rate limit of our own.
`scripts/sign-in-browser.cjs` asserts this button calls `sendPasswordResetEmail`; that assertion changes with this work.

## 3. Email through Brevo today

- `server/services/invitation-delivery.ts`: `createInvitationMailer()`. A plain `fetch` to `https://api.brevo.com/v3/smtp/email`
  (`api-key` header, 8 s abort, `redirect: 'error'`, `no-store`), sender parsed from `AUTH_EMAIL_FROM`. Outcomes `sent`, `rejected`
  (a 4xx, or not configured) and `unconfirmed` (timeout, 5xx, network), never retried automatically.
- **Where the key lives:** server environment only, `BREVO_API_KEY` and `AUTH_EMAIL_FROM` (`.env.example`; for staging the manager's
  `web.env`, `docs/platform-admin-staging-release.md`). Origin for links: `APP_ORIGIN`, via `canonicalAppOrigin()` (never a request header).
- **Templates:** one inline-styled HTML string plus a text string built in `invitationEmailContent()`, bilingual in one body
  (English block, then an RTL Arabic block), brand green `#7ed957`. The Brevo payload hard-codes the tag `edulabs-teacher-invitation`.
- The docs call the same key "the branded auth e-mail in staging `web.env`". No code in this repository sends an auth email through Brevo,
  so that is an operator-side setup this audit cannot see.

## 4. Firebase Admin features

- `Auth.generatePasswordResetLink(email, actionCodeSettings?)` exists in the installed `firebase-admin` 14.5.0
  (`lib/auth/base-auth.d.ts:433`). It returns a URL on the project's Firebase action handler carrying `oobCode`, `mode=resetPassword`, `apiKey`
  and `continueUrl`. It throws `auth/user-not-found` for an unknown email, **which is the enumeration signal to hide**.
- The server takes only the `oobCode` out of that URL and builds `APP_ORIGIN + /reset-password?oobCode=...`. Firebase's page is never linked.
- `ActionCodeSettings.url` must be on an **authorized domain** in the Firebase console; `APP_ORIGIN` already must be (popup sign-in needs it).
- The code is valid for 1 hour (Firebase's fixed lifetime; not configurable) and single use.
- `getUserByEmail` exposes `providerData`, so the server can tell a password account from a Google-only one.
- `revokeRefreshTokens(uid)` is already used (logout).
- The service account needs Firebase Authentication admin rights to mint a link. It already creates custom claims and revokes tokens, so
  it has user-management rights; **link creation was not tried against the real project**.

## 5. Things that do not exist (each handled as the brief says)

| Needed | State | What this work does |
| --- | --- | --- |
| A request limiter | None in the app. The only limiter is an **external gateway** for public websites (`PUBLIC_WEBSITE_RATE_LIMIT_URL`, fail-closed) that needs its own URL and token. | A small in-process limiter (per IP and per email), see PASSWORD_RESET section of DECISIONS.md. |
| A client IP | No code reads any forwarded header ("no forwarded IP is used", milestone 6c). | The IP header to trust is **configuration** (`PASSWORD_RESET_CLIENT_IP_HEADER`); unset means one shared per-IP bucket. |
| Bot protection | None (no captcha, no App Check). | None added, as the brief says. |
| An account language | Not readable by the server. | The page sends its current language; absent, the email carries both. |

## 6. Conflicts and questions

No blocker: every missing piece above has an answer in the brief, so the build continues. Questions the owner should answer
(also repeated in the report):

1. **Google-only accounts.** `generatePasswordResetLink` also works for an account that has no password; opening it would add a password
   login to that account. The app's own text says accounts are never linked automatically by email. This work sends the email **only for
   accounts that already have the password provider**; a Google-only account gets the same reply and no email. Is that right?
2. **Rate-limit storage.** In memory, per server process (resets on restart, not shared between instances). Fine for one Node process; for
   several instances an external store or the gateway pattern is needed. Which does staging run?
3. **Which header carries the real client IP** behind the staging proxy (`x-real-ip`? `x-forwarded-for`?).
4. **Sessions on other devices.** This work relies on Firebase's own invalidation plus the app's per-request revocation check (section 1) and
   adds nothing of its own, because the browser cannot call `revokeRefreshTokens` and nothing after a used code proves who is asking. If the
   owner wants an explicit server revocation, the reset must be confirmed server-side (the server calls the Identity Toolkit
   `resetPassword` itself and then revokes), which means the new password travels through our server.
