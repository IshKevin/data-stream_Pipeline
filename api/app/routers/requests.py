from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import workflow
from app.db import get_db
from app.deps import current_user, require_client, require_staff
from app.models import Assignment, Episode, Request, RequestStatusHistory, User
from app.schemas import (
    AssignIn,
    EpisodeOut,
    HistoryOut,
    RequestCreate,
    RequestDetail,
    RequestOut,
    RequestPage,
    Status,
    TransitionIn,
)
from app.services import requests as svc
from app.services.normalize import normalize_task_name

router = APIRouter(prefix="/requests", tags=["requests"])


def _to_out(req: Request, client: User, assigned: int, viewer: User) -> RequestOut:
    allowed = workflow.available_transitions(req.status, viewer.role)
    if viewer.role == "client" and req.client_id != viewer.id:
        allowed = []
    return RequestOut(
        id=req.id,
        client_id=req.client_id,
        client_name=client.name,
        client_organisation=client.organisation,
        task_name=req.task_name,
        episodes_requested=req.episodes_requested,
        assigned_count=assigned,
        deadline=req.deadline,
        notes=req.notes,
        status=req.status,  # type: ignore[arg-type]
        created_at=req.created_at,
        updated_at=req.updated_at,
        available_transitions=allowed,  # type: ignore[arg-type]
    )


def _assigned_subquery():
    return (
        select(func.count())
        .select_from(Assignment)
        .where(Assignment.request_id == Request.id)
        .correlate(Request)
        .scalar_subquery()
    )


def _out_by_id(db: Session, request_id: int, viewer: User) -> RequestOut:
    row = db.execute(
        select(Request, User, _assigned_subquery())
        .join(User, User.id == Request.client_id)
        .where(Request.id == request_id)
    ).one()
    return _to_out(row[0], row[1], row[2], viewer)


def _detail(db: Session, request_id: int, viewer: User) -> RequestDetail:
    out = _out_by_id(db, request_id, viewer)
    history = db.execute(
        select(RequestStatusHistory, User.name)
        .join(User, User.id == RequestStatusHistory.changed_by)
        .where(RequestStatusHistory.request_id == request_id)
        .order_by(RequestStatusHistory.id)
    ).all()
    episodes = db.execute(
        select(Episode)
        .join(Assignment, Assignment.episode_pk == Episode.id)
        .where(Assignment.request_id == request_id)
        .order_by(Assignment.id)
    ).scalars()
    return RequestDetail(
        **out.model_dump(),
        history=[
            HistoryOut(
                from_status=h.from_status,  # type: ignore[arg-type]
                to_status=h.to_status,  # type: ignore[arg-type]
                changed_by_id=h.changed_by,
                changed_by_name=name,
                changed_at=h.changed_at,
                note=h.note,
            )
            for h, name in history
        ],
        episodes=[
            EpisodeOut.model_validate(e).model_copy(update={"assigned_request_id": request_id})
            for e in episodes
        ],
    )


@router.post("", response_model=RequestOut, status_code=201)
def create_request(
    body: RequestCreate, db: Session = Depends(get_db), user: User = Depends(require_client)
):
    req = svc.create_request(
        db,
        user,
        task_name=body.task_name,
        episodes_requested=body.episodes_requested,
        deadline=body.deadline,
        notes=body.notes,
    )
    return _out_by_id(db, req.id, user)


@router.get("", response_model=RequestPage)
def list_requests(
    status: Status | None = None,
    task_name: str | None = Query(default=None, max_length=200),
    client_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    where = []
    if user.role == "client":
        where.append(Request.client_id == user.id)  # clients never see other clients' requests
    elif client_id is not None:
        where.append(Request.client_id == client_id)
    if status:
        where.append(Request.status == status)
    if task_name:
        where.append(Request.task_name == normalize_task_name(task_name))

    total = db.scalar(select(func.count()).select_from(Request).where(*where)) or 0
    rows = db.execute(
        select(Request, User, _assigned_subquery())
        .join(User, User.id == Request.client_id)
        .where(*where)
        .order_by(Request.created_at.desc(), Request.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return RequestPage(
        items=[_to_out(r, c, n, user) for r, c, n in rows], total=total, limit=limit, offset=offset
    )


@router.get("/{request_id}", response_model=RequestDetail)
def get_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    svc.get_request_for_user(db, request_id, user)  # 404 if missing or not the client's own
    return _detail(db, request_id, user)


@router.post("/{request_id}/transition", response_model=RequestDetail)
def transition(
    request_id: int,
    body: TransitionIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    svc.transition_request(db, request_id, user, body.to, body.note)
    return _detail(db, request_id, user)


@router.post("/{request_id}/assignments", response_model=RequestDetail)
def assign(
    request_id: int,
    body: AssignIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    svc.assign_episodes(db, request_id, user, body.episode_ids)
    return _detail(db, request_id, user)


@router.delete("/{request_id}/assignments/{episode_pk}", status_code=204)
def unassign(
    request_id: int,
    episode_pk: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    svc.unassign_episode(db, request_id, user, episode_pk)
    return Response(status_code=204)
