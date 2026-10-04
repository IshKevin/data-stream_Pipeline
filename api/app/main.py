import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.errors import DomainError
from app.logging_config import AccessLogMiddleware, configure_logging
from app.routers import analytics, auth, episodes, events, requests, users

log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(get_settings().log_level)
    log.info("api starting")
    yield
    log.info("api stopping")


def create_app() -> FastAPI:
    app = FastAPI(
        title="data-stream_Pipeline",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(AccessLogMiddleware)

    @app.exception_handler(DomainError)
    async def domain_error_handler(_: Request, exc: DomainError):
        body: dict = {"detail": exc.message, "code": exc.code}
        if exc.details:
            body["errors"] = exc.details
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error", extra={"path": request.url.path})
        return JSONResponse(
            status_code=500, content={"detail": "Internal server error", "code": "internal_error"}
        )

    for module in (auth, users, requests, episodes, analytics, events):
        app.include_router(module.router, prefix="/api")

    @app.get("/health", tags=["ops"])
    def health():
        """Liveness: the process is up. Deliberately does not touch the database."""
        return {"status": "ok"}

    @app.get("/ready", tags=["ops"])
    def ready():
        """Readiness: the database answers."""
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            log.exception("readiness check failed")
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ready"}

    return app


app = create_app()
