"""Status workflow: valid moves, who may make them, and the audit trail."""

import pytest
from sqlalchemy import select

from app.models import RequestStatusHistory
from tests.conftest import auth

STATUSES = ["submitted", "in_progress", "delivered", "accepted", "rejected"]

# Written out by hand (not imported from app.workflow) so the test checks the spec,
# rather than the implementation agreeing with itself.
#   (from, to) -> who may do it
ALLOWED = {
    ("submitted", "in_progress"): {"operator", "admin"},
    ("in_progress", "delivered"): {"operator", "admin"},
    ("delivered", "accepted"): {"client"},
    ("delivered", "rejected"): {"client"},
    ("rejected", "in_progress"): {"operator", "admin"},
}


@pytest.mark.parametrize("role", ["client", "operator", "admin"])
@pytest.mark.parametrize("src", STATUSES)
@pytest.mark.parametrize("dst", STATUSES)
def test_transition_matrix(client, make, src, dst, role):
    owner = make.user("client")
    actor = owner if role == "client" else make.user(role)
    req = make.request(owner, status=src, count=1)
    # satisfy the "enough episodes" rule so only the workflow rule is under test
    make.assign(req, make.episode(), make.user("operator"))

    r = client.post(f"/api/requests/{req.id}/transition", headers=auth(actor), json={"to": dst})

    if (src, dst) not in ALLOWED:
        assert r.status_code == 409, f"{src}->{dst} should be an invalid transition"
    elif role not in ALLOWED[(src, dst)]:
        assert r.status_code == 403, f"{role} must not do {src}->{dst}"
    else:
        assert r.status_code == 200, r.text
        assert r.json()["status"] == dst


def test_full_lifecycle_records_who_and_when(client, make, db):
    c, op = make.user("client", name="Cathy"), make.user("operator", name="Olu")
    created = client.post(
        "/api/requests",
        headers=auth(c),
        json={"task_name": "  Pick   Cup ", "episodes_requested": 2, "deadline": "2099-01-01"},
    ).json()
    rid = created["id"]
    assert created["status"] == "submitted"
    assert created["task_name"] == "pick cup"  # normalised like episode task names

    eps = [make.episode(quality="good"), make.episode(quality="usable")]
    assert (
        client.post(
            f"/api/requests/{rid}/transition", headers=auth(op), json={"to": "in_progress"}
        ).status_code
        == 200
    )
    r = client.post(
        f"/api/requests/{rid}/assignments",
        headers=auth(op),
        json={"episode_ids": [e.id for e in eps]},
    )
    assert r.status_code == 200
    assert (
        client.post(
            f"/api/requests/{rid}/transition", headers=auth(op), json={"to": "delivered"}
        ).status_code
        == 200
    )
    final = client.post(
        f"/api/requests/{rid}/transition",
        headers=auth(c),
        json={"to": "accepted", "note": "thanks"},
    ).json()
    assert final["status"] == "accepted"

    rows = (
        db.execute(
            select(RequestStatusHistory)
            .where(RequestStatusHistory.request_id == rid)
            .order_by(RequestStatusHistory.id)
        )
        .scalars()
        .all()
    )
    assert [(h.from_status, h.to_status) for h in rows] == [
        (None, "submitted"),
        ("submitted", "in_progress"),
        ("in_progress", "delivered"),
        ("delivered", "accepted"),
    ]
    assert [h.changed_by for h in rows] == [c.id, op.id, op.id, c.id]
    assert all(h.changed_at is not None for h in rows)

    detail = client.get(f"/api/requests/{rid}", headers=auth(c)).json()
    assert [h["changed_by_name"] for h in detail["history"]] == ["Cathy", "Olu", "Olu", "Cathy"]
    assert detail["history"][-1]["note"] == "thanks"
    assert len(detail["episodes"]) == 2


def test_rejection_leads_to_rework_and_second_delivery(client, make, db):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c, status="delivered", count=1)
    make.assign(req, make.episode(), op)

    assert (
        client.post(
            f"/api/requests/{req.id}/transition",
            headers=auth(c),
            json={"to": "rejected", "note": "blurry"},
        ).status_code
        == 200
    )
    # nothing but rework is possible from rejected, and clients cannot restart it
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(c), json={"to": "in_progress"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "accepted"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "in_progress"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "delivered"}
        ).status_code
        == 200
    )

    history = (
        db.execute(
            select(RequestStatusHistory.to_status)
            .where(RequestStatusHistory.request_id == req.id)
            .order_by(RequestStatusHistory.id)
        )
        .scalars()
        .all()
    )
    assert history == ["submitted", "rejected", "in_progress", "delivered"]


def test_accepted_is_terminal(client, make):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c, status="accepted")
    for actor in (c, op):
        for dst in STATUSES:
            r = client.post(
                f"/api/requests/{req.id}/transition", headers=auth(actor), json={"to": dst}
            )
            assert r.status_code in (403, 409)
    assert (
        client.get(f"/api/requests/{req.id}", headers=auth(c)).json()["available_transitions"] == []
    )


def test_cannot_deliver_without_enough_assigned_episodes(client, make):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c, status="in_progress", count=3)
    make.assign(req, make.episode(), op)
    make.assign(req, make.episode(), op)

    r = client.post(
        f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "delivered"}
    )
    assert r.status_code == 409
    assert "2 of 3" in r.json()["detail"]

    make.assign(req, make.episode(), op)
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "delivered"}
        ).status_code
        == 200
    )


def test_failed_transition_leaves_no_history_and_unknown_status_is_422(client, make, db):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c, status="submitted")
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "delivered"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/requests/{req.id}/transition", headers=auth(op), json={"to": "bogus"}
        ).status_code
        == 422
    )
    count = (
        db.execute(select(RequestStatusHistory).where(RequestStatusHistory.request_id == req.id))
        .scalars()
        .all()
    )
    assert len(count) == 1  # only the creation row


def test_available_transitions_reflect_role_and_ownership(client, make):
    c, other, op = make.user("client"), make.user("client"), make.user("operator")
    req = make.request(c, status="delivered", count=1)
    get = lambda who: client.get(f"/api/requests/{req.id}", headers=auth(who))  # noqa: E731
    assert sorted(get(c).json()["available_transitions"]) == ["accepted", "rejected"]
    assert get(op).json()["available_transitions"] == []
    assert get(other).status_code == 404


def test_request_validation(client, make):
    h = auth(make.user("client"))
    ok = {"task_name": "pick cup", "episodes_requested": 1, "deadline": "2099-01-01"}
    assert client.post("/api/requests", headers=h, json=ok).status_code == 201
    for bad in (
        {**ok, "episodes_requested": 0},
        {**ok, "episodes_requested": -3},
        {**ok, "task_name": "   "},
        {**ok, "deadline": "2000-01-01"},
        {**ok, "deadline": "not-a-date"},
        {**ok, "notes": "x" * 5000},
    ):
        assert client.post("/api/requests", headers=h, json=bad).status_code in (422,), bad
