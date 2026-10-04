"""Operability: health endpoints, structured access logs, error handling, migrations."""

import json
import logging

from fastapi.testclient import TestClient

from app.logging_config import JsonFormatter
from app.main import create_app
from tests.conftest import API_DIR, auth


def test_health_and_ready(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json() == {"status": "ready"}


def test_ready_returns_503_when_database_is_down(monkeypatch):
    from app import main

    class Broken:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(main, "get_engine", lambda: Broken())
    r = TestClient(create_app()).get("/ready")
    assert r.status_code == 503
    assert TestClient(create_app()).get("/health").status_code == 200  # liveness unaffected


def test_one_structured_log_line_per_request_with_user_id(client, make, caplog):
    op = make.user("operator")
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get("/api/requests?limit=1", headers=auth(op))
        client.get("/api/requests")  # unauthenticated
        client.get("/health")
    lines = [r for r in caplog.records if r.name == "app.access"]
    assert len(lines) == 3
    authed, anon, health = lines
    assert (authed.method, authed.path, authed.status, authed.user_id) == (
        "GET",
        "/api/requests",
        200,
        op.id,
    )
    assert isinstance(authed.duration_ms, float) and authed.duration_ms >= 0
    assert (anon.status, anon.user_id) == (401, None)
    assert health.path == "/health" and health.user_id is None

    payload = json.loads(JsonFormatter().format(authed))
    assert {
        "ts",
        "level",
        "msg",
        "method",
        "path",
        "status",
        "duration_ms",
        "user_id",
        "request_id",
    } <= payload.keys()


def test_request_id_is_echoed_or_generated(client):
    assert (
        client.get("/health", headers={"X-Request-ID": "abc123"}).headers["x-request-id"]
        == "abc123"
    )
    assert len(client.get("/health").headers["x-request-id"]) >= 8


def test_unhandled_errors_return_json_500_and_are_logged(caplog):
    app = create_app()

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internals")

    with caplog.at_level(logging.INFO):
        r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error", "code": "internal_error"}
    assert "secret internals" not in r.text  # no leaking of internals
    assert any(rec.name == "app.access" and rec.status == 500 for rec in caplog.records)
    assert any(rec.exc_info for rec in caplog.records)


def test_migrations_roundtrip_and_match_models():
    """`alembic upgrade head` / `downgrade base` both work, and the models have no un-migrated changes."""
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    command.check(cfg)  # raises if autogenerate would produce a diff


def test_event_broker_only_delivers_what_each_subscriber_may_see():
    import asyncio

    from app.events import EventBroker

    async def scenario():
        broker = EventBroker()
        staff = broker.subscribe(user_id=1, is_staff=True)
        owner = broker.subscribe(user_id=2, is_staff=False)
        stranger = broker.subscribe(user_id=3, is_staff=False)
        await asyncio.get_running_loop().run_in_executor(
            None, lambda: broker.publish({"type": "request.created", "request_id": 9}, client_id=2)
        )
        await asyncio.sleep(0.05)
        return staff.queue.qsize(), owner.queue.qsize(), stranger.queue.qsize()

    assert asyncio.run(scenario()) == (1, 1, 0)
