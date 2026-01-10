"""create bridge agent token table

Revision ID: 20260106_06
Revises: 20260106_05
Create Date: 2026-01-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_06"
down_revision = "20260106_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bridge_agent_token",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, comment="更新时间"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, comment="所属用户 ID"),
        sa.Column("agent_id", sa.String(length=128), nullable=False, comment="Agent 标识（客户端自定义）"),
        sa.Column("version", sa.Integer(), nullable=False, comment="当前有效版本，单活"),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, comment="签发时间"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, comment="过期时间"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bridge_agent_token")),
        sa.UniqueConstraint("user_id", "agent_id", name="uq_bridge_agent_token_user_agent"),
    )
    op.create_index(op.f("ix_bridge_agent_token_user_id"), "bridge_agent_token", ["user_id"], unique=False)
    op.create_index(op.f("ix_bridge_agent_token_agent_id"), "bridge_agent_token", ["agent_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_bridge_agent_token_agent_id"), table_name="bridge_agent_token")
    op.drop_index(op.f("ix_bridge_agent_token_user_id"), table_name="bridge_agent_token")
    op.drop_table("bridge_agent_token")
