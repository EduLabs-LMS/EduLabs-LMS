# Branded Firebase authentication email rollout

This branch replaces Firebase's default verification/password-reset email delivery in the Firebase/Supabase staging path with EduLabs-branded HTML and plain-text messages. Firebase Admin SDK still generates the one-time action links; the browser Firebase SDK validates and completes the actions.

## Implemented in this branch

- server/services/branded-auth-email.ts generates Firebase verification/reset links, validates the expected project/action mode, rewrites only the action destination to APP_ORIGIN/auth/action, renders escaped HTML plus plain text, and sends through the already-installed Resend SDK.
- /auth/action is a first-party page for explicit email verification and password reset. It checks the action code, asks the user to confirm the action, and removes the one-time code from the address bar/history after reading it.
- /api/auth/branded-email/verification sends verification mail only for the authenticated Firebase identity.
- /api/auth/branded-email/password-reset returns a generic success response to avoid revealing whether an email address has an account.
- Both API endpoints are restricted to Firebase/Supabase staging, require exact same-origin requests, bound request size, and fail closed if the external durable rate-limit gateway is not configured.
- Signup, resend verification, and password-reset controls call the branded endpoints rather than Firebase's built-in email sender.
- Focused tests cover action-link validation, output escaping, and missing delivery configuration.

## Required staging configuration

Set these only in the protected server runtime environment; never use NEXT_PUBLIC_ for secrets:

- RESEND_API_KEY — API key from the EduLabs Resend account.
- AUTH_EMAIL_FROM — e.g. EduLabs <no-reply@mail.edulabs-eg.com>, only after that domain is verified by Resend.
- APP_ORIGIN=https://staging.edulabs-eg.com — exact origin used for links.
- AUTH_EMAIL_RATE_LIMIT_URL and AUTH_EMAIL_RATE_LIMIT_TOKEN — HTTPS endpoint and bearer secret for a durable rate-limit gateway. It receives only an action bucket, SHA-256 email hash, and SHA-256 client-IP hash. Its JSON response must include {"allowed":true} or {"allowed":false}. If it is unavailable or malformed, email requests fail closed.

The rate-limit gateway must enforce separate limits per bucket, hashed identity, and IP, including a cooldown for verification and password-reset requests. Do not expose its bearer secret to the browser. The endpoint is intentionally unavailable until this gateway is configured and tested.

## Resend and Cloudflare setup

1. In Resend, add mail.edulabs-eg.com and copy the exact DNS records it generates.
2. Add those exact records in Cloudflare DNS. Do not guess DKIM/MX/TXT values. Preserve unrelated DNS records. Wait for Resend to show the domain verified.
3. Configure SPF/DKIM as instructed by Resend. Check DMARC alignment for the selected From address; do not publish conflicting SPF records.
4. Set the runtime secrets above in the staging host's protected web environment file and restart only the staging app after reviewing the resulting configuration.
5. In Firebase Authentication settings for diagonproduction, authorize staging.edulabs-eg.com as an authorized domain for the client-side action handler. Do not remove existing authorized domains until their usage is understood.
6. Keep Firebase's built-in template configured as a fallback for any flows not yet moved. This branch only replaces the verification and password-reset flows it explicitly calls.

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
- The email provider is Resend because the repository already includes the SDK; no new runtime dependency is introduced.
- No Firebase Console settings, DNS records, provider secrets, or staging deployment are changed by the code branch itself.