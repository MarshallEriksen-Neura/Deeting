"""seed integration specialist assistant

Revision ID: seed_integration_specialist
Revises: 6c16a8399765
Create Date: 2026-01-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "seed_integration_specialist"
down_revision = "6c16a8399765"
branch_labels = None
depends_on = None

ASSISTANT_ID = "00000000-0000-0000-0000-000000000001"  # Fixed ID for system specialists
VERSION_ID = "00000000-0000-0000-0000-000000000002"

SYSTEM_PROMPT = """Role: AI Integration Specialist
Objective: Automate the onboarding of new AI Provider APIs into the Deeting OS registry.

Capabilities:
1. **Analyze Docs**: Use `crawl_website` to read API documentation URLs. Understand authentication, endpoints, and schemas.
2. **Draft Configuration**: Map external API fields to the internal standard schemas using Jinja2 templates.
3. **Verify First**: NEVER save a configuration without verification. Use `verify_provider_template` with a real TEST API KEY from the user.
4. **Self-Correct**: If verification fails, analyze the error and fix the template draft.
5. **Commit**: Only call `save_provider_field_mapping` when verification is SUCCESSFUL.

Workflow:
1. Ask the user for the Provider Name and Documentation URL.
2. Call `crawl_website` to read the docs.
3. Ask the user for a TEST API KEY.
4. Call `get_unified_schema` to see what the target mapping should look like.
5. Draft and test the mapping using `verify_provider_template`.
6. Once verified, call `save_provider_field_mapping`.
7. Confirm status to the user.

Safety:
- NEVER reveal the user's API Key in chat messages.
- Always follow official documentation precisely.
"""


def upgrade() -> None:
    # 1. Insert Assistant Main Record
    op.execute(sa.text(f"""
            INSERT INTO assistant (id, visibility, status, summary, icon_id, created_at, updated_at)
            VALUES ('{ASSISTANT_ID}', 'private', 'published', 'AI 厂商自动对接专家', 'lucide:plug-zap', now(), now())
            ON CONFLICT DO NOTHING
        """))

    # 2. Insert Assistant Version (The Prompt and Skills)
    # We mount 'core.tools.crawler' and 'core.registry.provider'
    op.execute(sa.text(f"""
            INSERT INTO assistant_version (
                id, assistant_id, version, name, description, system_prompt, 
                skill_refs, model_config, created_at, updated_at
            )
            VALUES (
                '{VERSION_ID}', 
                '{ASSISTANT_ID}', 
                '1.0.0', 
                'Integration Specialist', 
                '专门负责爬取文档、自动写配置、对接新 AI 厂商的专家。',
                :prompt,
                '[
                    {{"skill_id": "core.tools.crawler", "version": "latest"}},
                    {{"skill_id": "core.registry.provider", "version": "latest"}}
                ]',
                '{{"model": "gpt-4o", "temperature": 0.1}}',
                now(), 
                now()
            )
            ON CONFLICT DO NOTHING
        """).bindparams(prompt=SYSTEM_PROMPT))

    # 3. Set Current Version
    op.execute(
        sa.text(
            f"UPDATE assistant SET current_version_id = '{VERSION_ID}' WHERE id = '{ASSISTANT_ID}'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(f"DELETE FROM assistant_version WHERE assistant_id = '{ASSISTANT_ID}'")
    )
    op.execute(sa.text(f"DELETE FROM assistant WHERE id = '{ASSISTANT_ID}'"))
