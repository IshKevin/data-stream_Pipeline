#!/bin/sh
# One-shot job run by `docker compose up` before the API starts.
# Idempotent: safe to run on every start.
set -eu

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- preflight: fail early with a readable message instead of a stack trace ----------------
[ -n "${JWT_SECRET:-}" ] || fail "JWT_SECRET is not set (use at least 32 random characters, e.g. 'openssl rand -hex 32')"
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET is too short: ${#JWT_SECRET} characters, need at least 32"
if [ -z "${DATABASE_URL:-}" ]; then
  [ -n "${POSTGRES_PASSWORD:-}" ] || fail "POSTGRES_PASSWORD is not set"
  echo "==> database: ${POSTGRES_USER:-desk}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-desk}"
fi

python -m app.cli wait-db --timeout "${DB_WAIT_SECONDS:-60}"

echo "==> applying migrations"
alembic upgrade head

if [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  users="${SEED_USERS_FILE:-/seed/users.json}"
  episodes="${SEED_EPISODES_FILE:-/seed/episodes.csv}"
  [ -f "$users" ] || fail "seed users file not found: $users (set SEED_DEMO_DATA=false to skip seeding)"
  [ -f "$episodes" ] || fail "seed episodes file not found: $episodes (set SEED_DEMO_DATA=false to skip seeding)"
  echo "==> seeding demo users"
  python -m app.cli seed-users --file "$users"
  echo "==> importing sample episodes"
  python -m app.cli import-episodes "$episodes"
else
  echo "==> SEED_DEMO_DATA=false: skipping demo users and sample episodes"
fi
echo "==> bootstrap complete"
