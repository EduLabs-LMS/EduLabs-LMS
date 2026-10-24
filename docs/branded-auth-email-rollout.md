# Branded Firebase authentication email rollout

This branch replaces Firebase's default verification/password-reset email delivery in the Firebase/Supabase staging path with EduLabs-branded HTML and plain-text messages. Firebase Admin SDK still generates the one-time action links; the browser Firebase SDK validates and completes the actions.

## Implemented in this branch

- server/services/branded-auth-email.ts generates Firebase verification/reset links, validates the expected project/action mode, rewrites only the action destination to APP_ORIGIN/auth/action, renders escaped HTML plus plain text, and sends through the Brevo HTTPS transactional email API.
- /auth/action is a first-party page for explicit email verification and password reset. It checks the action code, asks the user to confirm the action, and removes the one-time code from the address bar/history after reading it.
- /api/auth/branded-email/verification sends verification mail only for the authenticated Firebase identity.
- /api/auth/branded-email/password-reset returns a generic success response to avoid revealing whether an email address has an account.
- Both API endpoints are restricted to Firebase/Supabase staging, require exact same-origin requests, bound request size, and fail closed if the external durable rate-limit gateway is not configured.
- Signup, resend verification, and password-reset controls call the branded endpoints rather than Firebase's built-in email sender.
- Focused tests cover action-link validation, output escaping, and missing delivery configuration.

## Required staging configuration

Set these only in the protected server runtime environment; never use NEXT_PUBLIC_ for secrets:

- BREVO_API_KEY — Brevo transactional REST API key, stored only in protected VPS runtime configuration (never Git or NEXT_PUBLIC_).
- AUTH_EMAIL_FROM — e.g. EduLabs <no-reply@mail.edulabs-eg.com>, using a verified Brevo sender on the authenticated mail.edulabs-eg.com domain.
- APP_ORIGIN=https://staging.edulabs-eg.com — exact origin used for links.
- AUTH_EMAIL_RATE_LIMIT_URL and AUTH_EMAIL_RATE_LIMIT_TOKEN — HTTPS endpoint and bearer secret for a durable rate-limit gateway. It receives only an action bucket, SHA-256 email hash, and SHA-256 client-IP hash. Its JSON response must include {"allowed":true} or {"allowed":false}. If it is unavailable or malformed, email requests fail closed.

The rate-limit gateway must enforce separate limits per bucket, hashed identity, and IP, including a cooldown for verification and password-reset requests. Do not expose its bearer secret to the browser. The endpoint is intentionally unavailable until this gateway is configured and tested.

## Brevo and Cloudflare setup

1. On 24 October 2026, the owner confirmed that mail.edulabs-eg.com shows Authenticated in Brevo. Four exact TXT/CNAME records were added to the existing Cloudflare DNS zone. Both DKIM CNAMEs are DNS-only; staging.edulabs-eg.com was preserved. Revalidate if the domain or provider is changed.
2. Register/verify the actual sender `no-reply@mail.edulabs-eg.com` in Brevo if it is not already recognized, and ensure the Brevo account is authorized for transactional email.
3. Disable open/click tracking for authentication emails where the account allows it; in particular do not rewrite one-time Firebase action links through tracking redirects. Verify the actual delivered URL before accepting the release.
4. Set BREVO_API_KEY only in the VPS protected server environment (`/etc/edulabs/web.env`) with appropriate permissions. Do not put it in GitHub, Cloudflare DNS, container build args, or NEXT_PUBLIC_ variables. Do not restart/deploy until separately reviewed and approved.
5. The existing server routes fail closed until AUTH_EMAIL_RATE_LIMIT_URL and AUTH_EMAIL_RATE_LIMIT_TOKEN point at a tested durable rate limiter. The gateway has not been implemented in this branch.
6. In Firebase Authentication settings for diagonproduction, authorize staging.edulabs-eg.com as an authorized domain for the client-side action handler. Do not remove other authorized domains without reviewing dependencies.
7. Retain Firebase's built-in template for flows not yet moved. Only verification and password reset are replaced by this branch.

## Acceptance tests before release

- Request a verification email for a new unverified test account; confirm sender, branding, HTML and text, and that the link uses https://staging.edulabs-eg.com/auth/action.
- Open the verification link, confirm the email action, and verify that access is still denied before verification and allowed after refresh/sign-in.
- Request a password reset for an existing password account and for a nonexistent email; the visible response must be the same.
- Complete a password reset, then verify the old password fails and the new password succeeds.
- Test expired, malformed, reused, wrong-mode and wrong-project links.
- Verify requests fail closed when rate limiting or email delivery is unavailable; confirm limits are effective across app restarts/instances.
- Inspect on mobile Gmail, Outlook, and Apple Mail. Verify that no Firebase-hosted URL is exposed in the visible action destination.
- Do not enable this flow in production until the production sender domain, action origin, rate-limit gateway, DNS, delivery logs/alerts, and live end-to-end acceptance are configured.

## Important scope limits

- Teacher invitations are not implemented by this branch yet. They should reuse the branded renderer/delivery service but use separate server-issued, single-use application-invitation records and must not reuse Firebase action codes.
- The transactional email provider is Brevo (HTTPS API). The existing Resend dependency remains installed for now, but is not used by this branded-auth-email service; remove it only in a separately validated dependency cleanup.
- Changing this Git branch does not configure Firebase Console, install secrets, deploy the rate-limit gateway, or deploy staging. Brevo DNS was configured separately in Cloudflare by owner authorization; no live Brevo API send has been tested.