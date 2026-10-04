import json
import logging
import sys
import time
import uuid

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # We emit our own one-line-per-request access log (see AccessLogMiddleware).
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("uvicorn").handlers = []
    logging.getLogger("uvicorn.error").handlers = []


access_logger = logging.getLogger("app.access")


class AccessLogMiddleware:
    """Pure ASGI middleware: one structured log line per HTTP request.

    Written as raw ASGI (not BaseHTTPMiddleware) so streaming responses (SSE) work.
    The authenticated user id is read from the shared per-request ``scope["state"]``,
    which the auth dependency fills in.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        request_id = (
            next((v.decode() for k, v in scope["headers"] if k == b"x-request-id"), None)
            or uuid.uuid4().hex[:16]
        )
        state["request_id"] = request_id
        started = time.perf_counter()
        status = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                message.setdefault("headers", []).append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            access_logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status["code"],
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    "user_id": state.get("user_id"),
                },
            )
