#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-foms-vps}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

die() {
  printf 'Deployment error: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "Docker is required."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Run this script from a Git checkout."

CURRENT_BRANCH="$(git -C "$APP_DIR" branch --show-current)"
[[ "$CURRENT_BRANCH" == "$DEPLOY_BRANCH" ]] || die "Checkout branch '$DEPLOY_BRANCH' before deploying (currently '$CURRENT_BRANCH')."

git -C "$APP_DIR" diff --quiet && git -C "$APP_DIR" diff --cached --quiet || die "Commit or stash tracked changes before deploying."
git -C "$APP_DIR" pull --ff-only origin "$DEPLOY_BRANCH"

if [[ ! -f "$ENV_FILE" ]]; then
  command -v openssl >/dev/null 2>&1 || die "openssl is required to create deployment secrets."
  umask 077
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'JWT_ACCESS_SECRET=%s\n' "$(openssl rand -hex 48)"
    printf 'COOKIE_SECURE=true\n'
    printf 'FOMS_BIND_ADDRESS=127.0.0.1\n'
    printf 'FOMS_PORT=3003\n'
  } > "$ENV_FILE"
  printf 'Created %s with generated secrets and loopback-only port 3003.\n' "$ENV_FILE"
  printf 'Configure HTTPS reverse-proxy routing to http://127.0.0.1:3003 before user sign-in.\n'
fi

grep -Eq '^POSTGRES_PASSWORD=.{32,}$' "$ENV_FILE" || die ".env must contain a POSTGRES_PASSWORD of at least 32 characters."
grep -Eq '^JWT_ACCESS_SECRET=.{32,}$' "$ENV_FILE" || die ".env must contain a JWT_ACCESS_SECRET of at least 32 characters."
grep -qx 'COOKIE_SECURE=true' "$ENV_FILE" || die "Set COOKIE_SECURE=true in .env; FOMS requires HTTPS termination in production."
grep -qx 'FOMS_BIND_ADDRESS=127.0.0.1' "$ENV_FILE" || die "FOMS_BIND_ADDRESS must remain 127.0.0.1 to avoid exposing the app without the reverse proxy."
FOMS_PORT="$(sed -n 's/^FOMS_PORT=//p' "$ENV_FILE")"
[[ "$FOMS_PORT" =~ ^[0-9]{1,5}$ ]] || die ".env must contain a numeric FOMS_PORT."
(( 10#$FOMS_PORT >= 1 && 10#$FOMS_PORT <= 65535 )) || die "FOMS_PORT must be between 1 and 65535."

COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$APP_DIR/compose.yaml")

printf 'Starting the FOMS database...\n'
"${COMPOSE[@]}" up -d db

printf 'Building FOMS images...\n'
"${COMPOSE[@]}" build app migrate

printf 'Applying database migrations...\n'
"${COMPOSE[@]}" run --rm migrate

printf 'Starting/updating the FOMS app...\n'
"${COMPOSE[@]}" up -d --no-deps --force-recreate --wait app

printf '\nFOMS deployment is healthy.\n'
"${COMPOSE[@]}" ps
printf '\nReverse-proxy upstream: http://127.0.0.1:%s\n' "$FOMS_PORT"
