"""seed skill and assistant onboarding skills

Revision ID: seed_more_onboarding_skills
Revises: seed_provider_onboarding
Create Date: 2026-02-06
"""

from __future__ import annotations

import json
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "seed_more_onboarding_skills"
down_revision = "seed_provider_onboarding"
branch_labels = None
depends_on = None

SKILL_ONBOARDING_ID = "system.skill_onboarding"
ASSISTANT_ONBOARDING_ID = "system.assistant_onboarding"

SKILL_MANIFEST = {
    "name": "AI Skill Onboarding",
    "description": "自动化 AI 技能接入。给定一个包含技能源码的 Git 仓库 URL，自动完成克隆、解析、生成 Manifest 并注册到技能库中。",
    "entrypoint": "app.tasks.skill_registry:ingest_skill_repo",
    "io_schema": {
        "type": "object",
        "properties": {
            "repo_url": {
                "type": "string",
                "description": "技能 Git 仓库地址 (例如: https://github.com/example/my-skill)"
            },
            "revision": {
                "type": "string",
                "description": "Git 分支或提交号",
                "default": "main"
            },
            "runtime_hint": {
                "type": "string",
                "description": "运行时提示",
                "enum": ["python_library", "node_library", "opensandbox"],
                "default": "python_library"
            }
        },
        "required": ["repo_url"]
    }
}

ASSISTANT_MANIFEST = {
    "name": "AI Assistant Onboarding",
    "description": "自动化 AI 助手接入。通过爬取一个介绍 AI 助手的网页 URL，自动提取其人格、提示词、工具需求等信息，并创建一个可立即使用的 Assistant。",
    "entrypoint": "app.tasks.assistant:run_assistant_onboarding",
    "io_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "介绍 AI 助手的网页地址或文档地址"
            }
        },
        "required": ["url"]
    }
}

def upgrade() -> None:
    # 1. Add Skill Onboarding
    op.execute(sa.text(f"""
        INSERT INTO skill_registry (
            id, name, type, runtime, version, description, 
            manifest_json, status, created_at, updated_at
        )
        VALUES (
            '{SKILL_ONBOARDING_ID}', 
            'AI Skill Onboarding', 
            'SKILL', 
            'backend_task', 
            '1.0.0', 
            '自动化 AI 技能仓库接入',
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
    """).bindparams(manifest=json.dumps(SKILL_MANIFEST)))

    # 2. Add Assistant Onboarding
    op.execute(sa.text(f"""
        INSERT INTO skill_registry (
            id, name, type, runtime, version, description, 
            manifest_json, status, created_at, updated_at
        )
        VALUES (
            '{ASSISTANT_ONBOARDING_ID}', 
            'AI Assistant Onboarding', 
            'SKILL', 
            'backend_task', 
            '1.0.0', 
            '自动化 AI 助手人格接入',
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
    """).bindparams(manifest=json.dumps(ASSISTANT_MANIFEST)))

def downgrade() -> None:
    op.execute(sa.text(f"DELETE FROM skill_registry WHERE id IN ('{SKILL_ONBOARDING_ID}', '{ASSISTANT_ONBOARDING_ID}')"))
