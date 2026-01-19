"""seed image models for openai-compatible instances

Revision ID: 20260119_02_seed_image_models_openai_compat
Revises: 20260119_01_create_image_generation_tables
Create Date: 2026-01-19 12:00:00
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260119_02_seed_image_models_openai_compat"
down_revision = "20260119_01_create_image_generation_tables"
branch_labels = None
depends_on = None


SEED_MARK = "20260119_02_seed_image_models_openai_compat"


provider_model = sa.table(
    "provider_model",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("instance_id", postgresql.UUID(as_uuid=True)),
    sa.column("capability", sa.String),
    sa.column("model_id", sa.String),
    sa.column("unified_model_id", sa.String),
    sa.column("display_name", sa.String),
    sa.column("upstream_path", sa.String),
    sa.column("template_engine", sa.String),
    sa.column("request_template", postgresql.JSONB),
    sa.column("response_transform", postgresql.JSONB),
    sa.column("pricing_config", postgresql.JSONB),
    sa.column("limit_config", postgresql.JSONB),
    sa.column("tokenizer_config", postgresql.JSONB),
    sa.column("routing_config", postgresql.JSONB),
    sa.column("source", sa.String),
    sa.column("extra_meta", postgresql.JSONB),
    sa.column("weight", sa.Integer),
    sa.column("priority", sa.Integer),
    sa.column("is_active", sa.Boolean),
    sa.column("synced_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    conn = op.get_bind()

    candidates = conn.execute(
        sa.select(
            provider_model.c.instance_id,
            provider_model.c.template_engine,
            provider_model.c.upstream_path,
        ).where(
            provider_model.c.capability == "chat",
            provider_model.c.template_engine.in_(["openai_compat", "simple_replace"]),
            provider_model.c.upstream_path.like("%chat/completions"),
        )
    ).fetchall()

    inserted_instances: set[str] = set()
    for row in candidates:
        instance_id = row.instance_id
        if not instance_id:
            continue
        if str(instance_id) in inserted_instances:
            continue

        exists = conn.execute(
            sa.select(provider_model.c.id).where(
                provider_model.c.instance_id == instance_id,
                provider_model.c.capability == "image",
            )
        ).scalar_one_or_none()
        if exists:
            inserted_instances.add(str(instance_id))
            continue

        upstream_path = row.upstream_path or ""
        if "/chat/completions" in upstream_path:
            upstream_path = upstream_path.replace("/chat/completions", "/images/generations")
        elif "chat/completions" in upstream_path:
            upstream_path = upstream_path.replace("chat/completions", "images/generations")
        if not upstream_path:
            inserted_instances.add(str(instance_id))
            continue

        payload = {
            "id": uuid.uuid4(),
            "instance_id": instance_id,
            "capability": "image",
            "model_id": "gpt-image-1",
            "unified_model_id": "gpt-image-1",
            "display_name": "GPT Image",
            "upstream_path": upstream_path,
            "template_engine": row.template_engine or "openai_compat",
            "request_template": {},
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "tokenizer_config": {},
            "routing_config": {},
            "source": "manual",
            "extra_meta": {"seeded_by": SEED_MARK},
            "weight": 100,
            "priority": 0,
            "is_active": True,
            "synced_at": None,
        }
        conn.execute(sa.insert(provider_model).values(payload))
        inserted_instances.add(str(instance_id))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        provider_model.delete().where(
            provider_model.c.capability == "image",
            provider_model.c.model_id == "gpt-image-1",
            provider_model.c.extra_meta.contains({"seeded_by": SEED_MARK}),
        )
    )
