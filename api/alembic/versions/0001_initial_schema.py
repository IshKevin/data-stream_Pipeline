"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-01
"""

import sqlalchemy as sa

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

STATUSES = "('submitted', 'in_progress', 'delivered', 'accepted', 'rejected')"


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("organisation", sa.String(200)),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role IN ('client', 'operator', 'admin')", name="ck_users_role"),
    )
    op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "episodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("episode_id", sa.String(64), nullable=False, unique=True),
        sa.Column("robot_id", sa.String(64), nullable=False),
        sa.Column("task_name", sa.String(200), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("operator_name", sa.String(200)),
        sa.Column("quality", sa.String(10), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("quality IN ('good', 'usable', 'bad')", name="ck_episodes_quality"),
        sa.CheckConstraint("duration_seconds > 0", name="ck_episodes_duration_positive"),
    )
    op.create_index("ix_episodes_recorded_robot", "episodes", ["recorded_at", "robot_id"])
    op.create_index(
        "ix_episodes_good_recorded_task",
        "episodes",
        ["recorded_at", "task_name"],
        postgresql_where=sa.text("quality = 'good'"),
    )
    op.create_index("ix_episodes_task_quality", "episodes", ["task_name", "quality"])

    op.create_table(
        "requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_name", sa.String(200), nullable=False),
        sa.Column("episodes_requested", sa.Integer(), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(f"status IN {STATUSES}", name="ck_requests_status"),
        sa.CheckConstraint("episodes_requested > 0", name="ck_requests_count_positive"),
    )
    op.create_index("ix_requests_client_created", "requests", ["client_id", "created_at"])
    op.create_index("ix_requests_status", "requests", ["status"])

    op.create_table(
        "request_status_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id",
            sa.Integer(),
            sa.ForeignKey("requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(20)),
        sa.Column("to_status", sa.String(20), nullable=False),
        sa.Column("changed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("note", sa.Text()),
        sa.CheckConstraint(f"to_status IN {STATUSES}", name="ck_history_to_status"),
    )
    op.create_index("ix_history_request", "request_status_history", ["request_id", "changed_at"])
    op.create_index("ix_history_to_status", "request_status_history", ["to_status", "request_id"])

    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "request_id",
            sa.Integer(),
            sa.ForeignKey("requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("episode_pk", sa.Integer(), sa.ForeignKey("episodes.id"), nullable=False),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("episode_pk", name="uq_assignments_episode"),
    )
    op.create_index("ix_assignments_request", "assignments", ["request_id"])


def downgrade() -> None:
    op.drop_table("assignments")
    op.drop_table("request_status_history")
    op.drop_table("requests")
    op.drop_table("episodes")
    op.drop_table("users")
