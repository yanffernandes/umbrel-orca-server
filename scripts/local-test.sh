#!/usr/bin/env bash
# Builds the image and runs it the way umbrelOS would, so the app can be tried
# before publishing. Status page: http://localhost:16769 (password below).
#
# The host ports differ from Umbrel's (6768/6769) because Orca Desktop itself listens
# on 6768 on the machine it runs on.
set -euo pipefail

cd "$(dirname "$0")/.."

name=orca-umbrel-local
image=umbrel-orca-server:local
password=${ORCA_UMBREL_PASSWORD:-local-test-password}
orca_port=${ORCA_PORT:-16768}
page_port=${PAGE_PORT:-16769}

# Without the buildx plugin, `docker build` needs the classic builder.
if ! docker buildx version >/dev/null 2>&1; then
  export DOCKER_BUILDKIT=0
fi
docker build -t "$image" image

docker rm -f "$name" >/dev/null 2>&1 || true
docker volume create "$name-home" >/dev/null
docker run -d --name "$name" \
  --user 1000:1000 \
  --hostname orca-local \
  -p "$orca_port:6768" \
  -p "$page_port:8080" \
  -v "$name-home:/home/orca" \
  -e ORCA_PAIRING_HOST=localhost \
  -e ORCA_PUBLIC_PORT="$orca_port" \
  -e ORCA_UMBREL_PASSWORD="$password" \
  "$image" >/dev/null

echo "Status page: http://localhost:$page_port  (password: $password)"
echo "Logs:        docker logs -f $name"
echo "Remove:      docker rm -f $name && docker volume rm $name-home"
