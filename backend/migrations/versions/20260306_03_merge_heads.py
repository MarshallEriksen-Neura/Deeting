"""merge heads

Revision ID: 20260306_03_merge_heads
Revises: 20260305_02_add_provider_model_entitlement, 20260306_02_bind_login_session_to_device_tokens
Create Date: 2026-03-06
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20260306_03_merge_heads"
down_revision: str | tuple[str, str] | None = (
    "20260305_02_add_provider_model_entitlement",
    "20260306_02_bind_login_session_to_device_tokens",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
