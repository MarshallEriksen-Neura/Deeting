"""create provider_model_entitlement

Revision ID: 20260305_02_add_provider_model_entitlement
Revises: 20260305_01_add_provider_instance_is_public
Create Date: 2026-03-05
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260305_02_add_provider_model_entitlement"
down_revision: str | Sequence[str] | None = "20260305_01_add_provider_instance_is_public"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "provider_model_entitlement",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="购买用户 ID",
        ),
        sa.Column(
            "provider_model_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="被解锁的 ProviderModel ID",
        ),
        sa.Column(
            "purchase_price",
            sa.Numeric(18, 6),
            nullable=False,
            comment="购买价格（积分）",
        ),
        sa.Column(
            "currency",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'credits'"),
            comment="计价货币，默认 credits",
        ),
        sa.Column(
            "source_tx_trace_id",
            sa.String(length=64),
            nullable=True,
            comment="关联计费流水 trace_id",
        ),
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_model_id"],
            ["provider_model.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "provider_model_id",
            name="uq_provider_model_entitlement_user_model",
        ),
    )
    op.create_index(
        "ix_provider_model_entitlement_user_id",
        "provider_model_entitlement",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_provider_model_entitlement_provider_model_id",
        "provider_model_entitlement",
        ["provider_model_id"],
        unique=False,
    )
    op.create_index(
        "ix_provider_model_entitlement_source_tx_trace_id",
        "provider_model_entitlement",
        ["source_tx_trace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_provider_model_entitlement_source_tx_trace_id",
        table_name="provider_model_entitlement",
    )
    op.drop_index(
        "ix_provider_model_entitlement_provider_model_id",
        table_name="provider_model_entitlement",
    )
    op.drop_index(
        "ix_provider_model_entitlement_user_id",
        table_name="provider_model_entitlement",
    )
    op.drop_table("provider_model_entitlement")
