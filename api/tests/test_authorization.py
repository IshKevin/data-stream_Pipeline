"""Authorization is enforced on the server: every endpoint, every role."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from tests.conftest import PASSWORD, auth

PROTECTED = [
    ("GET", "/api/auth/me"),
    ("GET", "/api/requests"),
    ("POST", "/api/requests"),
    ("GET", "/api/requests/1"),
    ("POST", "/api/requests/1/transition"),
    ("POST", "/api/requests/1/assignments"),
    ("DELETE", "/api/requests/1/assignments/1"),
    ("GET", "/api/episodes"),
    ("GET", "/api/episodes/facets"),
    ("POST", "/api/episodes/import"),
    ("GET", "/api/analytics"),
    ("GET", "/api/users"),
    ("POST", "/api/users"),
    ("PATCH", "/api/users/1"),
    ("GET", "/api/events"),
]


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_every_protected_endpoint_requires_authentication(client, method, path):
    assert client.request(method, path).status_code == 401


def test_garbage_and_expired_and_wrongly_signed_tokens_are_rejected(client, make):
    user = make.user("operator")
    now = datetime.now(UTC)
    expired = jwt.encode(
        {"sub": str(user.id), "exp": now - timedelta(minutes=1)},
        "test-secret-test-secret-test-secret-0123456789",
        "HS256",
    )
    forged = jwt.encode({"sub": str(user.id), "exp": now + timedelta(hours=1)}, "x" * 40, "HS256")
    unsigned = jwt.encode(
        {"sub": str(user.id), "exp": now + timedelta(hours=1)}, None, algorithm="none"
    )
    for token in ("garbage", expired, forged, unsigned):
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401, token


def test_deactivated_user_loses_access_immediately(client, make, db):
    user = make.user("operator")
    headers = auth(user)
    assert client.get("/api/requests", headers=headers).status_code == 200
    user.is_active = False
    db.commit()
    assert client.get("/api/requests", headers=headers).status_code == 401


def test_role_change_takes_effect_on_existing_tokens(client, make, db):
    user = make.user("operator")
    headers = auth(user)
    assert client.get("/api/episodes", headers=headers).status_code == 200
    user.role = "client"
    db.commit()
    assert client.get("/api/episodes", headers=headers).status_code == 403


# ---- role matrix ---------------------------------------------------------------------------
STAFF_ONLY = [
    ("GET", "/api/episodes", None),
    ("GET", "/api/episodes/facets", None),
    ("GET", "/api/analytics", None),
    ("POST", "/api/requests/1/assignments", {"episode_ids": [1]}),
    ("DELETE", "/api/requests/1/assignments/1", None),
]


@pytest.mark.parametrize(("method", "path", "body"), STAFF_ONLY)
def test_clients_cannot_use_staff_endpoints(client, make, method, path, body):
    c = make.user("client")
    make.request(c)
    r = client.request(method, path, headers=auth(c), json=body)
    assert r.status_code == 403


def test_clients_cannot_import_episodes(client, make):
    c = make.user("client")
    r = client.post(
        "/api/episodes/import", headers=auth(c), files={"file": ("e.csv", b"x", "text/csv")}
    )
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["client", "operator"])
def test_only_admins_manage_users(client, make, role):
    actor = make.user(role)
    target = make.user("client")
    h = auth(actor)
    assert client.get("/api/users", headers=h).status_code == 403
    body = {"email": "new@example.com", "name": "N", "password": "longenough1", "role": "client"}
    assert client.post("/api/users", headers=h, json=body).status_code == 403
    assert (
        client.patch(f"/api/users/{target.id}", headers=h, json={"role": "admin"}).status_code
        == 403
    )


def test_admin_can_create_deactivate_and_change_roles(client, make):
    admin = make.user("admin")
    h = auth(admin)
    body = {
        "email": "New@Example.com",
        "name": "Neo",
        "password": "longenough1",
        "role": "operator",
    }
    created = client.post("/api/users", headers=h, json=body)
    assert created.status_code == 201
    assert created.json()["email"] == "new@example.com"  # normalised
    assert "password" not in created.text and "hash" not in created.text
    uid = created.json()["id"]

    # the new user can log in, then gets deactivated and cannot
    assert (
        client.post(
            "/api/auth/login", json={"email": "new@example.com", "password": "longenough1"}
        ).status_code
        == 200
    )
    assert (
        client.patch(f"/api/users/{uid}", headers=h, json={"is_active": False}).json()["is_active"]
        is False
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": "new@example.com", "password": "longenough1"}
        ).status_code
        == 401
    )

    assert (
        client.patch(f"/api/users/{uid}", headers=h, json={"role": "admin"}).json()["role"]
        == "admin"
    )
    dup = client.post("/api/users", headers=h, json={**body, "email": "NEW@example.com"})
    assert dup.status_code == 409


def test_admin_cannot_lock_themselves_out(client, make):
    admin = make.user("admin")
    h = auth(admin)
    assert (
        client.patch(f"/api/users/{admin.id}", headers=h, json={"is_active": False}).status_code
        == 409
    )
    assert (
        client.patch(f"/api/users/{admin.id}", headers=h, json={"role": "client"}).status_code
        == 409
    )


def test_weak_passwords_rejected_on_user_creation(client, make):
    admin = make.user("admin")
    body = {"email": "a@example.com", "name": "A", "password": "short", "role": "client"}
    assert client.post("/api/users", headers=auth(admin), json=body).status_code == 422


# ---- data isolation between clients -----------------------------------------------------------
def test_client_only_sees_their_own_requests(client, make):
    a, b = make.user("client"), make.user("client")
    ra, rb = make.request(a), make.request(b)
    listing = client.get("/api/requests", headers=auth(a)).json()
    assert [r["id"] for r in listing["items"]] == [ra.id]
    assert listing["total"] == 1
    # trying to widen the list with a filter must not work either
    filtered = client.get(f"/api/requests?client_id={b.id}", headers=auth(a)).json()
    assert [r["id"] for r in filtered["items"]] == [ra.id]
    assert rb.id not in [r["id"] for r in filtered["items"]]


def test_client_gets_404_for_other_clients_request(client, make):
    a, b = make.user("client"), make.user("client")
    rb = make.request(b, status="delivered")
    h = auth(a)
    assert client.get(f"/api/requests/{rb.id}", headers=h).status_code == 404
    assert (
        client.post(
            f"/api/requests/{rb.id}/transition", headers=h, json={"to": "accepted"}
        ).status_code
        == 404
    )
    # 404 (not 403) so the existence of other clients' ids is not revealed
    assert client.get("/api/requests/99999", headers=h).status_code == 404


def test_staff_see_all_requests(client, make):
    a, b = make.user("client"), make.user("client")
    make.request(a)
    make.request(b)
    for role in ("operator", "admin"):
        staff = make.user(role)
        assert client.get("/api/requests", headers=auth(staff)).json()["total"] == 2


def test_only_clients_create_requests(client, make):
    body = {"task_name": "pick cup", "episodes_requested": 5, "deadline": "2099-01-01"}
    for role in ("operator", "admin"):
        assert (
            client.post("/api/requests", headers=auth(make.user(role)), json=body).status_code
            == 403
        )
    assert (
        client.post("/api/requests", headers=auth(make.user("client")), json=body).status_code
        == 201
    )


# ---- login -----------------------------------------------------------------------------------
def test_login_success_and_uniform_failure(client, make):
    user = make.user("client", email="Someone@Example.com")
    ok = client.post("/api/auth/login", json={"email": "someone@example.com", "password": PASSWORD})
    assert ok.status_code == 200
    assert ok.json()["user"]["id"] == user.id
    assert "password_hash" not in ok.text

    wrong_pw = client.post(
        "/api/auth/login", json={"email": "someone@example.com", "password": "nope"}
    )
    unknown = client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": "nope"}
    )
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json()  # does not reveal which emails exist


def test_inactive_user_cannot_log_in(client, make):
    make.user("client", email="off@example.com", is_active=False)
    r = client.post("/api/auth/login", json={"email": "off@example.com", "password": PASSWORD})
    assert r.status_code == 401
