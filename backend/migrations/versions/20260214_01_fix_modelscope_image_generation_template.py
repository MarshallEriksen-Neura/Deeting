"""fix modelscope image generation template rendering

Revision ID: 20260214_01_fix_modelscope_image_generation_template
Revises: 20260213_01_add_knowledge_folder_and_document_folder
Create Date: 2026-02-14
"""

from __future__ import annotations

import copy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260214_01_fix_modelscope_image_generation_template"
down_revision = "20260213_01_add_knowledge_folder_and_document_folder"
branch_labels = None
depends_on = None

PRESET_SLUG = "modelscope-standard"

OLD_BODY_TEMPLATE = {
    "model": "{{ model.uid }}",
    "prompt": "{{ input.prompt }}",
    "n": "{{ input.n | default(1) }}",
    "size": "{{ input.size }}",
    "parameters": "{{ input.extra_params | default({}) }}",
}

NEW_BODY_TEMPLATE = {
    "model": "{{ input.model or model.uid }}",
    "prompt": "{{ input.prompt }}",
    "n": "{{ (input.num_outputs or input.n or 1) | tojson }}",
    "size": "{{ (input.size if input.size else ((input.width ~ 'x' ~ input.height) if input.width and input.height else ('1280x720' if input.aspect_ratio == '16:9' else ('720x1280' if input.aspect_ratio == '9:16' else ('1152x864' if input.aspect_ratio == '4:3' else ('864x1152' if input.aspect_ratio == '3:4' else '1024x1024')))))) | tojson }}",
    "parameters": "{{ (input.extra_params or {}) | tojson }}",
}


def _update_image_template(
    capability_configs: dict,
    *,
    template_engine: str,
    body_template: dict,
) -> dict:
    updated = dict(capability_configs or {})
    image_cfg = dict(updated.get("image_generation") or {})

    image_cfg["template_engine"] = template_engine
    image_cfg["body_template"] = copy.deepcopy(body_template)
    # Keep request_template aligned with body_template for code paths that read either field.
    image_cfg["request_template"] = copy.deepcopy(body_template)

    updated["image_generation"] = image_cfg
    return updated


def upgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("slug", sa.String),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    row = conn.execute(
        sa.select(provider_preset.c.capability_configs).where(
            provider_preset.c.slug == PRESET_SLUG
        )
    ).fetchone()
    if not row:
        return

    current = row.capability_configs or {}
    if not isinstance(current, dict):
        return

    updated = _update_image_template(
        current,
        template_engine="jinja2",
        body_template=NEW_BODY_TEMPLATE,
    )

    conn.execute(
        provider_preset.update()
        .where(provider_preset.c.slug == PRESET_SLUG)
        .values(capability_configs=updated)
    )


def downgrade() -> None:
    conn = op.get_bind()

    provider_preset = sa.table(
        "provider_preset",
        sa.column("slug", sa.String),
        sa.column("capability_configs", postgresql.JSONB(astext_type=sa.Text())),
    )

    row = conn.execute(
        sa.select(provider_preset.c.capability_configs).where(
            provider_preset.c.slug == PRESET_SLUG
        )
    ).fetchone()
    if not row:
        return

    current = row.capability_configs or {}
    if not isinstance(current, dict):
        return

    updated = _update_image_template(
        current,
        template_engine="simple_replace",
        body_template=OLD_BODY_TEMPLATE,
    )

    conn.execute(
        provider_preset.update()
        .where(provider_preset.c.slug == PRESET_SLUG)
        .values(capability_configs=updated)
    )
