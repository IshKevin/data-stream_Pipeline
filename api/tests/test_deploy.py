"""Single-container deployment support (Render): DB URL normalisation and serving the web app."""

import pytest
from fastapi.testclient import TestClient

from app.config import normalize_database_url
from app.main import create_app


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
        (
            "postgresql://u:p@host/db?sslmode=require",
            "postgresql+psycopg://u:p@host/db?sslmode=require",
        ),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
    ],
)
def test_platform_database_urls_are_normalised(given, expected):
    assert normalize_database_url(given) == expected


@pytest.fixture
def spa(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html><title>app</title></html>")
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log(1)")
    return TestClient(create_app(web_dist_dir=tmp_path))


def test_spa_serves_index_assets_and_client_side_routes(spa):
    index = spa.get("/")
    assert index.status_code == 200 and "<title>app</title>" in index.text
    assert index.headers["cache-control"] == "no-cache"
    assert index.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in index.headers["content-security-policy"]

    deep_link = spa.get("/requests/42")  # React Router path: must fall back to index.html
    assert deep_link.status_code == 200 and "<title>app</title>" in deep_link.text

    asset = spa.get("/assets/app-abc123.js")
    assert asset.status_code == 200
    assert "immutable" in asset.headers["cache-control"]


def test_api_and_health_routes_still_win_over_the_spa(spa):
    assert spa.get("/health").json() == {"status": "ok"}
    assert spa.get("/api/auth/me").status_code == 401  # real API route, JSON
    unknown = spa.get("/api/does-not-exist")
    assert unknown.status_code == 404
    assert "<html" not in unknown.text  # a JSON/plain 404, never the SPA shell


def test_without_a_dist_dir_nothing_is_mounted():
    assert TestClient(create_app()).get("/").status_code == 404
