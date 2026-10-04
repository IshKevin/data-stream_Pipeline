from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import workflow
from app.errors import Conflict, Forbidden, Invalid, NotFound
from app.events import broker
from app.models import Assignment, Episode, Request, RequestStatusHistory, User
from app.services.normalize import normalize_task_name


def create_request(
    db: Session,
    client: User,
    *,
    task_name: str,
    episodes_requested: int,
    deadline: date,
    notes: str | None,
) -> Request:
    task = normalize_task_name(task_name)
    if not task:
        raise Invalid("task_name must not be blank")
    req = Request(
        client_id=client.id,
        task_name=task,
        episodes_requested=episodes_requested,
        deadline=deadline,
        notes=(notes or "").strip() or None,
        status=workflow.SUBMITTED,
    )
    db.add(req)
    db.flush()
    db.add(
        RequestStatusHistory(
            request_id=req.id, from_status=None, to_status=workflow.SUBMITTED, changed_by=client.id
        )
    )
    db.commit()
    broker.publish(
        {"type": "request.created", "request_id": req.id, "status": req.status},
        client_id=req.client_id,
    )
    return req


def get_request_for_user(
    db: Session, request_id: int, user: User, *, lock: bool = False
) -> Request:
    """Load a request the user is allowed to see. Clients asking for someone else's
    request get 404 (not 403) so request ids can't be probed."""
    stmt = select(Request).where(Request.id == request_id)
    if lock:
        stmt = stmt.with_for_update()
    req = db.execute(stmt).scalar_one_or_none()
    if req is None or (user.role == "client" and req.client_id != user.id):
        raise NotFound("Request not found")
    return req


def assigned_count(db: Session, request_id: int) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(Assignment).where(Assignment.request_id == request_id)
        )
        or 0
    )


def transition_request(
    db: Session, request_id: int, user: User, to_status: str, note: str | None
) -> Request:
    # Lock the row: two concurrent transitions (or an assignment racing a delivery) serialise here.
    req = get_request_for_user(db, request_id, user, lock=True)

    roles = workflow.transition_roles(req.status, to_status)
    if roles is None:
        raise Conflict(f"Cannot move a request from '{req.status}' to '{to_status}'")
    if user.role not in roles:
        raise Forbidden(
            f"Role '{user.role}' may not move a request from '{req.status}' to '{to_status}'"
        )

    if to_status == workflow.DELIVERED:
        have = assigned_count(db, req.id)
        if have < req.episodes_requested:
            raise Conflict(
                f"Cannot deliver: {have} of {req.episodes_requested} required episodes are assigned"
            )

    db.add(
        RequestStatusHistory(
            request_id=req.id,
            from_status=req.status,
            to_status=to_status,
            changed_by=user.id,
            note=(note or "").strip() or None,
        )
    )
    req.status = to_status
    db.commit()
    broker.publish(
        {"type": "request.status_changed", "request_id": req.id, "status": req.status},
        client_id=req.client_id,
    )
    return req


def assign_episodes(db: Session, request_id: int, user: User, episode_pks: list[int]) -> Request:
    req = get_request_for_user(db, request_id, user, lock=True)
    if req.status not in workflow.ASSIGNABLE_STATUSES:
        raise Conflict(f"Episodes cannot be changed while the request is '{req.status}'")

    unique_pks = list(dict.fromkeys(episode_pks))
    episodes = {
        e.id: e for e in db.execute(select(Episode).where(Episode.id.in_(unique_pks))).scalars()
    }
    taken = dict(
        db.execute(
            select(Assignment.episode_pk, Assignment.request_id).where(
                Assignment.episode_pk.in_(unique_pks)
            )
        ).all()
    )

    problems: list[dict] = []
    for pk in unique_pks:
        ep = episodes.get(pk)
        if ep is None:
            problems.append({"episode": pk, "reason": "not_found"})
        elif ep.quality not in workflow.ASSIGNABLE_QUALITIES:
            problems.append({"episode": ep.episode_id, "reason": "quality_not_assignable"})
        elif pk in taken:
            problems.append({"episode": ep.episode_id, "reason": "already_assigned"})
    if problems:
        raise Conflict("Some episodes cannot be assigned; nothing was changed", details=problems)

    db.add_all(
        Assignment(request_id=req.id, episode_pk=pk, assigned_by=user.id) for pk in unique_pks
    )
    try:
        db.commit()  # the UNIQUE(episode_pk) constraint is the final arbiter under concurrency
    except IntegrityError:
        db.rollback()
        raise Conflict(
            "An episode was assigned to another request at the same time; try again"
        ) from None
    return req


def unassign_episode(db: Session, request_id: int, user: User, episode_pk: int) -> None:
    req = get_request_for_user(db, request_id, user, lock=True)
    if req.status not in workflow.ASSIGNABLE_STATUSES:
        raise Conflict(f"Episodes cannot be changed while the request is '{req.status}'")
    assignment = db.execute(
        select(Assignment).where(
            Assignment.request_id == req.id, Assignment.episode_pk == episode_pk
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise NotFound("That episode is not assigned to this request")
    db.delete(assignment)
    db.commit()
