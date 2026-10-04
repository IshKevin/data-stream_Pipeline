from collections.abc import Callable

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db, session_factory
from app.errors import Forbidden, Unauthorized
from app.models import User
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def _authenticate(
    request: Request, creds: HTTPAuthorizationCredentials | None, db: Session
) -> User:
    if creds is None:
        raise Unauthorized("Authentication required")
    user_id = decode_access_token(creds.credentials)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise Unauthorized("Invalid or expired credentials")
    request.state.user_id = user.id  # picked up by the access-log middleware
    return user


def current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate every request. The user is re-read from the DB each time, so
    deactivating a user or changing their role takes effect immediately."""
    return _authenticate(request, creds, db)


def streaming_user(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> User:
    """Same as `current_user`, but for long-lived responses (SSE): uses a short-lived session
    that is closed immediately, so an open stream never holds a pooled DB connection."""
    with session_factory()() as db:
        return _authenticate(request, creds, db)


def require_roles(*roles: str) -> Callable[[User], User]:
    def checker(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise Forbidden("You do not have permission to perform this action")
        return user

    return checker


require_client = require_roles("client")
require_staff = require_roles("operator", "admin")
require_admin = require_roles("admin")
