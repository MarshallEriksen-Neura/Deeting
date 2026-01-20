"""noop legacy migration (provider_model templates removed)

Revision ID: 20260120_01_backfill_provider_model_templates
Revises: 20260119_03_fix_image_model_capability
Create Date: 2026-01-20 10:00:00
"""

from __future__ import annotations


# revision identifiers, used by Alembic.
revision = "20260120_01_backfill_provider_model_templates"
down_revision = "20260119_03_fix_image_model_capability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """provider_model 模板字段已移除，此迁移保留版本号不做任何处理。"""
    return None


def downgrade() -> None:
    return None
