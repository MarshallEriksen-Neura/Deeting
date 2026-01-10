"""Drop sdk_vendor and fixed path columns, migrate to metadata.

Revision ID: 0068_drop_sdk_vendor_and_paths
Revises: 0067_create_agent_tasks_tables
Create Date: 2026-01-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0068_drop_sdk_vendor_and_paths"
down_revision = "0067_create_agent_tasks_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 将旧路径字段迁移到 metadata/endpoints_config 以便运行时兼容（可选轻量搬运）。
    # 由于历史数据量有限，这里用 SQL 更新，迁移到 metadata JSON 字段。

    # provider_presets: pack paths into metadata.capabilities.* if存在
    op.execute(
        sa.text(
            """
            UPDATE provider_presets
            SET metadata = COALESCE(metadata, '{}'::jsonb) || (
                jsonb_build_object(
                    'capabilities', jsonb_strip_nulls(jsonb_build_object(
                        'chat', jsonb_build_object('endpoint', chat_completions_path),
                        'messages', jsonb_build_object('endpoint', messages_path),
                        'response_stream', jsonb_build_object('endpoint', responses_path),
                        'image_generation', jsonb_build_object('endpoint', images_generations_path)
                    )),
                    'models', jsonb_strip_nulls(jsonb_build_object(
                        'list', jsonb_build_object('endpoint', models_path)
                    )),
                    'transport_adapter', sdk_vendor
                )
            )
            WHERE chat_completions_path IS NOT NULL
               OR messages_path IS NOT NULL
               OR responses_path IS NOT NULL
               OR images_generations_path IS NOT NULL
               OR models_path IS NOT NULL
               OR sdk_vendor IS NOT NULL;
            """
        )
    )

    # providers: 同样迁移
    op.execute(
        sa.text(
            """
            UPDATE providers
            SET metadata = COALESCE(metadata, '{}'::jsonb) || (
                jsonb_build_object(
                    'capabilities', jsonb_strip_nulls(jsonb_build_object(
                        'chat', jsonb_build_object('endpoint', chat_completions_path),
                        'messages', jsonb_build_object('endpoint', messages_path),
                        'response_stream', jsonb_build_object('endpoint', responses_path),
                        'image_generation', jsonb_build_object('endpoint', images_generations_path)
                    )),
                    'models', jsonb_strip_nulls(jsonb_build_object(
                        'list', jsonb_build_object('endpoint', models_path)
                    )),
                    'transport_adapter', sdk_vendor
                )
            )
            WHERE chat_completions_path IS NOT NULL
               OR messages_path IS NOT NULL
               OR responses_path IS NOT NULL
               OR images_generations_path IS NOT NULL
               OR models_path IS NOT NULL
               OR sdk_vendor IS NOT NULL;
            """
        )
    )

    # 2) 删除列
    with op.batch_alter_table("provider_presets") as batch:
        batch.drop_column("sdk_vendor")
        batch.drop_column("chat_completions_path")
        batch.drop_column("messages_path")
        batch.drop_column("responses_path")
        batch.drop_column("images_generations_path")
        batch.drop_column("models_path")

    with op.batch_alter_table("providers") as batch:
        batch.drop_column("sdk_vendor")
        batch.drop_column("chat_completions_path")
        batch.drop_column("messages_path")
        batch.drop_column("responses_path")
        batch.drop_column("images_generations_path")
        batch.drop_column("models_path")


def downgrade() -> None:
    # 恢复列，但无法完全还原迁移前的原子字段，仍保留 metadata 中的备份。
    with op.batch_alter_table("provider_presets") as batch:
        batch.add_column(sa.Column("models_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("images_generations_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("responses_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("messages_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("chat_completions_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("sdk_vendor", sa.String(length=32), nullable=True))

    with op.batch_alter_table("providers") as batch:
        batch.add_column(sa.Column("models_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("images_generations_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("responses_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("messages_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("chat_completions_path", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("sdk_vendor", sa.String(length=32), nullable=True))

    # 逆迁移：尝试从 metadata 回填原列（若存在）。
    op.execute(
        sa.text(
            """
            UPDATE provider_presets
            SET models_path = metadata->'models'->'list'->>'endpoint',
                chat_completions_path = metadata->'capabilities'->'chat'->>'endpoint',
                messages_path = metadata->'capabilities'->'messages'->>'endpoint',
                responses_path = metadata->'capabilities'->'response_stream'->>'endpoint',
                images_generations_path = metadata->'capabilities'->'image_generation'->>'endpoint',
                sdk_vendor = metadata->>'transport_adapter'
            WHERE metadata IS NOT NULL;
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE providers
            SET models_path = metadata->'models'->'list'->>'endpoint',
                chat_completions_path = metadata->'capabilities'->'chat'->>'endpoint',
                messages_path = metadata->'capabilities'->'messages'->>'endpoint',
                responses_path = metadata->'capabilities'->'response_stream'->>'endpoint',
                images_generations_path = metadata->'capabilities'->'image_generation'->>'endpoint',
                sdk_vendor = metadata->>'transport_adapter'
            WHERE metadata IS NOT NULL;
            """
        )
    )

