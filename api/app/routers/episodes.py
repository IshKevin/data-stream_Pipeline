from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_staff
from app.errors import Invalid
from app.models import Assignment, Episode, User
from app.schemas import EpisodeOut, EpisodePage, Quality
from app.services.importer import FatalImportError, import_episodes
from app.services.normalize import normalize_task_name

router = APIRouter(prefix="/episodes", tags=["episodes"])


@router.get("", response_model=EpisodePage)
def list_episodes(
    task_name: str | None = Query(default=None, max_length=200),
    quality: Quality | None = None,
    robot_id: str | None = Query(default=None, max_length=64),
    assigned: bool | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    where = []
    if task_name:
        where.append(Episode.task_name == normalize_task_name(task_name))
    if quality:
        where.append(Episode.quality == quality)
    if robot_id:
        where.append(Episode.robot_id == robot_id.strip().lower())
    if assigned is True:
        where.append(Assignment.id.is_not(None))
    elif assigned is False:
        where.append(Assignment.id.is_(None))

    base = select(Episode).outerjoin(Assignment, Assignment.episode_pk == Episode.id).where(*where)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(
        select(Episode, Assignment.request_id)
        .outerjoin(Assignment, Assignment.episode_pk == Episode.id)
        .where(*where)
        .order_by(Episode.recorded_at.desc(), Episode.id)
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        EpisodeOut.model_validate(ep).model_copy(update={"assigned_request_id": rid})
        for ep, rid in rows
    ]
    return EpisodePage(items=items, total=total, limit=limit, offset=offset)


@router.get("/facets")
def facets(db: Session = Depends(get_db), _: User = Depends(require_staff)):
    """Distinct task names / robots, to populate the filter dropdowns."""
    return {
        "task_names": db.execute(select(Episode.task_name).distinct().order_by(Episode.task_name))
        .scalars()
        .all(),
        "robot_ids": db.execute(select(Episode.robot_id).distinct().order_by(Episode.robot_id))
        .scalars()
        .all(),
    }


@router.post("/import")
def import_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Import an episode CSV. Safe to repeat: episodes already stored are skipped."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    # Reject oversize uploads before parsing anything.
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_bytes:
        raise Invalid(f"File too large (limit {get_settings().max_upload_mb} MB)")
    try:
        report = import_episodes(db, file.file, filename=file.filename or "upload.csv")
    except FatalImportError as exc:
        raise Invalid(str(exc)) from None
    return report
