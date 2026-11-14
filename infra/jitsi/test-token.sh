#!/usr/bin/env bash
# Smoke test BEFORE EduLabs is wired up: prints a meeting address with a 10-minute token for a throwaway room.
#   ./test-token.sh moderator   -> open it on a laptop: you are the moderator (whiteboard, recording, mute others)
#   ./test-token.sh member      -> open it on a phone: you join muted, camera off, not a moderator
# The address contains a signed token: do not paste it into chats or tickets; it stops working after 10 minutes.
# The secret is read by python3 from the env file; it never appears in a command line or in the output.
set -euo pipefail
ENV_FILE=${JITSI_ENV_FILE:-/etc/edulabs/jitsi.env}
ROLE=${1:-moderator}
ROOM=${2:-edulabs-smoke-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')}
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[[ "$ROLE" == moderator || "$ROLE" == member ]] || { echo "role is moderator or member" >&2; exit 2; }
python3 -I - "$ENV_FILE" "$ROLE" "$ROOM" <<'PY'
import base64, hashlib, hmac, json, sys, time
env_file, role, room = sys.argv[1], sys.argv[2], sys.argv[3]
env = {}
for line in open(env_file, encoding="utf-8"):
    line = line.rstrip("\n")
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
now = int(time.time())
host = env["PUBLIC_URL"].split("://", 1)[1].rstrip("/")
claims = {"aud": env["JWT_ACCEPTED_AUDIENCES"].split(",")[0], "iss": env["JWT_APP_ID"], "sub": host, "room": room,
          "nbf": now - 30, "exp": now + 600,
          "context": {"user": {"name": "Smoke test (" + role + ")", "moderator": role == "moderator"}}}
head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
body = b64(json.dumps(claims, separators=(",", ":")).encode())
sig = b64(hmac.new(env["JWT_APP_SECRET"].encode(), (head + "." + body).encode(), hashlib.sha256).digest())
print(f"{env['PUBLIC_URL'].rstrip('/')}/{room}?jwt={head}.{body}.{sig}")
PY
