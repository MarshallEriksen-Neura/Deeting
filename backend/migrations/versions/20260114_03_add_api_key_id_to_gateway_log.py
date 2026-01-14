"""add api_key_id to gateway_log

Revision ID: 20260114_03_add_api_key_id_to_gateway_log
Revises: 20260114_02_add_conversation_delete_fields
Create Date: 2026-01-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260114_03_add_api_key_id_to_gateway_log"
down_revision: Union[str, None] = "20260114_02_add_conversation_delete_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gateway_log", sa.Column("api_key_id", sa.UUID(), nullable=True))
    op.create_index("ix_gateway_log_api_key_id", "gateway_log", ["api_key_id"])


def downgrade() -> None:
    op.drop_index("ix_gateway_log_api_key_id", table_name="gateway_log")
    op.drop_column("gateway_log", "api_key_id")
