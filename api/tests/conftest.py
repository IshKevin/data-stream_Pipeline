"""Test harness: real PostgreSQL (the rules depend on constraints, row locks and SQL analytics),
a dedicated ``*_test`` database that is migrated with Alembic once per session and
truncated between tests."""

import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

API_DIR = Path(__file__).resolve().parent.parent
SEED_DIR = API_DIR.parent / "seed"

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-0123456789")

from app.config import build_database_url  # noqa: E402  (import-light: no settings needed)

_server_url = make_url(os.environ.get("TEST_DATABASE_URL") or build_database_url())
_db_name = _server_url.database or "data-stream_pipeline"
if not _db_name.endswith("_test"):
    _db_name += "_test"
_test_url = _server_url.set(database=_db_name)
# Must be set before `app` is imported anywhere.
os.environ["DATABASE_URL"] = _test_url.render_as_string(hide_password=False)

from app.db import get_engine, session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Assignment, Episode, Request, RequestStatusHistory, User  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402

PASSWORD = "correct-horse-battery"
_PASSWORD_HASH = hash_password(PASSWORD)  # hashing is slow on purpose: do it once


@pytest.fixture(scope="session", autouse=True)
def _database():
    assert _test_url.database.endswith("_test"), "refusing to run tests on a non-test database"
    admin = create_engine(_server_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": _db_name}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{_db_name}"'))
    admin.dispose()

    from alembic.config import Config

    from alembic import command

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(cfg, "head")
    yield
    get_engine().dispose()


@pytest.fixture(autouse=True)
def _clean_tables(_database):
    with get_engine().begin() as conn:
        conn.execute(
            text(
                "TRUNCATE assignments, request_status_history, requests, episodes, users "
                "RESTART IDENTITY CASCADE"
            )
        )


@pytest.fixture
def db():
    with session_factory()() as session:
        yield session


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    return TestClient(app, raise_server_exceptions=True)


# ---- factories ---------------------------------------------------------------------------
class Factory:
    def __init__(self, db):
        self.db = db
        self._n = 0

    def user(self, role="client", email=None, **kw) -> User:
        self._n += 1
        u = User(
            email=email or f"{role}{self._n}@example.com",
            name=kw.pop("name", f"{role.title()} {self._n}"),
            organisation=kw.pop("organisation", f"Org {self._n}" if role == "client" else None),
            password_hash=_PASSWORD_HASH,
            role=role,
            **kw,
        )
        self.db.add(u)
        self.db.commit()
        return u

    def episode(
        self, quality="good", task="pick cup", robot="arm-01", recorded_at=None, **kw
    ) -> Episode:
        self._n += 1
        e = Episode(
            episode_id=kw.pop("episode_id", f"EP-{self._n:05d}"),
            robot_id=robot,
            task_name=task,
            recorded_at=recorded_at or datetime(2026, 9, 1, 12, 0, tzinfo=UTC),
            duration_seconds=kw.pop("duration_seconds", 30),
            operator_name=kw.pop("operator_name", "Aline"),
            quality=quality,
        )
        self.db.add(e)
        self.db.commit()
        return e

    def request(self, client: User, status="submitted", task="pick cup", count=2, **kw) -> Request:
        r = Request(
            client_id=client.id,
            task_name=task,
            episodes_requested=count,
            deadline=kw.pop("deadline", date.today() + timedelta(days=30)),
            notes=kw.pop("notes", None),
            status=status,
        )
        self.db.add(r)
        self.db.flush()
        self.db.add(
            RequestStatusHistory(
                request_id=r.id, from_status=None, to_status="submitted", changed_by=client.id
            )
        )
        self.db.commit()
        return r

    def assign(self, request: Request, episode: Episode, by: User) -> Assignment:
        a = Assignment(request_id=request.id, episode_pk=episode.id, assigned_by=by.id)
        self.db.add(a)
        self.db.commit()
        return a


@pytest.fixture
def make(db) -> Factory:
    return Factory(db)


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}
