from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.errors import Unauthorized
from app.models import User
from app.schemas import LoginIn, LoginOut, UserOut
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.execute(
        select(User).where(func.lower(User.email) == body.email.strip().lower())
    ).scalar_one_or_none()
    ok = verify_password(body.password, user.password_hash if user else None)
    if not ok or user is None or not user.is_active:
        # Same message for unknown email, wrong password and deactivated account.
        raise Unauthorized("Incorrect email or password")
    return LoginOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
