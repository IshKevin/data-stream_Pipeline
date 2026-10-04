from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_admin
from app.errors import Conflict, NotFound
from app.models import User
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.execute(select(User).order_by(User.id)).scalars().all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    email = body.email.strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise Conflict("A user with that email already exists")
    user = User(
        email=email,
        name=body.name.strip(),
        organisation=body.organisation,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("A user with that email already exists") from None
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    if user.id == admin.id and (
        body.is_active is False or (body.role is not None and body.role != "admin")
    ):
        # Prevents an admin locking everyone (themselves included) out by accident.
        raise Conflict("You cannot deactivate yourself or remove your own admin role")
    if body.name is not None:
        user.name = body.name.strip()
    if body.organisation is not None:
        user.organisation = body.organisation
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    db.commit()
    return user
