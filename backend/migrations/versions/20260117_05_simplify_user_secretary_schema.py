"""simplify user secretary schema

Revision ID: 20260117_05_simplify_user_secretary_schema
Revises: 20260117_04_fix_custom_http_preset_slug
Create Date: 2026-01-17
"""

from alembic import op
import sqlalchemy as sa

revision = "20260117_05_simplify_user_secretary_schema"
down_revision = "20260117_04_fix_custom_http_preset_slug"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("user_secretary"):
        existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
        for column in (
            "current_phase_id",
            "custom_instructions",
            "embedding_model",
            "topic_naming_model",
            "ui_preferences",
        ):
            if column in existing_columns:
                op.drop_column("user_secretary", column)

    if inspector.has_table("secretary_phase"):
        op.drop_table("secretary_phase")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("secretary_phase"):
        op.create_table(
            "secretary_phase",
            sa.Column(
                "name",
                sa.String(length=50),
                nullable=False,
                comment="Phase Name (e.g. 'alpha', 'v1')",
            ),
            sa.Column("description", sa.Text(), nullable=True, comment="Internal description"),
            sa.Column(
                "enable_retrieval",
                sa.Boolean(),
                nullable=False,
                comment="Enable RAG/Qdrant Retrieval",
            ),
            sa.Column(
                "enable_ingest",
                sa.Boolean(),
                nullable=False,
                comment="Enable Memory Ingestion",
            ),
            sa.Column(
                "enable_compression",
                sa.Boolean(),
                nullable=False,
                comment="Enable History Compression",
            ),
            sa.Column(
                "policy_config",
                sa.JSON(),
                nullable=False,
                comment="Detailed Policy Configuration",
            ),
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_secretary_phase_name"),
            "secretary_phase",
            ["name"],
            unique=True,
        )

    if inspector.has_table("user_secretary"):
        existing_columns = {col["name"] for col in inspector.get_columns("user_secretary")}
        if "current_phase_id" not in existing_columns:
            op.add_column(
                "user_secretary",
                sa.Column(
                    "current_phase_id",
                    sa.UUID(),
                    nullable=False,
                    comment="Current Capability Phase",
                ),
            )
            op.create_foreign_key(
                "user_secretary_current_phase_id_fkey",
                "user_secretary",
                "secretary_phase",
                ["current_phase_id"],
                ["id"],
            )
        if "custom_instructions" not in existing_columns:
            op.add_column(
                "user_secretary",
                sa.Column(
                    "custom_instructions",
                    sa.Text(),
                    nullable=True,
                    comment="User-defined system prompt additions",
                ),
            )
        if "embedding_model" not in existing_columns:
            op.add_column(
                "user_secretary",
                sa.Column(
                    "embedding_model",
                    sa.String(length=128),
                    nullable=True,
                    comment="秘书向量使用的 embedding 模型名称",
                ),
            )
        if "topic_naming_model" not in existing_columns:
            op.add_column(
                "user_secretary",
                sa.Column(
                    "topic_naming_model",
                    sa.String(length=128),
                    nullable=True,
                    comment="话题自动命名使用的模型名称",
                ),
            )
        if "ui_preferences" not in existing_columns:
            op.add_column(
                "user_secretary",
                sa.Column(
                    "ui_preferences",
                    sa.JSON(),
                    nullable=True,
                    comment="UI specific settings (avatar, theme)",
                ),
            )
