# EduLabs live classes (self-hosted Jitsi)

The server side of "Start class" / "Join". Everything here runs as its **own** Compose project (`edulabs-jitsi`) beside
EduLabs on the same VPS, pinned to docker-jitsi-meet **`stable-11248-3`**. The owner runs every command; the full,
copy-paste procedure (install, firewall, DNS, tunnel, start, health, logs, load, update, rollback, stop) is
[`docs/ai/ONLINE_CLASS_RUNBOOK.md`](../../docs/ai/ONLINE_CLASS_RUNBOOK.md).

| File | What it is |
| --- | --- |
| `compose.override.yml` | CPU/memory caps, CPU weight, OOM order, log limits for every Jitsi container; the pinned whiteboard backend; coturn |
| `jitsi.env.example` | Every setting, copied to `/etc/edulabs/jitsi.env` (root, 0600); secrets are generated on the server |
| `turnserver.conf.template` | coturn: TURN over TLS on 443/tcp, TURN on 3478/udp, relays only to this host's bridge |
| `render-turn.sh` | Writes `/etc/edulabs/jitsi/turnserver.conf` from the template and the env file |
| `certbot-deploy-hook.sh` | Puts the renewed TURN certificate where coturn reads it and restarts coturn |
| `jitsi.sh` | The only way to run the project: `check`, `up`, `down`, `logs`, `health`, `stats`, ... |
| `test-token.sh` | A 10-minute test address (moderator or member) for a smoke test before EduLabs is wired up |
| `web/custom-config.js`, `web/custom-interface_config.js` | No deep linking, name from the token, branding off |

Secrets never live in Git. EduLabs talks to this server through one module (`server/services/live-class-provider.ts`) and
generic `LIVE_CLASS_*` settings, so a later move to BigBlueButton on its own server replaces that module only.
