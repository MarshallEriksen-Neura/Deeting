"""backfill provider_preset capability_configs (text_to_speech/speech_to_text/video_generation)

Revision ID: 20260120_08_backfill_preset_capability_configs_audio_video
Revises: 20260120_07_seed_modelscope_preset
Create Date: 2026-01-20 21:40:00
"""

from __future__ import annotations

import copy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260120_08_backfill_preset_capability_configs_audio_video"
down_revision = "20260120_07_seed_modelscope_preset"
branch_labels = None
depends_on = None


TEMPLATE_TTS = {
    "model": None,
    "input": None,
    "voice": None,
    "speed": None,
    "pitch": None,
    "volume": None,
    "stability": None,
    "similarity_boost": None,
    "style_exaggeration": None,
    "response_format": None,
    "extra_params": None,
    "provider_model_id": None,
    "session_id": None,
    "request_id": None,
}

TEMPLATE_STT = {
    "model": None,
    "audio_data": None,
    "language": None,
    "prompt": None,
    "temperature": None,
    "response_format": None,
    "timestamp_granularities": None,
    "extra_params": None,
    "provider_model_id": None,
    "session_id": None,
    "request_id": None,
}

TEMPLATE_VIDEO = {
    "model": None,
    "prompt": None,
    "image_url": None,
    "width": None,
    "height": None,
    "duration_seconds": None,
    "fps": None,
    "motion_bucket_id": None,
    "noise_aug_strength": None,
    "seed": None,
    "extra_params": None,
    "provider_model_id": None,
    "session_id": None,
    "request_id": None,
}

DEFAULT_TTS_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_TTS,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
    "http_method": "POST",
}

DEFAULT_STT_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_STT,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
    "http_method": "POST",
}

DEFAULT_VIDEO_CONFIG = {
    "template_engine": "simple_replace",
    "request_template": TEMPLATE_VIDEO,
    "response_transform": {},
    "default_headers": {},
    "default_params": {},
    "async_config": {},
    "http_method": "POST",
}


def upgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    rows = conn.execute(
        sa.select(provider_preset.c.id, provider_preset.c.capability_configs)
    ).fetchall()

    for row in rows:
        current = row.capability_configs or {}
        updated = dict(current)
        changed = False

        if "text_to_speech" not in updated:
            updated["text_to_speech"] = copy.deepcopy(DEFAULT_TTS_CONFIG)
            changed = True
        if "speech_to_text" not in updated:
            updated["speech_to_text"] = copy.deepcopy(DEFAULT_STT_CONFIG)
            changed = True
        if "video_generation" not in updated:
            updated["video_generation"] = copy.deepcopy(DEFAULT_VIDEO_CONFIG)
            changed = True

        if changed:
            conn.execute(
                provider_preset.update()
                .where(provider_preset.c.id == row.id)
                .values(capability_configs=updated)
            )


def downgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    rows = conn.execute(
        sa.select(provider_preset.c.id, provider_preset.c.capability_configs)
    ).fetchall()

    for row in rows:
        current = row.capability_configs or {}
        updated = dict(current)
        updated.pop("text_to_speech", None)
        updated.pop("speech_to_text", None)
        updated.pop("video_generation", None)
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.id == row.id)
            .values(capability_configs=updated)
        )
