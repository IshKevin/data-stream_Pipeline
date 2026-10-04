# syntax=docker/dockerfile:1
# Build context is the REPOSITORY ROOT (see docker-compose.yml) so the sample data in seed/ can be baked in.

# ---- builder: resolve and install locked dependencies with uv --------------------------
FROM python:3.14-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_HTTP_TIMEOUT=300
RUN --mount=type=cache,id=data-stream_pipeline-pip,target=/root/.cache/pip,sharing=locked \
    pip install --default-timeout=120 --retries 10 uv==0.12.23
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN --mount=type=cache,id=data-stream_pipeline-uv,target=/root/.cache/uv,sharing=locked \
    uv sync --frozen --no-dev --no-install-project

# ---- test: runtime deps + dev tools (pytest, ruff, mypy); used by `make test` and CI -----
FROM builder AS test
RUN --mount=type=cache,id=data-stream_pipeline-uv,target=/root/.cache/uv,sharing=locked \
    uv sync --frozen --no-install-project
ENV PATH="/opt/venv/bin:$PATH" PYTHONPATH=/app
COPY api/ ./
# the import tests run against the real messy sample file
COPY seed /seed

# ---- runtime: small final image, non-root ---------------------------------------------------
FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app
# Fixed numeric ids: COPY --link cannot resolve --chown by *name* (it ignores earlier layers)
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --no-create-home app
COPY --link --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --link --chown=10001:10001 api/alembic.ini ./
COPY --link --chown=10001:10001 api/alembic ./alembic
COPY --link --chown=10001:10001 api/app ./app
COPY --link --chown=10001:10001 api/bootstrap.sh ./bootstrap.sh
COPY --link --chown=10001:10001 seed /seed
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers"]
