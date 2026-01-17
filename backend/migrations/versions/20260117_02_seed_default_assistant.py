"""seed default assistant

Revision ID: 20260117_02_seed_default_assistant
Revises: 20260117_01_add_system_setting_and_secretary_embedding_model
Create Date: 2026-01-17
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260117_02_seed_default_assistant"
down_revision = "20260117_01_add_system_setting_and_secretary_embedding_model"
branch_labels = None
depends_on = None


assistant_table = sa.table(
    "assistant",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("owner_user_id", postgresql.UUID(as_uuid=True)),
    sa.column("visibility", sa.String),
    sa.column("status", sa.String),
    sa.column("share_slug", sa.String),
    sa.column("summary", sa.String),
    sa.column("icon_id", sa.String),
    sa.column("current_version_id", postgresql.UUID(as_uuid=True)),
    sa.column("published_at", sa.DateTime(timezone=True)),
)


assistant_version_table = sa.table(
    "assistant_version",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("assistant_id", postgresql.UUID(as_uuid=True)),
    sa.column("version", sa.String),
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
    sa.column("system_prompt", sa.Text),
    sa.column("model_config", postgresql.JSONB),
    sa.column("skill_refs", postgresql.JSONB),
    sa.column("tags", postgresql.JSONB),
    sa.column("changelog", sa.Text),
    sa.column("published_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    conn = op.get_bind()
    slug = "system-default-assistant"

    existing = conn.execute(
        sa.select(assistant_table.c.id).where(assistant_table.c.share_slug == slug)
    ).scalar_one_or_none()
    if existing:
        return

    assistant_id = uuid.uuid4()
    version_id = uuid.uuid4()

    conn.execute(
        sa.insert(assistant_table).values(
            id=assistant_id,
            owner_user_id=None,
            visibility="private",
            status="published",
            share_slug=slug,
            summary="一个友好、耐心、能帮助你解决日常问题的通用助手。",
            icon_id="lucide:bot",
            current_version_id=None,
            published_at=sa.text("CURRENT_TIMESTAMP"),
        )
    )

    conn.execute(
        sa.insert(assistant_version_table).values(
            id=version_id,
            assistant_id=assistant_id,
            version="0.1.0",
            name="官方默认助手",
            description="面向日常对话与任务支持的默认助手。",
            system_prompt=(
                "你是一个友好、耐心且可靠的中文助手。回答要清晰、简洁、有条理；"
                "当问题不明确时，先提出必要的澄清问题；遇到不确定的信息要诚实说明，"
                "给出可行的下一步建议。"
            ),
            model_config={},
            skill_refs=[],
            tags=[],
            changelog=None,
            published_at=sa.text("CURRENT_TIMESTAMP"),
        )
    )

    conn.execute(
        sa.update(assistant_table)
        .where(assistant_table.c.id == assistant_id)
        .values(current_version_id=version_id)
    )


def downgrade() -> None:
    conn = op.get_bind()
    slug = "system-default-assistant"
    assistant_id = conn.execute(
        sa.select(assistant_table.c.id).where(assistant_table.c.share_slug == slug)
    ).scalar_one_or_none()
    if not assistant_id:
        return
    conn.execute(sa.delete(assistant_version_table).where(assistant_version_table.c.assistant_id == assistant_id))
    conn.execute(sa.delete(assistant_table).where(assistant_table.c.id == assistant_id))
