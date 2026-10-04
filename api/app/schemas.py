from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["client", "operator", "admin"]
Quality = Literal["good", "usable", "bad"]
Status = Literal["submitted", "in_progress", "delivered", "accepted", "rejected"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth / users -------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class UserOut(ORM):
    id: int
    email: str
    name: str
    organisation: str | None
    role: Role
    is_active: bool


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=200)
    organisation: str | None = Field(default=None, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    role: Role


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    organisation: str | None = Field(default=None, max_length=200)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)


# ---- episodes -----------------------------------------------------------------------------
class EpisodeOut(ORM):
    id: int
    episode_id: str
    robot_id: str
    task_name: str
    recorded_at: datetime
    duration_seconds: int
    operator_name: str | None
    quality: Quality
    assigned_request_id: int | None = None


class EpisodePage(BaseModel):
    items: list[EpisodeOut]
    total: int
    limit: int
    offset: int


# ---- requests -----------------------------------------------------------------------------
class RequestCreate(BaseModel):
    task_name: str = Field(min_length=1, max_length=200)
    episodes_requested: int = Field(ge=1, le=1_000_000)
    deadline: date
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("deadline")
    @classmethod
    def _not_in_past(cls, v: date) -> date:
        if v < date.today():
            raise ValueError("deadline must not be in the past")
        return v


class TransitionIn(BaseModel):
    to: Status
    note: str | None = Field(default=None, max_length=2000)


class AssignIn(BaseModel):
    episode_ids: list[int] = Field(min_length=1, max_length=1000)


class HistoryOut(BaseModel):
    from_status: Status | None
    to_status: Status
    changed_by_id: int
    changed_by_name: str
    changed_at: datetime
    note: str | None


class RequestOut(BaseModel):
    id: int
    client_id: int
    client_name: str
    client_organisation: str | None
    task_name: str
    episodes_requested: int
    assigned_count: int
    deadline: date
    notes: str | None
    status: Status
    created_at: datetime
    updated_at: datetime
    available_transitions: list[Status]


class RequestDetail(RequestOut):
    history: list[HistoryOut]
    episodes: list[EpisodeOut]


class RequestPage(BaseModel):
    items: list[RequestOut]
    total: int
    limit: int
    offset: int
