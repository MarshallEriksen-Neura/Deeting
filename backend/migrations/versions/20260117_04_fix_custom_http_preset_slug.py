"""Fix provider_instance preset_slug for Custom HTTP

Revision ID: 20260117_04_fix_custom_http_preset_slug
Revises: 20260117_03_add_user_secretary_topic_naming_model, 20260117_03_drop_provider_instance_channel
Create Date: 2026-01-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260117_04_fix_custom_http_preset_slug"
down_revision = (
    "20260117_03_add_user_secretary_topic_naming_model",
    "20260117_03_drop_provider_instance_channel",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("provider_instance"):
        return

    existing_columns = {col["name"] for col in inspector.get_columns("provider_instance")}
    if "preset_slug" not in existing_columns:
        return

    bind.execute(
        sa.text(
            "UPDATE provider_instance "
            "SET preset_slug = :new_slug "
            "WHERE preset_slug = :old_slug"
        ),
        {"new_slug": "custom", "old_slug": "Custom HTTP"},
    )


def downgrade() -> None:
    # Data fix is intentionally not reversible.
    return
