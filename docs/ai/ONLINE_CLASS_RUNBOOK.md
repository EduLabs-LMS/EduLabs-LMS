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
| 127.0.0.1:8000/tcp | loopback | Jitsi web, reached only by the Cloudflare Tunnel (meet hostname). The whiteboard is reached through it too (`/socket.io/`). |
| 127.0.0.1:8443, :8080, :8888/tcp | loopback | Jitsi's own (unused HTTPS; bridge and focus health/stats). Upstream binds them to loopback. |

Port 80 is **not** opened: the TURN certificate is issued through DNS (step 7).

**Not opened: coturn's relay ports 49160-49200/udp.** coturn sends a phone's media from a relay port on 51.195.252.97 to
51.195.252.97:10000. That packet never leaves the machine: Docker's NAT hands it to the bridge container (or Docker's proxy
for the published port does). The bridge's answers travel back over the same connection, which the kernel tracks, so the
firewall accepts them as replies (`ESTABLISHED`) without any rule. A packet the bridge sends first, before coturn has sent
anything, would come from the container's private address, and coturn drops it anyway (it relays only for 51.195.252.97).
So no rule is needed, and with none, nothing from outside can reach those ports. Step 9 proves both: an outside probe is
logged as `[UFW BLOCK]`, and a phone on a network that blocks UDP still gets a relayed call. (The first version of this
runbook opened the range to `172.16.0.0/12`; that rule was unnecessary and is gone. If the relayed call fails and the
kernel log shows `[UFW BLOCK] IN=br-jitsi ... DPT=4916x`, step 9 gives the one interface-bound rule to add.)

**Published by Docker** (they bypass ufw, so this list is the whole public surface of the containers). From the
stable-11248-3 `docker-compose.yml` and `whiteboard.yml` with this override, `./jitsi.sh ports` prints:

```
coturn host-network (listeners set by its own config; see ss -tulpn)
jicofo 127.0.0.1:8888->8888/tcp
jvb 0.0.0.0:10000->10000/udp
jvb 127.0.0.1:8080->8080/tcp
web 127.0.0.1:8000->8000/tcp
web 127.0.0.1:8443->8443/tcp
```

Prosody only `expose`s 5222, 5269, 5347 and 5280 inside the Docker network (not published). The whiteboard publishes nothing
(it listens on 80, metrics on 9090, inside the network only). There is no 4443/tcp in this release. `./jitsi.sh check` and
`./jitsi.sh up` refuse to start if any port other than `jvb 0.0.0.0:10000/udp` would be published on a non-loopback address.

> Docker publishes 10000/udp straight through iptables, around ufw. The ufw rule in step 2 is still added so `ufw status`
> tells the truth, but closing the port means stopping Jitsi (step 15), not deleting the rule.

> **Your server's address becomes public.** The tunnel hides the VPS address for the website, but a video call cannot: the
> bridge tells every participant its address (that is how media reaches it), and `turn.<domain>` must be a DNS-only record.
> The website itself stays reachable only through the tunnel (Caddy listens on 127.0.0.1), but expect the address to be
> scanned. OVH's anti-DDoS covers the VPS. When classes move to their own server, this exposure moves with them.

## 0. Fill these in once (in the same shell for all steps)

```bash
export DOMAIN=edulabs-eg.com              # the Cloudflare zone
export MEET_HOST=meet.edulabs-eg.com      # proxied (orange cloud), through the tunnel
export TURN_HOST=turn.edulabs-eg.com      # DNS only (grey cloud)
export PUBLIC_IP=51.195.252.97            # the VPS's public IPv4
export APP_ORIGIN=https://CHANGE_ME       # the exact address students open EduLabs on (scheme + host, no path), e.g.
                                          # https://edulabs-eg.com; the meeting page may be framed only by this origin
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
ufw logging low                          # blocked packets go to the kernel log (step 9 uses it as proof)
ufw status numbered                      # exactly OpenSSH + these three; nothing for 49160-49200
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
case "$APP_ORIGIN" in *CHANGE_ME*) echo "set APP_ORIGIN in step 0 first"; false;; esac && \
sed -i -e "s|CHANGE_ME_APP_ORIGIN|$APP_ORIGIN|" /etc/edulabs/jitsi.env
grep -E '^(PUBLIC_URL|TURN_HOST|PUBLIC_IP|JVB_ADVERTISE_IPS|CSP_HEADER)=' /etc/edulabs/jitsi.env   # meet/turn.edulabs-eg.com, 51.195.252.97

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
./jitsi.sh check                  # preflight: settings, secrets, pinned checkout, directories, certificate, port 443,
                                  # and the published-port list above (refuses any public port but 10000/udp)
./jitsi.sh pull
./jitsi.sh up
./jitsi.sh ps                     # web, prosody, jicofo, jvb, whiteboard, coturn: all "running"/"Up"
ip -br link show br-jitsi         # the Jitsi network's interface has its fixed name
```

Verify what actually listens, after the start:

```bash
ss -Htulpn | awk '{print $1, $5, $7}' | sort
```

The Jitsi lines must be exactly these (plus whatever EduLabs, SSH and cloudflared had in step 1; ignore ephemeral
`127.0.0.1` ports of cloudflared):

```
tcp 127.0.0.1:8000  docker-proxy       (web)
tcp 127.0.0.1:8443  docker-proxy       (web, unused)
tcp 127.0.0.1:8080  docker-proxy       (bridge REST)
tcp 127.0.0.1:8888  docker-proxy       (focus REST)
udp 0.0.0.0:10000   docker-proxy       (bridge media; may also show [::]:10000)
tcp 51.195.252.97:443   turnserver     (TURN over TLS)
udp 51.195.252.97:3478  turnserver     (TURN/STUN)
```

Anything else bound to `0.0.0.0`, `[::]` or `51.195.252.97` that was not there in step 1 is a fault: run `./jitsi.sh down`
and ask. (Whether `docker-proxy` appears depends on Docker's userland proxy setting; the addresses are what matter.)

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

Expected, and what each line proves:

| Check | Expected | Enforced by |
| --- | --- | --- |
| Open `https://$MEET_HOST/anything` with no token | refused (authentication required) | server (prosody, token auth, no guests) |
| Phone joins | stays in the browser (no "get the app" page), muted, camera off, name from the token and not editable | config |
| Phone's toolbar | no Share screen, no Whiteboard, no Record button | display only (see the limits below) |
| Laptop (moderator) | Share screen, Whiteboard and Record are there; sharing a PDF works | token = moderator |
| Teacher opens the whiteboard | the phone sees it and **can draw on it** | Jitsi has no view-only whiteboard |
| A member creates the whiteboard: on a laptop, open the member address with `#config.toolbarButtons=["whiteboard"]` added, before the teacher opens one | nothing opens (the student is not allowed to start a whiteboard) | server: only moderators may write the room data that creates it |
| Teacher presses Record > local recording | every participant, the phone included, sees a "recording started" notice; the file is saved on the teacher's laptop | config (notify all) |
| Phone tries to record | not possible (phone browsers lack the recording API) | the browser |
| Teacher mutes the phone, or lowers its hand, from the participants list | works; the phone cannot make itself moderator | server (token affiliation, no auto-owner, no grant) |
| Whiteboard backend | `curl -s "https://$MEET_HOST/socket.io/?EIO=4&transport=polling" \| head -c 40` prints a socket.io handshake (`0{"sid":...`); `ss -Htlnp \| grep -E ':(80\|9090) '` shows nothing public | reached only through the meet host |

**Known limits, accepted by design** (details in `ONLINE_CLASS_AUDIT.md`, "Known limits"): a student on a **desktop or
laptop** browser who adds buttons to the page address (as in the whiteboard row) can share a screen or start Jitsi's local
recording; Jitsi stable-11248-3 has no server rule against either. Everyone is notified when local recording starts, the
teacher can stop a share (mute the student's video, or remove them), and nobody can prevent anyone from recording their own
screen with their device's own tools. Phones, which most students use, can do neither.

Both addresses expire after 10 minutes; do not paste them anywhere.

**TURN and the relay ports (proof for the "Not opened" note above):**

```bash
# 1. Nothing outside reaches the relay ports. From ANOTHER machine (your laptop, not the VPS):
#      echo probe | nc -u -w1 51.195.252.97 49170
#    then on the VPS:
journalctl -k --since -5min | grep 'DPT=49170'      # a "[UFW BLOCK] IN=<public interface> ... DPT=49170" line
iptables -S ufw-user-input | grep -c 4916            # 0: no rule mentions the relay range
```

2. A relayed call works: put the phone on a network that blocks UDP (or a laptop with outgoing UDP blocked), join the test
room, and in Chrome on the laptop open `chrome://webrtc-internals`: the phone's selected candidate pair is `relay`
(`$TURN_HOST`, TLS). `./jitsi.sh logs coturn --since 5m` shows the allocation.
3. Only if step 2 fails **and** `journalctl -k --since -5min | grep 'IN=br-jitsi.*DPT=491[6-9]'` shows blocked lines, add
this one rule (it matches only packets arriving on the Jitsi Docker interface, which no outside host can send on) and
retry: `ufw allow in on br-jitsi to 51.195.252.97 port 49160:49200 proto udp comment 'EduLabs class: relay, Jitsi network only'`.

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
ufw status numbered        # if step 9.3's br-jitsi rule was added, delete it too (ufw delete <number>)
```

EduLabs side: remove the four `LIVE_CLASS_*` lines from `/etc/edulabs/web.env` and redeploy; Start class and Join disappear,
Own link Groups keep working. To remove everything: delete the `meet` public hostname from the tunnel and the `turn` DNS
record in Cloudflare, revoke the Cloudflare API token, `certbot delete --cert-name $TURN_HOST`, then
`rm -rf /opt/jitsi /srv/jitsi /etc/edulabs/jitsi /etc/edulabs/jitsi.env /etc/letsencrypt/cloudflare-turn.ini`.

## What was not verified

Written on a development PC; nothing was run on the VPS or against Cloudflare. Read from the sources of the pinned release
and of jitsi-meet / jicofo / excalidraw-backend master (2026-11-14): the published ports, the whiteboard backend's port (80) and
its lack of token checks, who may create the whiteboard, what the local-recording settings do, and that jicofo does not refuse
a screen share at source-add. Not verified: that the coturn image runs as uid 65534 (step 8 checks it), that
`token_affiliation` loads in this prosody image and makes only `moderator: true` tokens moderators (step 9 checks it), the relay
path's conntrack behaviour on this kernel and Docker (step 9 proves it), Cloudflare WebSocket behaviour for `/xmpp-websocket`,
`/colibri-ws` and `/socket.io/`, real bandwidth and CPU of a class, and phone behaviour on Egyptian mobile networks.
