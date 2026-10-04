# syntax=docker/dockerfile:1
#
# All-in-one image for single-container hosts such as Render: the FastAPI app also serves the
# built React app (WEB_DIST_DIR). For local development use docker-compose.yml, which runs
# api/ and web/ (nginx) as separate containers instead. Build context: the repository root.

# ---- 1. build the web app ---------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY web/ ./
RUN npm run build

# ---- 2. install locked Python dependencies ---------------------------------------------------
FROM python:3.12-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_HTTP_TIMEOUT=300
RUN pip install --no-cache-dir --default-timeout=120 --retries 10 uv==0.12.21
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ---- 3. runtime ----------------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app \
    WEB_DIST_DIR=/app/web-dist \
    SEED_USERS_FILE=/seed/users.json \
    SEED_EPISODES_FILE=/seed/episodes.csv
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --chown=app:app api/alembic.ini api/bootstrap.sh ./
COPY --chown=app:app api/alembic ./alembic
COPY --chown=app:app api/app ./app
COPY --from=web --chown=app:app /web/dist ./web-dist
COPY --chown=app:app seed /seed
USER app
EXPOSE 10000
# Migrations + (optional) demo seed run on every start; both are idempotent.
# $PORT is injected by the platform (Render uses 10000).
CMD ["sh", "-c", "sh bootstrap.sh && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --no-access-log --proxy-headers --forwarded-allow-ips='*'"]
