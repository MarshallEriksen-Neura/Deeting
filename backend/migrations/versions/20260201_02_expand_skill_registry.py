"""expand skill registry

Revision ID: 20260201_02_expand_skill_registry
Revises: 20260201_01_add_skill_registry
Create Date: 2026-02-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260201_02_expand_skill_registry"
down_revision: Union[str, None] = "20260201_01_add_skill_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type(dialect_name: str):
    return postgresql.JSONB(astext_type=sa.Text()) if dialect_name == "postgresql" else sa.JSON()


def _json_default(dialect_name: str):
    return sa.text("'{}'::jsonb") if dialect_name == "postgresql" else sa.text("'{}'")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else "postgresql"
    json_type = _json_type(dialect)
    json_default = _json_default(dialect)

    op.add_column(
        "skill_registry",
        sa.Column(
            "type",
            sa.String(length=20),
            nullable=False,
            server_default="SKILL",
            comment="资源类型: SKILL",
        ),
    )
    op.add_column(
        "skill_registry",
        sa.Column("runtime", sa.String(length=40), nullable=True, comment="运行时类型（如 opensandbox）"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("version", sa.String(length=32), nullable=True, comment="语义化版本号"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("description", sa.Text(), nullable=True, comment="技能描述"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("source_repo", sa.String(length=1024), nullable=True, comment="源码仓库地址"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("source_subdir", sa.String(length=255), nullable=True, comment="源码子目录"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("source_revision", sa.String(length=128), nullable=True, comment="源码版本/提交"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("risk_level", sa.String(length=20), nullable=True, comment="风险等级"),
    )
    op.add_column(
        "skill_registry",
        sa.Column("complexity_score", sa.Float(), nullable=True, comment="复杂度评分"),
    )
    op.add_column(
        "skill_registry",
        sa.Column(
            "manifest_json",
            json_type,
            nullable=False,
            server_default=json_default,
            comment="技能清单/Manifest",
        ),
    )
    op.add_column(
        "skill_registry",
        sa.Column(
            "env_requirements",
            json_type,
            nullable=False,
            server_default=json_default,
            comment="运行环境依赖",
        ),
    )
    op.add_column(
        "skill_registry",
        sa.Column("vector_id", sa.String(length=120), nullable=True, comment="向量索引 ID"),
    )

    op.create_table(
        "skill_capability",
        sa.Column(
            "skill_id",
            sa.String(length=120),
            sa.ForeignKey("skill_registry.id", ondelete="CASCADE"),
            primary_key=True,
            comment="技能 ID",
        ),
        sa.Column(
            "value",
            sa.String(length=128),
            primary_key=True,
            comment="能力标识",
        ),
    )
    op.create_table(
        "skill_dependency",
        sa.Column(
            "skill_id",
            sa.String(length=120),
            sa.ForeignKey("skill_registry.id", ondelete="CASCADE"),
            primary_key=True,
            comment="技能 ID",
        ),
        sa.Column(
            "value",
            sa.String(length=128),
            primary_key=True,
            comment="依赖技能标识",
        ),
    )
    op.create_table(
        "skill_artifact",
        sa.Column(
            "skill_id",
            sa.String(length=120),
            sa.ForeignKey("skill_registry.id", ondelete="CASCADE"),
            primary_key=True,
            comment="技能 ID",
        ),
        sa.Column(
            "value",
            sa.String(length=128),
            primary_key=True,
            comment="产物标识",
        ),
    )


def downgrade() -> None:
    op.drop_table("skill_artifact")
    op.drop_table("skill_dependency")
    op.drop_table("skill_capability")

    op.drop_column("skill_registry", "vector_id")
    op.drop_column("skill_registry", "env_requirements")
    op.drop_column("skill_registry", "manifest_json")
    op.drop_column("skill_registry", "complexity_score")
    op.drop_column("skill_registry", "risk_level")
    op.drop_column("skill_registry", "source_revision")
    op.drop_column("skill_registry", "source_subdir")
    op.drop_column("skill_registry", "source_repo")
    op.drop_column("skill_registry", "description")
    op.drop_column("skill_registry", "version")
    op.drop_column("skill_registry", "runtime")
    op.drop_column("skill_registry", "type")
