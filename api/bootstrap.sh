#!/bin/sh
# One-shot job run by `docker compose up` before the API starts.
# Idempotent: safe to run on every start.
set -eu

echo "==> applying migrations"
alembic upgrade head

if [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  echo "==> seeding demo users"
  python -m app.cli seed-users --file "${SEED_USERS_FILE:-/seed/users.json}"
  echo "==> importing sample episodes"
  python -m app.cli import-episodes "${SEED_EPISODES_FILE:-/seed/episodes.csv}"
fi
echo "==> bootstrap complete"
