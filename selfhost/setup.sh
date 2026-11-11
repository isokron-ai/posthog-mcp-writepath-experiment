#!/bin/bash
# Prepare this directory as a local PostHog open-source instance at the pinned commit, the way IsoKron's benchmark
# instance was laid out. Starts nothing: run ./phs up -d --no-build afterwards (see README.md).
#   1. fetch PostHog's hobby deployment files at the pin into ./posthog (sparse, blobless; PostHog's own MIT files)
#   2. copy the two compose files and .env.services into place, as PostHog's bin/deploy-hobby does
#   3. create the empty ./docker/postgres-init-scripts and ./products folders the base compose file mounts
#      (they were empty in the measured instance too: the hobby layout leaves them empty)
#   4. write an empty GeoLite2 database (local/make-empty-geoip.py; no download from PostHog's CDN)
#   5. generate .secrets/instance.env with fresh random secrets (mode 600; never overwritten)
# Requires git, python3 and openssl.
set -euo pipefail
cd "$(dirname "$0")"
POSTHOG_REPO=https://github.com/PostHog/posthog.git
POSTHOG_SHA=7b516983bef16b9692a00a6b7780a6b5a802257c

if [ ! -d posthog/.git ]; then
  git init -q posthog
  git -C posthog remote add origin "$POSTHOG_REPO"
fi
git -C posthog sparse-checkout init --no-cone
git -C posthog sparse-checkout set '/LICENSE' '/docker-compose.hobby.yml' '/docker-compose.base.yml' '/.env.services' \
  '/bin/deploy-hobby' '/bin/upgrade-hobby' '/docker/' '/posthog/idl/' '/posthog/user_scripts/'
git -C posthog fetch -q --depth 1 --filter=blob:none origin "$POSTHOG_SHA"
git -C posthog checkout -q --detach FETCH_HEAD
[ "$(git -C posthog rev-parse HEAD)" = "$POSTHOG_SHA" ] || { echo "posthog/ is not at $POSTHOG_SHA" >&2; exit 2; }

cp posthog/docker-compose.hobby.yml docker-compose.yml
cp posthog/docker-compose.base.yml docker-compose.base.yml
cp posthog/.env.services .env.services
mkdir -p docker/postgres-init-scripts products
python3 -I -B local/make-empty-geoip.py

umask 077
mkdir -p .secrets
if [ -e .secrets/instance.env ]; then
  echo ".secrets/instance.env exists: kept as it is"
else
  # The variables bin/deploy-hobby writes to .env at this pin, with DOMAIN set to the loopback site. The secret values
  # are random and stay on this machine. (The measured instance's own file was not published: it holds its secrets.)
  {
    echo "POSTHOG_SECRET=$(openssl rand -hex 28)"
    echo "ENCRYPTION_SALT_KEYS=$(openssl rand -hex 16)"
    echo "BROWSERLESS_SECRET=$(openssl rand -hex 32)"
    echo "RECORDING_API_JWT_SECRET=$(openssl rand -hex 32)"
    echo "DOMAIN=127.0.0.1:8010"
    echo "TLS_BLOCK="
    echo "CADDY_TLS_BLOCK=auto_https off"
    echo "REGISTRY_URL=posthog/posthog"
    echo "POSTHOG_APP_TAG=$POSTHOG_SHA"
  } > .secrets/instance.env
  echo "wrote .secrets/instance.env (mode 600)"
fi
echo "ready: ./phs pull, then ./phs up -d --no-build; then python3 -I -B local/create-account.py"
