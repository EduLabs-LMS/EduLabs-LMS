#!/usr/bin/env bash
# Writes /etc/edulabs/jitsi/turnserver.conf from turnserver.conf.template and /etc/edulabs/jitsi.env.
# Run as root after any change to PUBLIC_IP, TURN_HOST or TURN_CREDENTIALS, then: ./jitsi.sh restart coturn
set -euo pipefail
ENV_FILE=${JITSI_ENV_FILE:-/etc/edulabs/jitsi.env}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT_DIR=/etc/edulabs/jitsi
die() { echo "render-turn.sh: $*" >&2; exit 1; }
envget() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }

[ "$(id -u)" = 0 ] || die "run as root"
ip=$(envget PUBLIC_IP); host=$(envget TURN_HOST); secret=$(envget TURN_CREDENTIALS)
[[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "PUBLIC_IP is not an IPv4 address"
[[ "$host" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && "$host" == *.* ]] || die "TURN_HOST is not a hostname"
[[ "$secret" =~ ^[A-Fa-f0-9]{64,}$ ]] || die "TURN_CREDENTIALS must be 64+ hex characters (runbook step 4)"

install -d -m 0750 -o root -g 65534 "$OUT_DIR" "$OUT_DIR/turn-certs"
umask 027
tmp=$(mktemp "$OUT_DIR/.turnserver.XXXXXX")
sed -e "s/__PUBLIC_IP__/$ip/g" -e "s/__TURN_HOST__/$host/g" -e "s/__TURN_SECRET__/$secret/g" "$HERE/turnserver.conf.template" > "$tmp"
! grep -q '__[A-Z_]*__' "$tmp" || { rm -f "$tmp"; die "a placeholder was left unreplaced"; }
chown root:65534 "$tmp"; chmod 0640 "$tmp"
mv "$tmp" "$OUT_DIR/turnserver.conf"
echo "wrote $OUT_DIR/turnserver.conf (root:65534 0640)"
