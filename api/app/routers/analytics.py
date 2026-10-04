from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_staff
from app.errors import Invalid
from app.models import User

router = APIRouter(prefix="/analytics", tags=["analytics"])

# All three reports are computed inside PostgreSQL; Python only shapes the result rows.

EPISODES_PER_DAY_ROBOT = text(
    """
    SELECT (recorded_at AT TIME ZONE 'UTC')::date AS day, robot_id, count(*) AS episodes
    FROM episodes
    WHERE recorded_at >= :start AND recorded_at < :end
    GROUP BY 1, 2
    ORDER BY 1, 2
    """
)

REQUESTS_BY_STATUS = text(
    """
    SELECT status, count(*) AS requests
    FROM requests
    WHERE created_at >= :start AND created_at < :end
    GROUP BY status
    """
)

# Time to first delivery: first 'delivered' history row minus the moment of submission.
MEDIAN_TIME_TO_DELIVER = text(
    """
    WITH first_delivery AS (
        SELECT h.request_id, min(h.changed_at) AS delivered_at
        FROM request_status_history h
        WHERE h.to_status = 'delivered'
        GROUP BY h.request_id
    )
    SELECT
        count(*) AS delivered_requests,
        percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch FROM (d.delivered_at - r.created_at))
        ) AS median_seconds
    FROM requests r
    JOIN first_delivery d ON d.request_id = r.id
    WHERE r.created_at >= :start AND r.created_at < :end
    """
)

TOP_TASKS_GOOD = text(
    """
    SELECT task_name, count(*) AS good_episodes
    FROM episodes
    WHERE quality = 'good' AND recorded_at >= :start AND recorded_at < :end
    GROUP BY task_name
    ORDER BY good_episodes DESC, task_name
    LIMIT 5
    """
)


class DayRobotCount(BaseModel):
    day: date
    robot_id: str
    episodes: int


class RequestFulfilment(BaseModel):
    by_status: dict[str, int]
    delivered_requests: int
    median_seconds_to_deliver: float | None


class TaskCount(BaseModel):
    task_name: str
    good_episodes: int


class AnalyticsOut(BaseModel):
    date_from: date
    date_to: date
    episodes_per_day_per_robot: list[DayRobotCount]
    request_fulfilment: RequestFulfilment
    top_tasks_by_good_episodes: list[TaskCount]


@router.get("", response_model=AnalyticsOut)
def analytics(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Both bounds are inclusive UTC dates. Episodes are filtered on `recorded_at`;
    requests on the time they were submitted. Defaults to the last 30 days."""
    today = datetime.now(UTC).date()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=29))
    if date_from > date_to:
        raise Invalid("'from' must not be after 'to'")
    params = {
        "start": datetime(date_from.year, date_from.month, date_from.day, tzinfo=UTC),
        "end": datetime(date_to.year, date_to.month, date_to.day, tzinfo=UTC) + timedelta(days=1),
    }

    per_day = db.execute(EPISODES_PER_DAY_ROBOT, params).all()
    statuses = db.execute(REQUESTS_BY_STATUS, params).all()
    delivered = db.execute(MEDIAN_TIME_TO_DELIVER, params).one()
    top = db.execute(TOP_TASKS_GOOD, params).all()

    by_status = {s: 0 for s in ("submitted", "in_progress", "delivered", "accepted", "rejected")}
    by_status.update({row.status: row.requests for row in statuses})
    return AnalyticsOut(
        date_from=date_from,
        date_to=date_to,
        episodes_per_day_per_robot=[
            DayRobotCount(day=r.day, robot_id=r.robot_id, episodes=r.episodes) for r in per_day
        ],
        request_fulfilment=RequestFulfilment(
            by_status=by_status,
            delivered_requests=delivered.delivered_requests,
            median_seconds_to_deliver=(
                float(delivered.median_seconds) if delivered.median_seconds is not None else None
            ),
        ),
        top_tasks_by_good_episodes=[
            TaskCount(task_name=r.task_name, good_episodes=r.good_episodes) for r in top
        ],
    )
