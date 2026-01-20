"""seed modelscope preset

Revision ID: 20260120_07_seed_modelscope_preset
Revises: 20260120_06_update_provider_model_capabilities
Create Date: 2026-01-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json

# revision identifiers, used by Alembic.
revision = "20260120_07_seed_modelscope_preset"
down_revision = "20260120_06_update_provider_model_capabilities"
branch_labels = None
depends_on = None

MODELSCOPE_PRESET = {
    "name": "ModelScope Standard",
    "slug": "modelscope-standard",
    "provider": "modelscope",
    "icon": "https://img.alicdn.com/imgextra/i2/O1CN01j4k2j41j4k2j4k2j4_!!6000000004495-2-tps-200-200.png", # Placeholder or real
    "theme_color": "#624AFF",
    "category": "Cloud API",
    "base_url": "https://api-inference.modelscope.cn/",
    "auth_type": "bearer",
    "auth_config": {"header": "Authorization"},
    "capability_configs": {
        "image_generation": {
            "enabled": True,
            "request_route": "v1/images/generations",
            "http_method": "POST",
            "headers": {
                "Authorization": "Bearer {{ credentials.api_key }}",
                "Content-Type": "application/json",
                "X-ModelScope-Async-Mode": "true"
            },
            "body_template": {
                "model": "{{ model.uid }}",
                "prompt": "{{ input.prompt }}",
                "n": "{{ input.n | default(1) }}",
                "size": "{{ input.size }}",
                "parameters": "{{ input.extra_params | default({}) }}" 
            },
            "async_flow": {
                "enabled": True,
                "task_id_extraction": {
                    "location": "body",
                    "key_path": "task_id"
                },
                "poll": {
                    "url_template": "{{ base_url }}v1/tasks/{{ task_id }}",
                    "method": "GET",
                    "headers": {
                        "Authorization": "Bearer {{ credentials.api_key }}",
                        "X-ModelScope-Task-Type": "image_generation"
                    },
                    "status_check": {
                        "location": "body.task_status",
                        "success_values": ["SUCCEED"],
                        "fail_values": ["FAILED", "CANCELED"],
                        "pending_values": ["PENDING", "RUNNING", "QUEUED"]
                    },
                    "interval": 5,
                    "timeout": 300
                },
                "result_extraction": {
                    "location": "body.output_images",
                    "format": "url_list"
                }
            }
        }
    }
}

def upgrade() -> None:
    conn = op.get_bind()
    
    # 1. Check if preset exists
    provider_preset = sa.table(
        "provider_preset",
        sa.column("id", postgresql.UUID(as_uuid=True)), 
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("provider", sa.String),
        sa.column("base_url", sa.String),
        sa.column("auth_type", sa.String),
        sa.column("capability_configs", postgresql.JSONB),
        sa.column("is_active", sa.Boolean),
        sa.column("version", sa.Integer),
        # Add other required cols to avoid error if insert
        sa.column("icon", sa.String),
        sa.column("auth_config", postgresql.JSONB),
        sa.column("default_headers", postgresql.JSONB),
        sa.column("default_params", postgresql.JSONB),
    )
    
    # Check if exists
    # We can use slug as unique key
    existing = conn.execute(
        sa.select(provider_preset.c.id).where(provider_preset.c.slug == MODELSCOPE_PRESET["slug"])
    ).fetchone()
    
    if existing:
        # Update
        conn.execute(
            provider_preset.update()
            .where(provider_preset.c.slug == MODELSCOPE_PRESET["slug"])
            .values(
                capability_configs=MODELSCOPE_PRESET["capability_configs"],
                base_url=MODELSCOPE_PRESET["base_url"],
                auth_type=MODELSCOPE_PRESET["auth_type"],
            )
        )
    else:
        # Insert
        # Need to generate UUID if it's UUID PK
        import uuid
        conn.execute(
            provider_preset.insert().values(
                id=uuid.uuid4(),
                name=MODELSCOPE_PRESET["name"],
                slug=MODELSCOPE_PRESET["slug"],
                provider=MODELSCOPE_PRESET["provider"],
                icon=MODELSCOPE_PRESET["icon"],
                base_url=MODELSCOPE_PRESET["base_url"],
                auth_type=MODELSCOPE_PRESET["auth_type"],
                auth_config=MODELSCOPE_PRESET["auth_config"],
                default_headers={},
                default_params={},
                capability_configs=MODELSCOPE_PRESET["capability_configs"],
                version=1,
                is_active=True
            )
        )

def downgrade() -> None:
    # We don't remove the data in downgrade usually, unless strictly required.
    pass
