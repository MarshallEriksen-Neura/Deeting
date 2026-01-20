"""normalize provider_model.capabilities legacy values

Revision ID: 20260120_09_normalize_provider_model_capabilities
Revises: 20260120_08_backfill_preset_capability_configs_audio_video
Create Date: 2026-01-20 22:05:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_09_normalize_provider_model_capabilities"
down_revision = "20260120_08_backfill_preset_capability_configs_audio_video"
branch_labels = None
depends_on = None


def _normalize_caps(raw_caps: list[str] | None) -> list[str]:
    if not raw_caps:
        return ["chat"]
    normalized: list[str] = []
    for cap in raw_caps:
        if not cap:
            continue
        cap_norm = str(cap).lower().strip()
        if cap_norm == "image":
            cap_norm = "image_generation"
        elif cap_norm == "audio":
            cap_norm = "speech_to_text"
        elif cap_norm in {"code", "reasoning", "vision"}:
            cap_norm = "chat"
        if cap_norm and cap_norm not in normalized:
            normalized.append(cap_norm)
    return normalized or ["chat"]


def upgrade() -> None:
    conn = op.get_bind()

    provider_model = sa.table(
        "provider_model",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("capabilities", postgresql.ARRAY(sa.String(length=32))),
    )

    rows = conn.execute(
        sa.select(provider_model.c.id, provider_model.c.capabilities)
    ).fetchall()

    for row in rows:
        current = list(row.capabilities or [])
        updated = _normalize_caps(current)
        if updated == current:
            continue
        conn.execute(
            provider_model.update()
            .where(provider_model.c.id == row.id)
            .values(capabilities=updated)
        )


def downgrade() -> None:
    # 归一化是不可逆的（code/reasoning/vision/audio 被合并），保持现状即可。
    pass
