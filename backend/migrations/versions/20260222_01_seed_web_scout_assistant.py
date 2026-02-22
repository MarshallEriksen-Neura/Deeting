"""seed web scout and skill learner assistant

Revision ID: seed_web_scout_assistant
Revises: 20260214_01_fix_modelscope_image_generation_template
Create Date: 2026-02-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "seed_web_scout_assistant"
down_revision = "20260214_01_fix_modelscope_image_generation_template"
branch_labels = None
depends_on = None

SCOUT_ASSISTANT_ID = "00000000-0000-0000-0000-000000000005"  # Unique ID for Scout
VERSION_ID = "00000000-0000-0000-0000-000000000006"

SYSTEM_PROMPT = """Role: Web Scout & Skill Learner
Objective: Crawl external websites, documentation, or prompt repositories and convert them into structured system capabilities.

Capabilities:
1. **Deep Crawl**: Use `crawl_website` to recursively read a target URL.
2. **Knowledge Ingestion**: Capture and store information into the system's review buffer.
3. **Skill Conversion**: Use `convert_artifact_to_assistant` to refine crawled data and create a permanent AI Assistant/Skill.

Workflow:
1. When a user provides a URL (e.g., GitHub prompt repo, documentation site), call `crawl_website`.
2. Once the crawl is complete, use the returned artifact IDs to call `convert_artifact_to_assistant`.
3. Inform the user when the new capability has been successfully learned and registered.

Guidelines:
- Always aim for a 'full lifecycle' (Crawl -> Convert).
- If the content contains characters, roles, or specific prompts, convert them immediately.
"""

def upgrade() -> None:
    # 1. Register the skill in skill_registry (if not exists)
    op.execute(sa.text("""
        INSERT INTO skill_registry (id, name, type, description, status, created_at, updated_at)
        VALUES (
            'core.tools.crawler', 
            'Scout Crawler', 
            'SKILL', 
            'Web crawling and documentation learning capability.', 
            'active', 
            now(), 
            now()
        )
        ON CONFLICT (id) DO UPDATE SET status = 'active';
    """))

    # 2. Insert Assistant Main Record
    op.execute(sa.text(f"""
        INSERT INTO assistant (id, visibility, status, summary, icon_id, created_at, updated_at)
        VALUES ('{SCOUT_ASSISTANT_ID}', 'public', 'published', '网页抓取与技能学习专家', 'lucide:search-code', now(), now())
        ON CONFLICT DO NOTHING
    """))

    # 3. Insert Assistant Version
    op.execute(sa.text(f"""
        INSERT INTO assistant_version (
            id, assistant_id, version, name, description, system_prompt, 
            skill_refs, model_config, created_at, updated_at
        )
        VALUES (
            '{VERSION_ID}', 
            '{SCOUT_ASSISTANT_ID}', 
            '1.0.0', 
            'System Scout', 
            '负责抓取外部知识并将其自动化转化为系统助手的核心专家。',
            :prompt,
            '[
                {{"skill_id": "core.tools.crawler", "version": "latest"}}
            ]',
            '{{"model": "Kimi-K2", "temperature": 0.1}}',
            now(), 
            now()
        )
        ON CONFLICT DO NOTHING
    """).bindparams(prompt=SYSTEM_PROMPT))

    # 4. Set Current Version
    op.execute(
        sa.text(
            f"UPDATE assistant SET current_version_id = '{VERSION_ID}' WHERE id = '{SCOUT_ASSISTANT_ID}'"
        )
    )

def downgrade() -> None:
    op.execute(sa.text(f"DELETE FROM assistant_version WHERE assistant_id = '{SCOUT_ASSISTANT_ID}'"))
    op.execute(sa.text(f"DELETE FROM assistant WHERE id = SCOUT_ASSISTANT_ID"))
    # We don't delete the skill_registry entry as it might be used elsewhere
