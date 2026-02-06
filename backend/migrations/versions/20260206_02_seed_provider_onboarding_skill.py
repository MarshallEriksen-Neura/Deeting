"""seed provider onboarding skill

Revision ID: seed_provider_onboarding
Revises: 20260206_01
Create Date: 2026-02-06
"""

from __future__ import annotations

import json
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "seed_provider_onboarding"
down_revision = "20260206_01"
branch_labels = None
depends_on = None

SKILL_ID = "system.provider_onboarding"

MANIFEST = {
    "name": "AI Provider Onboarding",
    "description": "自动化 AI 厂商接入技能。通过爬取官方 API 文档 URL，自动分析并生成请求模板、响应转换等配置，最终保存到 Provider Preset 注册表中。",
    "entrypoint": "app.tasks.agent:run_discovery_task",
    "io_schema": {
        "type": "object",
        "properties": {
            "target_url": {
                "type": "string",
                "description": "厂商官方 API 文档地址 (例如: https://open.bigmodel.cn/dev/api#sdk)"
            },
            "capability": {
                "type": "string",
                "description": "要接入的能力类型",
                "enum": ["chat", "image_generation", "video_generation"],
                "default": "chat"
            },
            "provider_name_hint": {
                "type": "string",
                "description": "厂商名称提示 (例如: '智谱AI')"
            }
        },
        "required": ["target_url"]
    }
}

def upgrade() -> None:
    op.execute(sa.text(f"""
        INSERT INTO skill_registry (
            id, name, type, runtime, version, description, 
            manifest_json, status, created_at, updated_at
        )
        VALUES (
            '{SKILL_ID}', 
            'AI Provider Onboarding', 
            'SKILL', 
            'backend_task', 
            '1.0.0', 
            '自动化 AI 厂商接入与配置',
            CAST(:manifest AS JSONB),
            'active',
            now(), 
            now()
        )
        ON CONFLICT (id) DO UPDATE SET
            manifest_json = EXCLUDED.manifest_json,
            runtime = EXCLUDED.runtime,
            status = 'active',
            updated_at = now()
    """).bindparams(manifest=json.dumps(MANIFEST)))

def downgrade() -> None:
    op.execute(sa.text(f"DELETE FROM skill_registry WHERE id = '{SKILL_ID}'"))
