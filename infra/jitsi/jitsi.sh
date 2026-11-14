#!/usr/bin/env bash
# The ONE way to run the EduLabs live-class (Jitsi) Compose project. Run as root on the VPS from /opt/jitsi/edulabs.
#
#   ./jitsi.sh check      preflight only: settings, secrets, pinned checkout, files, ports. Changes nothing.
#   ./jitsi.sh up         preflight, then start (or update) every container in the background
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

die() { echo "jitsi.sh: $*" >&2; exit 1; }
envget() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }
compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f "$UPSTREAM/docker-compose.yml" -f "$UPSTREAM/whiteboard.yml" -f "$HERE/compose.override.yml" "$@"
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
  [ "$(envget HTTPS_PORT)" = "127.0.0.1:8443" ] || die "HTTPS_PORT must stay 127.0.0.1:8443 (loopback only)"
  [ "$(envget ENABLE_GUESTS)" = "0" ] && [ "$(envget AUTH_TYPE)" = "jwt" ] || die "token auth must be on and guests off"
  # The meeting page may be framed only by the listed EduLabs origins: exact https origins, host only, separated by single spaces.
  local csp csp_re='^frame-ancestors( https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)+$'
  csp=$(envget CSP_HEADER)
  [[ $csp =~ $csp_re ]] || die "CSP_HEADER must be 'frame-ancestors' and then one or more EduLabs origins like https://staging.edulabs-eg.com, separated by single spaces"
  local cfg; cfg=$(envget CONFIG)
  for d in "$cfg/web" "$cfg/storage/prosody" "$cfg/storage/web" "$cfg/storage/transcripts" "$cfg/tmp/web-crontabs" "$cfg/tmp/web-load-test"; do
    [ -d "$d" ] || die "$d is missing (runbook step 5)"
  done
  [ -f "$cfg/web/custom-config.js" ] && [ -f "$cfg/web/custom-interface_config.js" ] || die "custom web config not installed (runbook step 5)"
  [ -f "$TURN_DIR/turnserver.conf" ] || die "$TURN_DIR/turnserver.conf is missing (run render-turn.sh)"
  [ -f "$TURN_DIR/turn-certs/fullchain.pem" ] && [ -f "$TURN_DIR/turn-certs/privkey.pem" ] || die "TURN certificate missing (runbook step 7)"
  # Public TCP 443 must be free for coturn (or already be coturn). Caddy must be on loopback only.
  local holder; holder=$(ss -Hltnp 'sport = :443' | grep -v '127.0.0.1:443' | grep -v '\[::1\]:443' || true)
  if [ -n "$holder" ] && ! grep -q turnserver <<<"$holder"; then die "something else listens on public TCP 443: $holder"; fi
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
  check) preflight; compose config --quiet; check_ports; published_ports; echo "OK: preflight passed for $PINNED" ;;
  up) preflight; compose config --quiet; check_ports; compose up -d --remove-orphans; compose ps ;;
  ports) published_ports ;;
  down) compose down ;;
  restart) shift; compose restart "$@" ;;
  ps) compose ps ;;
  pull) preflight; compose pull ;;
  config) compose config ;;
  logs) shift; compose logs --tail 200 "$@" ;;
  health)
    ok=0
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/) ; echo "web      http://127.0.0.1:8000/            -> $code"; [ "$code" = 200 ] || ok=1
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/about/health) ; echo "bridge   http://127.0.0.1:8080/about/health -> $code"; [ "$code" = 200 ] || ok=1
    code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8888/about/health) ; echo "focus    http://127.0.0.1:8888/about/health -> $code"; [ "$code" = 200 ] || ok=1
    ip=$(envget PUBLIC_IP); host=$(envget TURN_HOST)
    if ss -Hlunp 'sport = :3478' | grep -q turnserver; then echo "turn     udp $ip:3478 listening"; else echo "turn     udp 3478 NOT listening"; ok=1; fi
    if echo | timeout 5 openssl s_client -connect "$ip:443" -servername "$host" 2>/dev/null | openssl x509 -noout -subject -enddate; then :; else echo "turns    tls $ip:443 NOT answering"; ok=1; fi
    exit $ok ;;
  stats)
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' $(compose ps -q) $(docker ps -q --filter name=edulabs) 2>/dev/null || true
    echo; echo "bridge:"; curl -s http://127.0.0.1:8080/colibri/stats | python3 -c 'import json,sys; s=json.load(sys.stdin); [print(f"  {k}: {s.get(k)}") for k in ("conferences","participants","endpoints_sending_audio","endpoints_sending_video","bit_rate_download","bit_rate_upload","packet_rate_download","packet_rate_upload","stress_level")]' || echo "  (colibri stats unavailable)" ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
