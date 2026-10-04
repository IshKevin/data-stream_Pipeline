# syntax=docker/dockerfile:1
# Build context is the REPOSITORY ROOT (see docker-compose.yml) so the sample data in seed/ can be baked in.

# ---- builder: resolve and install locked dependencies with uv --------------------------
FROM python:3.14-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_HTTP_TIMEOUT=300
RUN pip install --no-cache-dir --default-timeout=120 --retries 10 uv==0.12.23
WORKDIR /app
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ---- test: runtime deps + dev tools (pytest, ruff, mypy); used by `make test` and CI -----
FROM builder AS test
RUN uv sync --frozen --no-install-project
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
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY --chown=app:app api/alembic.ini ./
COPY --chown=app:app api/alembic ./alembic
COPY --chown=app:app api/app ./app
COPY --chown=app:app api/bootstrap.sh ./bootstrap.sh
COPY --chown=app:app seed /seed
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers"]
