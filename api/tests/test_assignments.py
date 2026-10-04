"""Assignment rules: quality gate, one-request-per-episode, locked states, atomicity."""

import threading

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Assignment
from tests.conftest import auth


def assign(client, user, request_id, *episodes):
    return client.post(
        f"/api/requests/{request_id}/assignments",
        headers=auth(user),
        json={"episode_ids": [e.id for e in episodes]},
    )


@pytest.mark.parametrize("quality", ["good", "usable"])
def test_good_and_usable_episodes_can_be_assigned(client, make, quality):
    c, op = make.user("client"), make.user("operator")
    req, ep = make.request(c), make.episode(quality=quality)
    r = assign(client, op, req.id, ep)
    assert r.status_code == 200
    assert [e["episode_id"] for e in r.json()["episodes"]] == [ep.episode_id]
    assert r.json()["assigned_count"] == 1


def test_bad_episodes_cannot_be_assigned(client, make, db):
    c, op = make.user("client"), make.user("operator")
    req, ep = make.request(c), make.episode(quality="bad")
    r = assign(client, op, req.id, ep)
    assert r.status_code == 409
    assert r.json()["errors"] == [{"episode": ep.episode_id, "reason": "quality_not_assignable"}]
    assert db.scalar(select(Assignment.id)) is None


def test_episode_cannot_belong_to_two_requests(client, make):
    c1, c2, op = make.user("client"), make.user("client"), make.user("operator")
    r1, r2, ep = make.request(c1), make.request(c2), make.episode()
    assert assign(client, op, r1.id, ep).status_code == 200
    again_elsewhere = assign(client, op, r2.id, ep)
    assert again_elsewhere.status_code == 409
    assert again_elsewhere.json()["errors"][0]["reason"] == "already_assigned"
    again_same = assign(client, op, r1.id, ep)  # also not twice on the same request
    assert again_same.status_code == 409


def test_assignment_is_all_or_nothing(client, make, db):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c)
    good, bad = make.episode(quality="good"), make.episode(quality="bad")
    r = assign(client, op, req.id, good, bad)
    assert r.status_code == 409
    assert db.scalar(select(Assignment.id)) is None  # the good one was not assigned either


def test_unknown_episode_is_reported(client, make):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c)
    r = client.post(
        f"/api/requests/{req.id}/assignments", headers=auth(op), json={"episode_ids": [424242]}
    )
    assert r.status_code == 409
    assert r.json()["errors"][0]["reason"] == "not_found"


def test_duplicate_ids_in_one_call_are_collapsed(client, make):
    c, op = make.user("client"), make.user("operator")
    req, ep = make.request(c), make.episode()
    r = client.post(
        f"/api/requests/{req.id}/assignments",
        headers=auth(op),
        json={"episode_ids": [ep.id, ep.id]},
    )
    assert r.status_code == 200
    assert r.json()["assigned_count"] == 1


def test_unassign_frees_the_episode_for_another_request(client, make):
    c, op = make.user("client"), make.user("operator")
    r1, r2, ep = make.request(c), make.request(c), make.episode()
    assert assign(client, op, r1.id, ep).status_code == 200
    assert (
        client.delete(f"/api/requests/{r1.id}/assignments/{ep.id}", headers=auth(op)).status_code
        == 204
    )
    assert assign(client, op, r2.id, ep).status_code == 200
    # unassigning something that isn't assigned there
    assert (
        client.delete(f"/api/requests/{r1.id}/assignments/{ep.id}", headers=auth(op)).status_code
        == 404
    )


@pytest.mark.parametrize("status", ["delivered", "accepted", "rejected"])
def test_assignments_are_frozen_once_delivered(client, make, status):
    c, op = make.user("client"), make.user("operator")
    req, ep, other = make.request(c, status=status), make.episode(), make.episode()
    make.assign(req, ep, op)
    assert assign(client, op, req.id, other).status_code == 409
    assert (
        client.delete(f"/api/requests/{req.id}/assignments/{ep.id}", headers=auth(op)).status_code
        == 409
    )


@pytest.mark.parametrize("status", ["submitted", "in_progress"])
def test_assignments_open_while_submitted_or_in_progress(client, make, status):
    c, op = make.user("client"), make.user("operator")
    req, ep = make.request(c, status=status), make.episode()
    assert assign(client, op, req.id, ep).status_code == 200


def test_database_itself_rejects_double_assignment(make, db):
    c, op = make.user("client"), make.user("operator")
    r1, r2, ep = make.request(c), make.request(c), make.episode()
    make.assign(r1, ep, op)
    with pytest.raises(IntegrityError):
        make.assign(r2, ep, op)
    db.rollback()


def test_concurrent_assignment_of_same_episode_has_exactly_one_winner(make):
    from fastapi.testclient import TestClient

    from app.main import app

    c1, c2, op = make.user("client"), make.user("client"), make.user("operator")
    r1, r2, ep = make.request(c1), make.request(c2), make.episode()
    barrier = threading.Barrier(2)
    results: list[int] = []

    def worker(request_id):
        with TestClient(app) as cl:
            barrier.wait()
            results.append(assign(cl, op, request_id, ep).status_code)

    threads = [threading.Thread(target=worker, args=(rid,)) for rid in (r1.id, r2.id)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200, 409]


def test_assignment_listing_flags(client, make):
    c, op = make.user("client"), make.user("operator")
    req = make.request(c)
    taken, free = make.episode(task="pick cup"), make.episode(task="pick cup")
    make.assign(req, taken, op)
    items = client.get("/api/episodes?assigned=false", headers=auth(op)).json()["items"]
    assert [e["episode_id"] for e in items] == [free.episode_id]
    items = client.get("/api/episodes?assigned=true", headers=auth(op)).json()["items"]
    assert items[0]["assigned_request_id"] == req.id


def test_episode_filters(client, make):
    op = make.user("operator")
    make.episode(task="pick cup", quality="good")
    make.episode(task="pick cup", quality="bad")
    make.episode(task="fold towel", quality="good", robot="arm-02")
    h = auth(op)
    assert client.get("/api/episodes?task_name=Pick%20Cup", headers=h).json()["total"] == 2
    assert (
        client.get("/api/episodes?task_name=pick cup&quality=good", headers=h).json()["total"] == 1
    )
    assert client.get("/api/episodes?quality=good&robot_id=arm-02", headers=h).json()["total"] == 1
    assert client.get("/api/episodes?quality=excellent", headers=h).status_code == 422
    page = client.get("/api/episodes?limit=2&offset=2", headers=h).json()
    assert page["total"] == 3 and len(page["items"]) == 1
