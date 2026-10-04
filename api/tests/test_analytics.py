"""Analytics are computed in SQL; these tests pin down the numbers on a small, known dataset."""

from datetime import UTC, datetime, timedelta

from app.models import RequestStatusHistory
from tests.conftest import auth


def at(day: int, hour=12, month=9) -> datetime:
    return datetime(2026, month, day, hour, 0, tzinfo=UTC)


def get(client, user, **params):
    return client.get("/api/analytics", headers=auth(user), params=params)


def test_episodes_per_day_per_robot(client, make):
    op = make.user("operator")
    for _ in range(2):
        make.episode(robot="arm-01", recorded_at=at(1))
    make.episode(robot="arm-02", recorded_at=at(1), quality="bad")  # all qualities are counted here
    make.episode(robot="arm-01", recorded_at=at(2, hour=23))
    make.episode(robot="arm-01", recorded_at=at(2, hour=0))
    make.episode(
        robot="arm-01", recorded_at=datetime(2026, 8, 31, 23, 59, tzinfo=UTC)
    )  # before range
    make.episode(robot="arm-01", recorded_at=at(3, hour=0))  # after range

    body = get(client, op, **{"from": "2026-09-01", "to": "2026-09-02"}).json()
    assert body["episodes_per_day_per_robot"] == [
        {"day": "2026-09-01", "robot_id": "arm-01", "episodes": 2},
        {"day": "2026-09-01", "robot_id": "arm-02", "episodes": 1},
        {"day": "2026-09-02", "robot_id": "arm-01", "episodes": 2},
    ]


def test_top_five_tasks_counts_only_good_episodes(client, make):
    op = make.user("operator")
    plan = {"a": 6, "b": 5, "c": 4, "d": 3, "e": 2, "f": 1}
    for task, n in plan.items():
        for _ in range(n):
            make.episode(task=task, quality="good", recorded_at=at(5))
    for _ in range(50):  # lots of non-good episodes must not matter
        make.episode(task="f", quality="usable", recorded_at=at(5))
        make.episode(task="f", quality="bad", recorded_at=at(5))
    make.episode(task="a", quality="good", recorded_at=at(5, month=7))  # out of range

    top = get(client, op, **{"from": "2026-09-01", "to": "2026-09-30"}).json()[
        "top_tasks_by_good_episodes"
    ]
    assert top == [{"task_name": t, "good_episodes": n} for t, n in list(plan.items())[:5]]


def test_top_tasks_ties_are_ordered_by_name(client, make):
    op = make.user("operator")
    for task in ("zebra", "apple", "mango"):
        make.episode(task=task, recorded_at=at(5))
    top = get(client, op, **{"from": "2026-09-01", "to": "2026-09-30"}).json()[
        "top_tasks_by_good_episodes"
    ]
    assert [t["task_name"] for t in top] == ["apple", "mango", "zebra"]


def _delivered_request(
    db,
    make,
    client_user,
    op,
    submitted: datetime,
    hours_to_deliver: float,
    *,
    extra_delivery_hours=None,
):
    req = make.request(client_user, status="delivered")
    req.created_at = submitted
    for h in db.query(RequestStatusHistory).filter_by(request_id=req.id):
        h.changed_at = submitted
    db.add(
        RequestStatusHistory(
            request_id=req.id,
            from_status="in_progress",
            to_status="delivered",
            changed_by=op.id,
            changed_at=submitted + timedelta(hours=hours_to_deliver),
        )
    )
    if (
        extra_delivery_hours is not None
    ):  # a second delivery after rework must not change the metric
        db.add(
            RequestStatusHistory(
                request_id=req.id,
                from_status="in_progress",
                to_status="delivered",
                changed_by=op.id,
                changed_at=submitted + timedelta(hours=extra_delivery_hours),
            )
        )
    db.commit()
    return req


def test_request_fulfilment_counts_and_median(client, make, db):
    c, op = make.user("client"), make.user("operator")
    for hours in (1, 3, 10):
        _delivered_request(db, make, c, op, at(10), hours)
    for status in ("submitted", "submitted", "in_progress", "accepted", "rejected"):
        r = make.request(c, status=status)
        r.created_at = at(11)
    outside = make.request(c, status="submitted")
    outside.created_at = at(1, month=1)
    db.commit()

    body = get(client, op, **{"from": "2026-09-01", "to": "2026-09-30"}).json()[
        "request_fulfilment"
    ]
    assert body["by_status"] == {
        "submitted": 2,
        "in_progress": 1,
        "delivered": 3,
        "accepted": 1,
        "rejected": 1,
    }
    assert body["delivered_requests"] == 3
    assert body["median_seconds_to_deliver"] == 3 * 3600


def test_median_interpolates_for_even_counts_and_uses_first_delivery(client, make, db):
    c, op = make.user("client"), make.user("operator")
    for hours in (1, 3, 5):
        _delivered_request(db, make, c, op, at(10), hours)
    _delivered_request(
        db, make, c, op, at(10), 10, extra_delivery_hours=500
    )  # reworked: first delivery counts
    body = get(client, op, **{"from": "2026-09-01", "to": "2026-09-30"}).json()[
        "request_fulfilment"
    ]
    assert body["delivered_requests"] == 4
    assert body["median_seconds_to_deliver"] == 4 * 3600  # (3h + 5h) / 2


def test_empty_database(client, make):
    op = make.user("operator")
    body = get(client, op, **{"from": "2026-09-01", "to": "2026-09-30"}).json()
    assert body["episodes_per_day_per_robot"] == []
    assert body["top_tasks_by_good_episodes"] == []
    assert body["request_fulfilment"]["median_seconds_to_deliver"] is None
    assert body["request_fulfilment"]["delivered_requests"] == 0
    assert set(body["request_fulfilment"]["by_status"].values()) == {0}


def test_range_validation_and_defaults(client, make):
    op = make.user("operator")
    assert get(client, op, **{"from": "2026-09-30", "to": "2026-09-01"}).status_code == 422
    assert get(client, op, **{"from": "garbage"}).status_code == 422
    default = get(client, op)
    assert default.status_code == 200
    body = default.json()
    assert (
        datetime.fromisoformat(body["date_to"]) - datetime.fromisoformat(body["date_from"])
    ).days == 29


def test_analytics_uses_the_expected_indexes(db):
    """Guards against the report silently turning into a full scan of a big table."""
    from sqlalchemy import text

    from app.routers.analytics import EPISODES_PER_DAY_ROBOT, TOP_TASKS_GOOD

    db.execute(text("SET enable_seqscan = off"))  # tiny tables would otherwise always seq-scan
    for stmt in (EPISODES_PER_DAY_ROBOT, TOP_TASKS_GOOD):
        sql = stmt.text.replace(":start", "'2026-09-01'::timestamptz").replace(
            ":end", "'2026-09-30'::timestamptz"
        )
        plan = "\n".join(r[0] for r in db.execute(text("EXPLAIN " + sql)))
        assert "Index" in plan and "Seq Scan" not in plan, plan
    db.rollback()
