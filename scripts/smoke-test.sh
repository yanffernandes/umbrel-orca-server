#!/usr/bin/env bash
# Starts an image and checks that Orca comes up and the status page hands out an
# access link. Usage: scripts/smoke-test.sh <image>
set -euo pipefail

image=${1:?usage: smoke-test.sh <image>}
name=orca-umbrel-smoke-$$
password=smoke-test-password
timeout_seconds=${SMOKE_TIMEOUT_SECONDS:-300}

cleanup() {
  status=$?
  if ((status != 0)); then
    echo "--- container logs ---" >&2
    docker logs "$name" >&2 2>&1 || true
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$name-home" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker volume create "$name-home" >/dev/null
docker run -d --name "$name" \
  --user 1000:1000 \
  -p 127.0.0.1::8080 \
  -v "$name-home:/home/orca" \
  -e ORCA_PAIRING_HOST=orca.test \
  -e ORCA_UMBREL_PASSWORD="$password" \
  "$image" >/dev/null

# Docker picks a free host port, so this runs next to anything else.
page="http://$(docker port "$name" 8080/tcp | grep -m1 '^127\.0\.0\.1:')"
echo "waiting for Orca to start (up to ${timeout_seconds}s)..."
deadline=$((SECONDS + timeout_seconds))
until curl -fsS "$page/api/health" >/dev/null 2>&1; do
  if ((SECONDS > deadline)); then
    echo "FAIL: Orca did not become ready" >&2
    exit 1
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    echo "FAIL: container exited" >&2
    exit 1
  fi
  sleep 3
done
echo "ok: Orca is ready"

unauthorized=$(curl -s -o /dev/null -w '%{http_code}' "$page/api/status")
[ "$unauthorized" = 401 ] || { echo "FAIL: status API answered $unauthorized without a session" >&2; exit 1; }
echo "ok: status API requires the app password"

session=$(curl -fsS -X POST "$page/api/login" \
  -H 'X-Orca-Umbrel: 1' -H 'Content-Type: application/json' \
  -d "{\"password\":\"$password\"}" | jq -r .session)
status=$(curl -fsS "$page/api/status" -H "X-Orca-Umbrel-Session: $session")

jq -e '.server.state == "ready"' <<<"$status" >/dev/null || { echo "FAIL: server not ready" >&2; exit 1; }
jq -e '.pairing.link | startswith("orca://pair?code=")' <<<"$status" >/dev/null \
  || { echo "FAIL: no access link" >&2; exit 1; }
echo "ok: access link available (orcad $(jq -r .server.runtimeVersion <<<"$status"))"

link=$(curl -fsS -X POST "$page/api/pairing-link" \
  -H 'X-Orca-Umbrel: 1' -H "X-Orca-Umbrel-Session: $session" -H 'Content-Type: application/json' \
  -d '{"endpoint":"ws://100.64.1.20:6768"}' | jq -r .link)
endpoint=$(python3 -I -c 'import base64, json, sys; c = sys.argv[1].split("code=", 1)[1]; print(json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))["endpoint"])' "$link")
[ "$endpoint" = "ws://100.64.1.20:6768" ] || { echo "FAIL: link endpoint is $endpoint" >&2; exit 1; }
echo "ok: access link can target another address"

web=$(curl -s -o /dev/null -w '%{http_code}' "$page/web/web-index.html")
[ "$web" = 200 ] || { echo "FAIL: web client answered $web" >&2; exit 1; }
echo "ok: web client is served"

if docker logs "$name" 2>&1 | grep -q 'orca://pair?code=[A-Za-z0-9]'; then
  echo "FAIL: an access link was written to the container log" >&2
  exit 1
fi
echo "ok: logs contain no access links"
echo "smoke test passed"
