"""add icon_id to assistant

Revision ID: 20260115_03_add_assistant_icon_id
Revises: 20260115_02_sync_permission_registry
Create Date: 2026-01-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260115_03_add_assistant_icon_id"
down_revision: Union[str, None] = "20260115_02_sync_permission_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "assistant",
        sa.Column("icon_id", sa.String(length=255), nullable=True, comment="助手图标 ID（如 lucide:bot）"),
    )


def downgrade() -> None:
    op.drop_column("assistant", "icon_id")
