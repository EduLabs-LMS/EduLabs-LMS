# EduLabs auth email rate-limit gateway

This Worker is a private-by-secret HTTPS gateway for the staging branded Firebase verification and password-reset endpoints. It uses a SQLite-backed Durable Object, not an approximate per-location rate-limit binding.

## Policy (initial staging values)

- Verification resend: 60-second identity cooldown, max 5 per 24 hours.
- Password reset: max 3 per rolling hour and 5 per rolling 24 hours per hashed email identity.
- Teacher invitations: 60-second cooldown, max 3 per rolling hour and 5 per rolling 24 hours per hashed recipient email.
- All three email buckets combined: max 10 per rolling hour and 30 per rolling 24 hours per hashed client IP.
- Global staging budget: max 80 allowed email attempts per rolling 24 hours.
- Gateway requires `Authorization: Bearer <AUTH_EMAIL_GATEWAY_TOKEN>`, accepts only known buckets and 64-character SHA-256 identity/IP hashes, and never receives raw email or IP addresses.
- The app must fail closed (503) when this gateway is unreachable.

## Deploy

Use a trusted workstation with Node.js and npm; do not install deployment credentials on the app VPS merely to deploy this Worker.

1. From this directory, run `npx wrangler login` and authenticate the intended Cloudflare account.
2. Deploy the Durable Object and Worker: `npx wrangler deploy`.
3. Create a strong random shared token in a password manager. Run `npx wrangler secret put AUTH_EMAIL_GATEWAY_TOKEN` and paste it into the hidden prompt.
4. In the protected app environment at `/etc/edulabs/web.env`, set `AUTH_EMAIL_RATE_LIMIT_URL` to the deployed Worker's HTTPS URL and `AUTH_EMAIL_RATE_LIMIT_TOKEN` to the same token. Never commit the token or send it in chat.
5. Deploy the app branch only after its tests and review pass. The app routes fail closed until both settings are present.

## Smoke test

Use the Worker URL and token locally; do not place the token in shell history:

```bash
read -rsp 'Gateway token: ' TOKEN; echo
HASH=$(printf test | sha256sum | cut -d' ' -f1)
curl -fsS -X POST "$WORKER_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"bucket\":\"verification\",\"identity\":\"$HASH\",\"ip\":\"$HASH\"}"
unset TOKEN
```

Expect JSON containing `"allowed":true`. Run the same identity again immediately; expect `"allowed":false`. Use only synthetic hashes, never real student emails or IP addresses.

Do not deploy the app until the Worker smoke test passes and the account's verified sender is enabled. These limits are initial staging safeguards and must be reviewed before public launch.
