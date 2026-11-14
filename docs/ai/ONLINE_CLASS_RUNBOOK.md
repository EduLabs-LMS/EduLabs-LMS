# Online class server: runbook (self-hosted Jitsi on the EduLabs VPS)

For the owner. Every command is meant to be copied as it is, as root (`sudo -i`) on the VPS, in order. Nothing here was
run by Claude: the files were written and checked on a development PC only (see "What was not verified" at the end).

- **Version:** docker-jitsi-meet **`stable-11248-3`** (released 2026-11-02). It is the third patch of the `stable-11248` line
  that has been out since 2026-09-14, so it carries two months of fixes, and its only change over `-2` is the revert of a
  prosody module that had just been switched on (`mod_filter_direct_messages`). It is the first line after the move to
  rootless containers (uid 1000, read-only root filesystems) and to images on `ghcr.io/jitsi`, which this runbook assumes.
  Whiteboard backend `jitsi/excalidraw-backend:2026.3.0` (the one that release pins). TURN: `coturn/coturn:4.19.0-debian`.
- **Its own Compose project** (`edulabs-jitsi`), never inside the EduLabs one. Hard limits so the website wins: see
  `infra/jitsi/compose.override.yml` (table in step 8).
- **Where things live on the VPS:**
  `/opt/jitsi/docker-jitsi-meet` (upstream, at the pinned tag, never edited), `/opt/jitsi/edulabs` (a copy of this repo's
  `infra/jitsi/`), `/etc/edulabs/jitsi.env` (all settings and secrets, root 0600), `/etc/edulabs/jitsi/` (coturn config and
  certificate), `/srv/jitsi/cfg` (Jitsi's generated config and state).

## Ports: every one that opens, and why. Nothing else opens.

| Port | Where | Why |
| --- | --- | --- |
| 22/tcp | public | SSH (already open; unchanged) |
| **10000/udp** | public | The video bridge: every participant's audio, screen and whiteboard media. Published by Docker. |
| **443/tcp** | public | coturn **TURN over TLS** for phones on networks that block UDP (it looks like HTTPS). Caddy is on 127.0.0.1 only, so the public 443 is free (step 1 checks it). |
| **3478/udp** | public | coturn TURN/STUN over UDP for networks that block port 10000 but allow 3478. |
| 49160-49200/udp | **Docker networks only** (172.16.0.0/12), not the internet | coturn's relay ports. Only the bridge on this same host sends to them. |
| 127.0.0.1:8000/tcp | loopback | Jitsi web, reached only by the Cloudflare Tunnel (meet hostname) |
| 127.0.0.1:8443, :8080, :8888/tcp | loopback | Jitsi's own (unused HTTPS; bridge and focus health/stats). Upstream binds them to loopback. |

Port 80 is **not** opened: the TURN certificate is issued through DNS (step 7).

> Docker publishes 10000/udp straight through iptables, around ufw. The ufw rule in step 2 is still added so `ufw status`
> tells the truth, but closing the port means stopping Jitsi (step 15), not deleting the rule.

> **Your server's address becomes public.** The tunnel hides the VPS address for the website, but a video call cannot: the
> bridge tells every participant its address (that is how media reaches it), and `turn.<domain>` must be a DNS-only record.
> The website itself stays reachable only through the tunnel (Caddy listens on 127.0.0.1), but expect the address to be
> scanned. OVH's anti-DDoS covers the VPS. When classes move to their own server, this exposure moves with them.

## 0. Fill these in once (in the same shell for all steps)

```bash
export DOMAIN=example.com                 # your Cloudflare zone
export MEET_HOST=meet.$DOMAIN             # proxied (orange cloud), through the tunnel
export TURN_HOST=turn.$DOMAIN             # DNS only (grey cloud)
export PUBLIC_IP=203.0.113.10             # the VPS's public IPv4 (curl -4 https://ifconfig.co gives it)
export APP_ORIGIN=https://app.$DOMAIN     # where EduLabs is served (the frame-ancestors of the meeting page)
export LE_EMAIL=you@example.com           # Let's Encrypt expiry notices for the TURN certificate
export EDULABS_SRC=/opt/edulabs/current   # an EduLabs checkout that contains infra/jitsi (this branch or later)
```

## 1. Check the box first (changes nothing)

```bash
# 4 vCPU / 8 GB, Debian 13, Docker with Compose v2
nproc; free -h; . /etc/os-release; echo "$PRETTY_NAME"; docker --version; docker compose version

# Who listens where. Caddy must show 127.0.0.1:443 (or nothing on 443), never 0.0.0.0:443 or *:443.
ss -ltnup | sort -k5
ss -Hltnp 'sport = :443'          # expected: empty, or only 127.0.0.1:443 / [::1]:443 (Caddy)
ss -Hlunp 'sport = :3478'         # expected: empty
ss -Hlunp 'sport = :10000'        # expected: empty

# The address really is on this machine (no 1:1 NAT in front of it).
ip -4 addr show | grep -w "$PUBLIC_IP" || echo "WARNING: $PUBLIC_IP is not on an interface; stop and ask"

# How cloudflared runs here (needed in step 6): a systemd service, or a container?
systemctl is-active cloudflared 2>/dev/null; docker ps --format '{{.Names}} {{.Image}}' | grep -i cloudflared || true

# Current memory use of EduLabs, for comparison during the load check.
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

Stop here if anything listens on a public 443, 3478 or 10000.

## 2. Firewall

```bash
ufw status verbose                       # expect: default deny incoming; only OpenSSH allowed
ufw allow 10000/udp comment 'EduLabs class: video bridge media'
ufw allow 443/tcp   comment 'EduLabs class: TURN over TLS (coturn)'
ufw allow 3478/udp  comment 'EduLabs class: TURN/STUN (coturn)'
ufw allow from 172.16.0.0/12 to any port 49160:49200 proto udp comment 'EduLabs class: coturn relay, Docker networks only'
ufw status numbered
```

## 3. Get the pinned upstream and the EduLabs files

```bash
apt-get update && apt-get install -y git curl python3 certbot python3-certbot-dns-cloudflare vnstat
install -d -m 0755 /opt/jitsi
git clone --depth 1 --branch stable-11248-3 https://github.com/jitsi/docker-jitsi-meet.git /opt/jitsi/docker-jitsi-meet
git -C /opt/jitsi/docker-jitsi-meet describe --tags --exact-match        # must print: stable-11248-3
rm -rf /opt/jitsi/edulabs && cp -r "$EDULABS_SRC/infra/jitsi" /opt/jitsi/edulabs
chmod 0755 /opt/jitsi/edulabs/*.sh
```

## 4. Settings and secrets (`/etc/edulabs/jitsi.env`, root only, never in Git)

```bash
install -d -m 0750 /etc/edulabs
install -m 0600 -o root -g root /opt/jitsi/edulabs/jitsi.env.example /etc/edulabs/jitsi.env
sed -i -e "s|CHANGE_ME_MEET_HOST|$MEET_HOST|" -e "s|CHANGE_ME_TURN_HOST|$TURN_HOST|g" \
       -e "s|CHANGE_ME_PUBLIC_IP|$PUBLIC_IP|g" -e "s|CHANGE_ME_APP_ORIGIN|$APP_ORIGIN|" /etc/edulabs/jitsi.env

# Fill every empty secret with 96 random hex characters. The values are generated inside python and written straight to the
# file: they never appear on a command line, in the shell history or on the screen.
python3 -I - <<'PY'
import os, re, secrets
p = "/etc/edulabs/jitsi.env"
keys = ("JWT_APP_SECRET","TURN_CREDENTIALS","JICOFO_AUTH_PASSWORD","JVB_AUTH_PASSWORD","JIGASI_XMPP_PASSWORD",
        "JIGASI_TRANSCRIBER_PASSWORD","JIBRI_RECORDER_PASSWORD","JIBRI_XMPP_PASSWORD")
text = open(p, encoding="utf-8").read()
for k in keys:
    text = re.sub(rf"^{k}=$", f"{k}={secrets.token_hex(48)}", text, flags=re.M)
fd = os.open(p + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(text)
os.replace(p + ".new", p)
PY
stat -c '%U:%G %a %n' /etc/edulabs/jitsi.env        # root:root 600
grep -c 'CHANGE_ME' /etc/edulabs/jitsi.env          # 0
grep -E '^(JWT_APP_SECRET|TURN_CREDENTIALS)=.{96}$' /etc/edulabs/jitsi.env | cut -d= -f1   # both names, values not shown
```

Back up `/etc/edulabs/jitsi.env` the way the other `/etc/edulabs` files are backed up (encrypted, root only). Losing it only
means generating new secrets and redeploying EduLabs with the new `LIVE_CLASS_SECRET` (step 10).

## 5. Jitsi's own directories and the EduLabs web settings

Rootless containers run as uid 1000 and refuse to start if their writable directories are missing or not theirs.

```bash
CFG=/srv/jitsi/cfg
install -d -m 0755 $CFG $CFG/web $CFG/prosody $CFG/prosody/config $CFG/prosody/prosody-plugins-custom $CFG/jicofo $CFG/jvb
install -d -m 0750 -o 1000 -g 1000 $CFG/storage $CFG/storage/prosody $CFG/storage/web $CFG/storage/transcripts $CFG/storage/jibri \
  $CFG/tmp $CFG/tmp/web-crontabs $CFG/tmp/web-load-test
install -m 0644 /opt/jitsi/edulabs/web/custom-config.js           $CFG/web/custom-config.js
install -m 0644 /opt/jitsi/edulabs/web/custom-interface_config.js $CFG/web/custom-interface_config.js
```

## 6. Cloudflare: DNS records, tunnel route, cache

In the Cloudflare dashboard for `$DOMAIN`:

1. **TURN record (DNS only):** DNS > Records > Add record: Type `A`, Name `turn`, IPv4 = `$PUBLIC_IP`, Proxy status **DNS only**
   (grey cloud), TTL Auto. It must be grey: Cloudflare's proxy does not carry TURN.
2. **Meet hostname through the existing tunnel** (this also creates the proxied `meet` CNAME):
   - *Tunnel managed in the dashboard:* Zero Trust > Networks > Tunnels > your tunnel > Edit > Public Hostname > Add:
     Subdomain `meet`, Domain `$DOMAIN`, Service `HTTP` `127.0.0.1:8000`. Save.
   - *Tunnel managed by a local `config.yml`* (`/etc/cloudflared/config.yml`): add, **above** the final catch-all rule,
     ```yaml
       - hostname: meet.example.com      # your $MEET_HOST
         service: http://127.0.0.1:8000
     ```
     then `cloudflared tunnel route dns <tunnel-name> "$MEET_HOST"` and `systemctl restart cloudflared`.
   - If cloudflared runs **in a container** that is not on the host network, `127.0.0.1` is the container itself: use the
     address it already uses to reach Caddy, with port 8000 instead (ask before changing how cloudflared runs).
3. **No Cloudflare Access on `meet`.** Zero Trust > Access > Applications: make sure no application covers `meet.$DOMAIN`
   (including a `*.$DOMAIN` wildcard). If a wildcard exists, add an application for `meet.$DOMAIN` with a **Bypass** policy
   for Everyone. Security comes from the EduLabs tokens; Access would block students' phones.
4. **Do not cache or rewrite the meeting app:** Rules > Cache Rules > Create: "Hostname equals `meet.$DOMAIN`" > **Bypass
   cache**. Rules > Configuration Rules > Create for the same hostname: Rocket Loader **Off**, (Auto Minify off if your plan
   still shows it). Network > **WebSockets On** (it is on by default; the class needs it).

The TURN certificate, step 7, needs a Cloudflare API token (DNS edit on this zone only):
My Profile > API Tokens > Create Token > template **Edit zone DNS** > Zone Resources: Include, Specific zone, `$DOMAIN` >
Create. Copy it once; it goes into a root-only file below and nowhere else.

## 7. TURN certificate without opening port 80 (DNS challenge, automatic renewal)

```bash
install -d -m 0700 /etc/letsencrypt
( umask 077; read -rsp 'Cloudflare API token: ' T; echo; printf 'dns_cloudflare_api_token = %s\n' "$T" > /etc/letsencrypt/cloudflare-turn.ini; unset T )
stat -c '%U:%G %a %n' /etc/letsencrypt/cloudflare-turn.ini      # root:root 600

certbot certonly --non-interactive --agree-tos -m "$LE_EMAIL" \
  --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare-turn.ini --dns-cloudflare-propagation-seconds 30 \
  --key-type ecdsa -d "$TURN_HOST" \
  --deploy-hook /opt/jitsi/edulabs/certbot-deploy-hook.sh

ls -l /etc/edulabs/jitsi/turn-certs/          # fullchain.pem and privkey.pem, root:65534 0640 (the hook copied them)
systemctl list-timers | grep certbot          # Debian's certbot.timer renews twice a day when due; the hook runs on renewal
certbot renew --dry-run                       # proves renewal works without changing anything
```

How it works: Let's Encrypt asks for a TXT record under `_acme-challenge.turn.$DOMAIN`; certbot creates it through the API
token, Let's Encrypt checks it over DNS, certbot removes it. No inbound port is used. On renewal (about every 60 days) the
deploy hook copies the new files to `/etc/edulabs/jitsi/turn-certs/` and restarts only coturn.

## 8. Render coturn's config, check, start

```bash
cd /opt/jitsi/edulabs
./render-turn.sh                  # writes /etc/edulabs/jitsi/turnserver.conf (root:65534 0640)
docker run --rm --entrypoint id coturn/coturn:4.19.0-debian    # expect uid=65534(nobody) gid=65534(nogroup); else tell Claude
./jitsi.sh check                  # preflight: settings, secrets, pinned checkout, directories, certificate, port 443
./jitsi.sh pull
./jitsi.sh up
./jitsi.sh ps                     # web, prosody, jicofo, jvb, whiteboard, coturn: all "running"/"Up"
```

The limits now in force (`compose.override.yml`):

| Container | CPU cap | Memory cap | CPU weight | OOM order |
| --- | --- | --- | --- | --- |
| jvb (video bridge) | 2.0 | 1280 MB (Java heap 896 MB) | 512 | killed before the app |
| jicofo | 0.5 | 512 MB (heap 320 MB) | 512 | before the app |
| prosody | 0.5 | 256 MB | 512 | before the app |
| web (nginx) | 0.5 | 128 MB | 512 | before the app |
| whiteboard | 0.25 | 192 MB | 256 | first |
| coturn | 0.5 | 128 MB | 512 | before the app |
| **Jitsi total** | | **2.44 GB** | | |

With EduLabs at its own caps (app 3 GB, Caddy 256 MB, worker 384 MB) the worst case is 6.0 GB of 8 GB. CPU weights make the
app win under contention. Every container: restart `unless-stopped`, logs 3 x 10 MB.

## 9. Health check and smoke test (before EduLabs is connected)

```bash
cd /opt/jitsi/edulabs
./jitsi.sh health                 # web 200, bridge 200, focus 200, turn udp listening, turns certificate subject/expiry
curl -sI "https://$MEET_HOST/" | head -1                       # HTTP/2 200 through Cloudflare
curl -sI "https://$MEET_HOST/" | grep -i content-security       # frame-ancestors <your APP_ORIGIN>
curl -s  "https://$MEET_HOST/config.js" | grep -E 'disableDeepLinking|enableClosePage' | head    # true / false

./test-token.sh moderator         # open the printed address on the teacher's laptop (Chrome or Edge)
./test-token.sh member <room>     # same room name as the line above; open on an Android phone ON MOBILE DATA (Wi-Fi off)
```

Expected: the laptop joins as moderator and can share the screen, open the whiteboard and start "Record" (local recording);
the phone stays in the browser (no "get the app" page), joins muted with the camera off, sees the screen and whiteboard, and
cannot open the whiteboard, record or mute others. Opening `https://$MEET_HOST/anything` without a token must refuse.
Both addresses expire after 10 minutes; do not paste them anywhere.

TURN check (optional, from the laptop): in Chrome open `chrome://webrtc-internals` during the call; with the phone on a
network that blocks UDP, its candidate pair shows `relay` via `$TURN_HOST`.

## 10. Connect EduLabs (only after the EduLabs part is approved and deployed)

EduLabs needs four settings in its own protected web env (`/etc/edulabs/web.env`, root 0600). With any of them missing,
"Start class" and "Join" are hidden and "Own link" Groups keep working.

```bash
python3 -I - <<'PY'
import os
src = dict(l.rstrip("\n").split("=", 1) for l in open("/etc/edulabs/jitsi.env", encoding="utf-8") if "=" in l and not l.startswith("#"))
add = {"LIVE_CLASS_PROVIDER": "jitsi", "LIVE_CLASS_URL": src["PUBLIC_URL"],
       "LIVE_CLASS_APP_ID": src["JWT_APP_ID"], "LIVE_CLASS_SECRET": src["JWT_APP_SECRET"]}
p = "/etc/edulabs/web.env"
lines = [l for l in open(p, encoding="utf-8").read().splitlines() if l.split("=", 1)[0] not in add]
lines += [f"{k}={v}" for k, v in add.items()]
fd = os.open(p + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f: f.write("\n".join(lines) + "\n")
os.replace(p + ".new", p)
print("LIVE_CLASS_* written to", p)
PY
grep -E '^LIVE_CLASS_(PROVIDER|URL|APP_ID)=' /etc/edulabs/web.env      # the secret is not printed
```

Then redeploy EduLabs the usual way (`infra/deploy.sh`). EduLabs sends no Content-Security-Policy or Permissions-Policy on
its pages today, so its class page can frame `$MEET_HOST` (the frame asks for camera, microphone, screen sharing and
fullscreen); if either header is added later, it must allow that.

## 11. Logs

```bash
cd /opt/jitsi/edulabs
./jitsi.sh logs jvb --since 30m          # media: ICE failures, "stress"
./jitsi.sh logs prosody --since 30m      # tokens: "Token ... not allowed", "Error verifying token" = a bad or expired token
./jitsi.sh logs jicofo --since 30m       # who joined which room, bridge selection
./jitsi.sh logs web --since 30m
./jitsi.sh logs coturn --since 30m       # TURN allocations; "401" lines before success are normal (nonce)
./jitsi.sh logs -f jvb                    # follow live (Ctrl+C to stop)
```

The web access log records meeting addresses, which carry the short-lived token as `?jwt=`. Tokens expire at the end of the
class window; logs rotate at 3 x 10 MB per container. Do not copy those lines into tickets or chats.

## 12. Load check during a class

```bash
cd /opt/jitsi/edulabs
watch -n 5 ./jitsi.sh stats              # CPU %, memory, network per container (Jitsi and EduLabs), and the bridge's
                                         # participants, bit rates (kbit/s) and stress level (keep it below 0.8)
vnstat -l -i "$(ip -4 route show default | awk '{print $5; exit}')"     # live bandwidth of the public interface (Ctrl+C)
uptime                                   # load average; above 4 means the CPUs are saturated
docker inspect -f '{{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' $(docker ps -aq)
```

What to expect for ~15 phones with cameras off and the teacher sharing a PDF and the whiteboard (estimates, to be confirmed by
the first real class): bridge download ~1-3 Mbit/s (the teacher), upload ~15-40 Mbit/s (one screen stream per student), bridge
CPU well under one core. Write down the first class's numbers in this file. If the bridge's stress level stays above 0.8, or
EduLabs pages slow down while a class runs, that is the signal to move classes to their own server.

## 13. Update safely (outside class hours)

```bash
cd /opt/jitsi/edulabs
OLD=$(git -C /opt/jitsi/docker-jitsi-meet describe --tags --exact-match); echo "now on $OLD"
tar -C /srv/jitsi -czf /root/jitsi-cfg-$(date +%F)-$OLD.tgz cfg       # back up generated config and state
cp -a /etc/edulabs/jitsi.env /root/jitsi.env.$OLD                        # back up settings (root only)
```

Then, for a new upstream tag `NEW` that has been out at least two weeks: read its release notes and the diff of
`env.example`, `docker-compose.yml` and `whiteboard.yml` against `OLD`; an update is a reviewed EduLabs change (new `PINNED`
in `jitsi.sh`, `JITSI_IMAGE_VERSION` in `jitsi.env.example`, whiteboard image in `compose.override.yml`, this runbook).
Then:

```bash
NEW=stable-XXXXX                                     # the reviewed tag
git -C /opt/jitsi/docker-jitsi-meet fetch --depth 1 origin tag "$NEW"
git -C /opt/jitsi/docker-jitsi-meet checkout -q "$NEW"
rm -rf /opt/jitsi/edulabs && cp -r "$EDULABS_SRC/infra/jitsi" /opt/jitsi/edulabs && chmod 0755 /opt/jitsi/edulabs/*.sh
sed -i "s/^JITSI_IMAGE_VERSION=.*/JITSI_IMAGE_VERSION=$NEW/" /etc/edulabs/jitsi.env
cd /opt/jitsi/edulabs && ./jitsi.sh check && ./jitsi.sh pull && ./jitsi.sh up && ./jitsi.sh health
./test-token.sh moderator                            # repeat the step 9 smoke test
```

## 14. Roll back

```bash
OLD=stable-11248-3                                   # the version that worked
git -C /opt/jitsi/docker-jitsi-meet fetch --depth 1 origin tag "$OLD"; git -C /opt/jitsi/docker-jitsi-meet checkout -q "$OLD"
cp -a /root/jitsi.env.$OLD /etc/edulabs/jitsi.env && chmod 0600 /etc/edulabs/jitsi.env
# restore the EduLabs infra/jitsi copy of that version (the EduLabs commit you deployed before), then:
cd /opt/jitsi/edulabs && ./jitsi.sh down
rm -rf /srv/jitsi/cfg && tar -C /srv/jitsi -xzf /root/jitsi-cfg-<date>-$OLD.tgz
./jitsi.sh up && ./jitsi.sh health
```

Jitsi keeps no class data (no recordings on the server, no accounts), so a rollback loses nothing but in-progress calls.

## 15. Stop Jitsi completely

```bash
cd /opt/jitsi/edulabs && ./jitsi.sh down                 # all Jitsi containers gone; EduLabs untouched
ufw delete allow 10000/udp; ufw delete allow 443/tcp; ufw delete allow 3478/udp
ufw delete allow from 172.16.0.0/12 to any port 49160:49200 proto udp
ufw status numbered
```

EduLabs side: remove the four `LIVE_CLASS_*` lines from `/etc/edulabs/web.env` and redeploy; Start class and Join disappear,
Own link Groups keep working. To remove everything: delete the `meet` public hostname from the tunnel and the `turn` DNS
record in Cloudflare, revoke the Cloudflare API token, `certbot delete --cert-name $TURN_HOST`, then
`rm -rf /opt/jitsi /srv/jitsi /etc/edulabs/jitsi /etc/edulabs/jitsi.env /etc/letsencrypt/cloudflare-turn.ini`.

## What was not verified

Written on a development PC; nothing was run on the VPS or against Cloudflare. In particular not verified: that the coturn
image runs as uid 65534 (step 8 checks it), that `token_affiliation` loads in this prosody image and makes only
`moderator: true` tokens moderators (step 9 checks it), the excalidraw backend's internal port (the upstream example URL has
none), Cloudflare WebSocket behaviour for `/xmpp-websocket`, `/colibri-ws` and `/socket.io/`, real bandwidth and CPU of a class,
and phone behaviour on Egyptian mobile networks.
