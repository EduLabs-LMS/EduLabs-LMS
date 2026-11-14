#!/usr/bin/env bash
# The ONE way to run the EduLabs live-class (Jitsi) Compose project. Run as root on the VPS from /opt/jitsi/edulabs.
#
#   ./jitsi.sh check      preflight only: settings, secrets, pinned checkout, files, ports (free and allowed). Changes nothing.
#   ./jitsi.sh up         preflight, start (or update) every container, then wait 20 s and check each is Up, not Restarting
#   ./jitsi.sh running    check now that every container is Up (prints the last log lines of any that is not)
#   ./jitsi.sh down       stop and remove the containers (configuration and certificates stay)
#   ./jitsi.sh restart [service]
#   ./jitsi.sh ps | pull | config
#   ./jitsi.sh ports      every port the Compose files publish (from `docker compose config`), plus coturn's host listeners
#   ./jitsi.sh logs [service] [--since 30m]
#   ./jitsi.sh health     loopback checks of web, bridge, focus, TURN
#   ./jitsi.sh stats      one snapshot of CPU / memory / network per container, plus the bridge's own numbers
#
# Its own project name (edulabs-jitsi): it never touches the EduLabs Compose project.
set -euo pipefail

ENV_FILE=${JITSI_ENV_FILE:-/etc/edulabs/jitsi.env}
UPSTREAM=${JITSI_UPSTREAM_DIR:-/opt/jitsi/docker-jitsi-meet}
HERE=$(cd "$(dirname "$0")" && pwd)
PROJECT=edulabs-jitsi
PINNED=stable-11248-3
TURN_DIR=/etc/edulabs/jitsi
# The user of the rootless Jitsi images (s6, uid/gid 1000 in stable-11248-3); compose.override.yml gives their /run to it.
JITSI_UID=1000
S6_SERVICES="web prosody jicofo jvb"
ALL_SERVICES="web prosody jicofo jvb coturn"

die() { echo "jitsi.sh: $*" >&2; exit 1; }
envget() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }
compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$UPSTREAM/docker-compose.yml" -f "$HERE/compose.override.yml" "$@"
}

preflight() {
  [ "$(id -u)" = 0 ] || die "run as root (sudo)"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (runbook step 4)"
  [ "$(stat -c '%U:%G %a' "$ENV_FILE")" = "root:root 600" ] || die "$ENV_FILE must be root:root mode 600"
  ! grep -q 'CHANGE_ME' "$ENV_FILE" || die "$ENV_FILE still has CHANGE_ME values"
  for key in JWT_APP_SECRET TURN_CREDENTIALS JICOFO_AUTH_PASSWORD JVB_AUTH_PASSWORD JIGASI_XMPP_PASSWORD \
             JIGASI_TRANSCRIBER_PASSWORD JIBRI_RECORDER_PASSWORD JIBRI_XMPP_PASSWORD; do
    [ -n "$(envget "$key")" ] || die "$key is empty in $ENV_FILE (runbook step 4)"
  done
  local jwt_secret; jwt_secret=$(envget JWT_APP_SECRET)
  [ "${#jwt_secret}" -ge 64 ] || die "JWT_APP_SECRET must be at least 64 characters"
  [ "$(envget JITSI_IMAGE_VERSION)" = "$PINNED" ] || die "JITSI_IMAGE_VERSION must be $PINNED (change PINNED here only with a reviewed update)"
  [ -d "$UPSTREAM/.git" ] || die "$UPSTREAM is not a git checkout of docker-jitsi-meet (runbook step 3)"
  [ "$(git -C "$UPSTREAM" describe --tags --exact-match 2>/dev/null)" = "$PINNED" ] || die "$UPSTREAM is not checked out at $PINNED"
  [ -z "$(git -C "$UPSTREAM" status --porcelain)" ] || die "$UPSTREAM has local changes; EduLabs changes belong in compose.override.yml"
  [ ! -e "$UPSTREAM/.env" ] || die "$UPSTREAM/.env exists; settings live only in $ENV_FILE"
  [ "$(envget HTTP_PORT)" = "127.0.0.1:8000" ] || die "HTTP_PORT must stay 127.0.0.1:8000 (loopback only)"
  [ "$(envget HTTPS_PORT)" = "127.0.0.1:8444" ] || die "HTTPS_PORT must be 127.0.0.1:8444 (loopback only; Caddy holds 127.0.0.1:8443)"
  [ "$(envget JVB_COLIBRI_PORT)" = "8090" ] || die "JVB_COLIBRI_PORT must be 8090 (Caddy holds 127.0.0.1:8080)"
  [ "$(envget ENABLE_GUESTS)" = "0" ] && [ "$(envget AUTH_TYPE)" = "jwt" ] || die "token auth must be on and guests off"
  # The meeting page may be framed only by the listed EduLabs origins: exact https origins, host only, separated by single spaces.
  local csp csp_re='^frame-ancestors( https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)+$'
  csp=$(envget CSP_HEADER)
  [[ $csp =~ $csp_re ]] || die "CSP_HEADER must be 'frame-ancestors' and then one or more EduLabs origins like https://staging.edulabs-eg.com, separated by single spaces"
  # No Jitsi whiteboard (owner, 2026-11-14): its backend checks no token. Nothing may turn it back on.
  ! grep -qE '^WHITEBOARD_' "$ENV_FILE" || die "$ENV_FILE has a WHITEBOARD_* setting; Jitsi's whiteboard is not used"
  ! grep -E '^TOOLBAR_BUTTONS=' "$ENV_FILE" | grep -q whiteboard || die "TOOLBAR_BUTTONS must not list whiteboard"
  ! compose config --services | grep -qx whiteboard || die "a whiteboard service is in the Compose project; Jitsi's whiteboard is not used"
  run_tmpfs_ok
  local cfg; cfg=$(envget CONFIG)
  config_dirs_ok "$cfg"
  [ -f "$cfg/web/custom-config.js" ] && [ -f "$cfg/web/custom-interface_config.js" ] || die "custom web config not installed (runbook step 5)"
  grep -q '^config.whiteboard = { enabled: false };' "$cfg/web/custom-config.js" || die "$cfg/web/custom-config.js must switch the whiteboard off (copy it again, runbook step 5)"
  # The meet host: no access log (tokens are in its addresses) and Referrer-Policy: no-referrer on every response. The pinned image includes
  # nginx-custom/*.conf in both server blocks; the installed file must be exactly ours, and the release must still include it.
  cmp -s "$HERE/web/nginx-custom/edulabs.conf" "$cfg/web/nginx-custom/edulabs.conf" || die "$cfg/web/nginx-custom/edulabs.conf is missing or differs from $HERE/web/nginx-custom/edulabs.conf (runbook step 5)"
  [ "$(find "$cfg/web/nginx-custom" -maxdepth 1 -name '*.conf' | wc -l)" = 1 ] || die "$cfg/web/nginx-custom must hold only edulabs.conf"
  [ ! -e "$cfg/web/nginx/custom-meet.conf" ] || die "$cfg/web/nginx/custom-meet.conf exists; the meet host's nginx settings live only in nginx-custom/edulabs.conf"
  grep -qx 'include /run/web/config/nginx-custom/\*.conf;' "$UPSTREAM/web/rootfs/defaults/meet.conf" || die "the pinned meet.conf no longer includes nginx-custom/*.conf"
  ! grep -q 'access_log' "$UPSTREAM/web/rootfs/defaults/meet.conf" "$UPSTREAM/web/rootfs/defaults/default" || die "the pinned web config sets its own access_log inside a server; edulabs.conf would not cover it"
  [ -f "$TURN_DIR/turnserver.conf" ] || die "$TURN_DIR/turnserver.conf is missing (run render-turn.sh)"
  [ -f "$TURN_DIR/turn-certs/fullchain.pem" ] && [ -f "$TURN_DIR/turn-certs/privkey.pem" ] || die "TURN certificate missing (runbook step 7)"
  # Public TCP 443 must be free for coturn (or already be coturn). Caddy must be on loopback only.
  local holder; holder=$(ss -Hltnp 'sport = :443' | grep -v '127.0.0.1:443' | grep -v '\[::1\]:443' || true)
  if [ -n "$holder" ] && ! grep -q turnserver <<<"$holder"; then die "something else listens on public TCP 443: $holder"; fi
  loopback_ports_free
}

# The loopback ports Jitsi publishes (web 8000, its unused HTTPS 8444, bridge REST 8090, focus REST 8888) must be free, or already
# be Jitsi's own (an update of a running project). Anything else holding one is named, with its process and container.
JITSI_LOOPBACK_PORTS="8000 8444 8090 8888"
loopback_ports_free() {
  local p listeners ours others
  for p in $JITSI_LOOPBACK_PORTS; do
    ours=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "publish=$p/tcp")
    [ -z "$ours" ] || continue
    listeners=$(ss -Hltnp "sport = :$p" | awk '{print $4, $6}')
    others=$(docker ps --filter "publish=$p/tcp" --format '{{.Names}} ({{.Image}}, compose project {{.Label "com.docker.compose.project"}})')
    if [ -n "$listeners" ] || [ -n "$others" ]; then
      die "TCP port $p, which Jitsi publishes on 127.0.0.1, is already in use: ${listeners:-no host listener}${others:+; container: $others}. Free it or ask; do not move EduLabs."
    fi
  done
}

# /run of every rootless service: exactly one tmpfs, owned by the images' user, executable (compose.override.yml).
run_tmpfs_ok() {
  local bad
  bad=$(compose config --format json | python3 -c '
import json, sys
uid, services = sys.argv[1], sys.argv[2:]
d = json.load(sys.stdin)["services"]
for s in services:
    runs = [t for t in (d.get(s, {}).get("tmpfs") or []) if t.split(":", 1)[0] == "/run"]
    opts = runs[0].split(":", 1)[1].split(",") if len(runs) == 1 and ":" in runs[0] else []
    if not (len(runs) == 1 and "uid=" + uid in opts and "gid=" + uid in opts and "exec" in opts):
        print(s, runs)
' "$JITSI_UID" $S6_SERVICES) || die "cannot read the Compose configuration"
  [ -z "$bad" ] || die "each of $S6_SERVICES needs exactly one /run tmpfs with uid=$JITSI_UID,gid=$JITSI_UID,exec (compose.override.yml): $bad"
}

# The folders under CONFIG. The images only READ their config folders (each copies /config into /run at start; custom-ca is
# mounted read-only), so those are root:root 0755 with nothing in them writable by anyone else. They WRITE only to storage and
# tmp, which belong to the images' user. Runbook step 5 creates both kinds; it never needs anything broader.
config_dirs_ok() {
  local cfg=$1 d have bad
  for d in web web/nginx-custom web/custom-ca prosody prosody/config prosody/prosody-plugins-custom prosody/custom-ca \
           jicofo jicofo/custom-ca jvb jvb/custom-ca; do
    [ -d "$cfg/$d" ] || die "$cfg/$d is missing (runbook step 5)"
    have=$(stat -c '%U:%G %a' "$cfg/$d")
    [ "$have" = "root:root 755" ] || die "$cfg/$d is $have; it must be root:root 755 (read-only input for the containers; runbook step 5)"
  done
  bad=$(find "$cfg/web" "$cfg/prosody" "$cfg/jicofo" "$cfg/jvb" \( ! -user root -o -perm /022 -o ! -perm -o=r \) -print | head -n 5)
  [ -z "$bad" ] || die "under $cfg/{web,prosody,jicofo,jvb} everything must be root-owned, readable by uid $JITSI_UID and writable by root only: $bad"
  for d in storage storage/prosody storage/web storage/transcripts storage/jibri tmp tmp/web-crontabs tmp/web-load-test; do
    [ -d "$cfg/$d" ] || die "$cfg/$d is missing (runbook step 5)"
    have=$(stat -c '%u:%g' "$cfg/$d")
    [ "$have" = "$JITSI_UID:$JITSI_UID" ] && [ -n "$(find "$cfg/$d" -maxdepth 0 -perm -u=rwx)" ] ||
      die "$cfg/$d is owned by $have; the containers write it as uid $JITSI_UID (runbook step 5: chown $JITSI_UID:$JITSI_UID, owner rwx)"
  done
}

# The images really run as JITSI_UID (what /run's owner above assumes). "strict" (./jitsi.sh up): every image must be pulled.
image_users_ok() {
  local repo svc img who
  repo=$(envget JITSI_IMAGE_REPO); repo=${repo:-ghcr.io/jitsi}
  for svc in $S6_SERVICES; do
    img="$repo/$svc:$PINNED"
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      [ "${1:-}" != strict ] || die "$img is not pulled yet (./jitsi.sh pull)"
      echo "note: $img is not pulled yet; ./jitsi.sh up checks its user"; continue
    fi
    who=$(docker run --rm --network none --entrypoint id "$img")
    case "$who" in "uid=$JITSI_UID(s6) gid=$JITSI_UID(s6)"*) ;; *) die "$img runs as '$who', not uid/gid $JITSI_UID (s6); update JITSI_UID and compose.override.yml after review" ;; esac
  done
}

# After a start: every container must be running, not restarting, and up for at least 10 seconds. Prints the last log lines of
# any that is not. $1 = seconds to wait first.
all_running() {
  local svc cid state restarting started restarts age bad=0
  if [ "${1:-0}" -gt 0 ]; then echo "waiting $1 s, then checking every container"; sleep "$1"; fi
  for svc in $ALL_SERVICES; do
    cid=$(compose ps -a -q "$svc")
    if [ -z "$cid" ]; then echo "$svc: NO CONTAINER"; bad=1; continue; fi
    read -r state restarting started restarts <<<"$(docker inspect -f '{{.State.Status}} {{.State.Restarting}} {{.State.StartedAt}} {{.RestartCount}}' "$cid")"
    age=$(( $(date +%s) - $(date -d "$started" +%s 2>/dev/null || date +%s) ))
    if [ "$state" = running ] && [ "$restarting" = false ] && [ "$age" -ge 10 ]; then
      echo "$svc: Up ${age}s (restarts: $restarts)"
    else
      echo "$svc: NOT UP (state $state, restarting $restarting, up ${age}s, restarts $restarts); last log lines:"
      compose logs --no-color --tail 30 "$svc" 2>&1 | sed 's/^/    /'
      bad=1
    fi
  done
  [ "$bad" = 0 ] || die "a container is not Up; read its log lines above, then ./jitsi.sh down and ask"
}

# Every published port as "service host_ip:published->target/protocol". Docker publishes around ufw, so this list IS the
# public surface of the containers (coturn uses the host network and is covered by ufw instead).
published_ports() {
  compose config --format json | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
for name, svc in sorted(cfg.get("services", {}).items()):
    if svc.get("network_mode") == "host":
        print(f"{name} host-network (listeners set by its own config; see ss -tulpn)")
        continue
    for p in svc.get("ports", []) or []:
        host = p.get("host_ip") or "0.0.0.0"
        proto = p.get("protocol") or "tcp"
        print("%s %s:%s->%s/%s" % (name, host, p.get("published"), p.get("target"), proto))
'
}
check_ports() {
  local bad
  bad=$(published_ports | grep -v 'host-network' | grep -v ' 127\.0\.0\.1:' | grep -v '^jvb 0\.0\.0\.0:10000->10000/udp$' || true)
  [ -z "$bad" ] || die "a port would be published publicly besides jvb 10000/udp: $bad"
}

case "${1:-}" in
  check) preflight; compose config --quiet; check_ports; image_users_ok; published_ports; echo "OK: preflight passed for $PINNED" ;;
  up) preflight; compose config --quiet; check_ports; image_users_ok strict; compose up -d --remove-orphans; compose ps; all_running 20 ;;
  running) all_running 0 ;;
  ports) published_ports ;;
  down) compose down ;;
  restart) shift; compose restart "$@" ;;
  ps) shift; compose ps "$@" ;;
  pull) preflight; compose pull ;;
  config) shift; compose config "$@" ;;
  logs) shift; compose logs --tail 200 "$@" ;;
  health)
    ok=0
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/) ; echo "web      http://127.0.0.1:8000/            -> $code"; [ "$code" = 200 ] || ok=1
    # The meet host's privacy settings, live: the header on a page and on an error, and a token-like query never reaches the log.
    for p in / /libs/edulabs-missing.js; do   # a page, and a 404 in a location with its own add_header
      if curl -s -o /dev/null -D - "http://127.0.0.1:8000$p" | tr -d '\r' | grep -qix 'referrer-policy: no-referrer'; then echo "web      Referrer-Policy on $p: no-referrer"; else echo "web      Referrer-Policy MISSING on $p"; ok=1; fi
    done
    probe="edulabs-health-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
    curl -s -o /dev/null "http://127.0.0.1:8000/healthroom?jwt=$probe&token=$probe"; sleep 2
    if compose logs --since 2m web 2>&1 | grep -q "$probe"; then echo "web      a query string WAS logged"; ok=1; else echo "web      query strings are not logged"; fi
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/about/health) ; echo "bridge   http://127.0.0.1:8090/about/health -> $code"; [ "$code" = 200 ] || ok=1
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/about/health) ; echo "focus    http://127.0.0.1:8888/about/health -> $code"; [ "$code" = 200 ] || ok=1
    ip=$(envget PUBLIC_IP); host=$(envget TURN_HOST)
    if ss -Hlunp 'sport = :3478' | grep -q turnserver; then echo "turn     udp $ip:3478 listening"; else echo "turn     udp 3478 NOT listening"; ok=1; fi
    if echo | timeout 5 openssl s_client -connect "$ip:443" -servername "$host" 2>/dev/null | openssl x509 -noout -subject -enddate; then :; else echo "turns    tls $ip:443 NOT answering"; ok=1; fi
    exit $ok ;;
  stats)
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' $(compose ps -q) $(docker ps -q --filter name=edulabs) 2>/dev/null || true
    echo; echo "bridge:"; curl -s http://127.0.0.1:8090/colibri/stats | python3 -c 'import json,sys; s=json.load(sys.stdin); [print(f"  {k}: {s.get(k)}") for k in ("conferences","participants","endpoints_sending_audio","endpoints_sending_video","bit_rate_download","bit_rate_upload","packet_rate_download","packet_rate_upload","stress_level")]' || echo "  (colibri stats unavailable)" ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
