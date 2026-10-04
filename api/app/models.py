from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

ROLES = ("client", "operator", "admin")
QUALITIES = ("good", "usable", "bad")
STATUSES = ("submitted", "in_progress", "delivered", "accepted", "rejected")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254))
    name: Mapped[str] = mapped_column(String(200))
    organisation: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Emails are compared case-insensitively.
Index("uq_users_email_lower", func.lower(User.email), unique=True)


class Episode(Base):
    __tablename__ = "episodes"
    __table_args__ = (
        CheckConstraint(_in("quality", QUALITIES), name="ck_episodes_quality"),
        CheckConstraint("duration_seconds > 0", name="ck_episodes_duration_positive"),
        # Analytics: episodes per day per robot; recorded_at range scans.
        Index("ix_episodes_recorded_robot", "recorded_at", "robot_id"),
        # Analytics: top tasks by good episodes (partial index keeps it small).
        Index(
            "ix_episodes_good_recorded_task",
            "recorded_at",
            "task_name",
            postgresql_where=text("quality = 'good'"),
        ),
        # Operator picker: filter by task and quality.
        Index("ix_episodes_task_quality", "task_name", "quality"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    episode_id: Mapped[str] = mapped_column(String(64), unique=True)
    robot_id: Mapped[str] = mapped_column(String(64))
    task_name: Mapped[str] = mapped_column(String(200))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int] = mapped_column(Integer)
    operator_name: Mapped[str | None] = mapped_column(String(200))
    quality: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assignment: Mapped[Assignment | None] = relationship(back_populates="episode", uselist=False)


class Request(Base):
    __tablename__ = "requests"
    __table_args__ = (
        CheckConstraint(_in("status", STATUSES), name="ck_requests_status"),
        CheckConstraint("episodes_requested > 0", name="ck_requests_count_positive"),
        Index("ix_requests_client_created", "client_id", "created_at"),
        Index("ix_requests_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    task_name: Mapped[str] = mapped_column(String(200))
    episodes_requested: Mapped[int] = mapped_column(Integer)
    deadline: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="submitted")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped[User] = relationship()
    history: Mapped[list[RequestStatusHistory]] = relationship(
        back_populates="request", order_by="RequestStatusHistory.id"
    )
    assignments: Mapped[list[Assignment]] = relationship(
        back_populates="request", order_by="Assignment.id"
    )


class RequestStatusHistory(Base):
    """Append-only audit trail: who moved which request to which status, and when."""

    __tablename__ = "request_status_history"
    __table_args__ = (
        CheckConstraint(_in("to_status", STATUSES), name="ck_history_to_status"),
        Index("ix_history_request", "request_id", "changed_at"),
        # Analytics: find first 'delivered' event per request.
        Index("ix_history_to_status", "to_status", "request_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id", ondelete="CASCADE"))
    from_status: Mapped[str | None] = mapped_column(String(20))  # NULL on creation
    to_status: Mapped[str] = mapped_column(String(20))
    changed_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str | None] = mapped_column(Text)

    request: Mapped[Request] = relationship(back_populates="history")
    actor: Mapped[User] = relationship()


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        # The core invariant: an episode belongs to at most one request at a time.
        UniqueConstraint("episode_pk", name="uq_assignments_episode"),
        Index("ix_assignments_request", "request_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id", ondelete="CASCADE"))
    episode_pk: Mapped[int] = mapped_column(ForeignKey("episodes.id"))
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    request: Mapped[Request] = relationship(back_populates="assignments")
    episode: Mapped[Episode] = relationship(back_populates="assignment")
