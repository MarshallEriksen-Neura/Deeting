"""add user secretary model name

Revision ID: 20260115_07_add_user_secretary_model
Revises: 20260115_06_add_assistant_rating_table, 20260115_06_create_media_asset_table
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260115_07_add_user_secretary_model"
down_revision: Union[str, tuple[str, str], None] = (
    "20260115_06_add_assistant_rating_table",
    "20260115_06_create_media_asset_table",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    has_secretary_phase = inspector.has_table("secretary_phase")
    has_user_secretary = inspector.has_table("user_secretary")

    if not has_secretary_phase:
        op.create_table(
            "secretary_phase",
            sa.Column("name", sa.String(length=50), nullable=False, comment="Phase Name"),
            sa.Column("description", sa.Text(), nullable=True, comment="Internal description"),
            sa.Column("enable_retrieval", sa.Boolean(), nullable=False, comment="Enable RAG/Qdrant Retrieval"),
            sa.Column("enable_ingest", sa.Boolean(), nullable=False, comment="Enable Memory Ingestion"),
            sa.Column("enable_compression", sa.Boolean(), nullable=False, comment="Enable History Compression"),
            sa.Column("policy_config", sa.JSON(), nullable=False, comment="Detailed Policy Configuration"),
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_secretary_phase_name"), "secretary_phase", ["name"], unique=True)

    if not has_user_secretary:
        op.create_table(
            "user_secretary",
            sa.Column("user_id", sa.UUID(), nullable=False, comment="Owner User ID"),
            sa.Column("current_phase_id", sa.UUID(), nullable=False, comment="Current Capability Phase"),
            sa.Column("name", sa.String(length=50), nullable=False, comment="Secretary Name"),
            sa.Column("custom_instructions", sa.Text(), nullable=True, comment="User-defined system prompt additions"),
            sa.Column("ui_preferences", sa.JSON(), nullable=True, comment="UI specific settings"),
            sa.Column("model_name", sa.String(length=128), nullable=True, comment="秘书使用的模型名称"),
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["current_phase_id"], ["secretary_phase.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["user_account.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_user_secretary_user_id"),
        )
        return

    existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
    if "model_name" in existing_columns:
        return

    op.add_column(
        "user_secretary",
        sa.Column("model_name", sa.String(length=128), nullable=True, comment="秘书使用的模型名称"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("user_secretary"):
        return
    existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
    if "model_name" not in existing_columns:
        return
    op.drop_column("user_secretary", "model_name")
