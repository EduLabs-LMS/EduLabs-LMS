#!/usr/bin/env bash
# certbot --deploy-hook for the TURN hostname's certificate. certbot runs it (as root) after the first issue and after
# every renewal; it copies the new files where coturn reads them and restarts only coturn (a class in progress keeps
# its UDP media; phones on TURN-over-TLS reconnect within seconds).
set -euo pipefail
: "${RENEWED_LINEAGE:?certbot sets RENEWED_LINEAGE}"
DEST=/etc/edulabs/jitsi/turn-certs
install -d -m 0750 -o root -g 65534 "$DEST"
install -m 0640 -o root -g 65534 "$RENEWED_LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
install -m 0640 -o root -g 65534 "$RENEWED_LINEAGE/privkey.pem" "$DEST/privkey.pem"
ids=$(docker ps -q --filter label=com.docker.compose.project=edulabs-jitsi --filter label=com.docker.compose.service=coturn)
if [ -n "$ids" ]; then docker restart $ids >/dev/null; echo "coturn restarted with the renewed certificate"; fi
