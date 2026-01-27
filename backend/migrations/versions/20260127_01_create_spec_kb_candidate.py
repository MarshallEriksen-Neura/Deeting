"""create spec knowledge candidate table

Revision ID: 20260127_01_create_spec_kb_candidate
Revises: 20260126_02_add_spec_plan_conversation_session
Create Date: 2026-01-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260127_01_create_spec_kb_candidate"
down_revision: Union[str, None] = "20260126_02_add_spec_plan_conversation_session"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "spec_kb_candidate",
        sa.Column(
            "canonical_hash",
            sa.String(length=64),
            nullable=False,
            comment="规范化哈希（去重）",
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
            comment="触发候选的用户 ID",
        ),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("spec_plan.id", ondelete="SET NULL"),
            nullable=True,
            comment="来源 Plan ID",
        ),
        sa.Column(
            "manifest_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="原始 Spec Manifest",
        ),
        sa.Column(
            "normalized_manifest",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="规范化 Manifest（用于 Hash/Embedding）",
        ),
        sa.Column(
            "status",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'pending_signal'"),
            comment="pending_signal/pending_eval/pending_review/approved/rejected/disabled",
        ),
        sa.Column(
            "positive_feedback",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="正向反馈计数",
        ),
        sa.Column(
            "negative_feedback",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="负向反馈计数",
        ),
        sa.Column(
            "apply_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="应用/采纳计数",
        ),
        sa.Column(
            "revert_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="回滚次数",
        ),
        sa.Column(
            "error_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="错误次数",
        ),
        sa.Column(
            "total_runs",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="总运行次数",
        ),
        sa.Column(
            "success_runs",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="成功运行次数",
        ),
        sa.Column(
            "session_hashes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="触发过的会话哈希集合",
        ),
        sa.Column(
            "eval_static_pass",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="静态规则是否通过",
        ),
        sa.Column(
            "eval_llm_score",
            sa.Integer(),
            nullable=True,
            comment="LLM 评分（0-100）",
        ),
        sa.Column(
            "eval_reason",
            sa.Text(),
            nullable=True,
            comment="评估原因/说明",
        ),
        sa.Column(
            "eval_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="评估快照（静态 + LLM）",
        ),
        sa.Column(
            "trust_weight",
            sa.Float(),
            nullable=False,
            server_default="1.0",
            comment="贡献者/采纳者信任权重",
        ),
        sa.Column(
            "exploration_tag",
            sa.String(length=32),
            nullable=True,
            comment="探索/高热度标签",
        ),
        sa.Column(
            "last_positive_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近正向反馈时间",
        ),
        sa.Column(
            "last_negative_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近负向反馈时间",
        ),
        sa.Column(
            "last_applied_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近应用时间",
        ),
        sa.Column(
            "last_reverted_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近回滚时间",
        ),
        sa.Column(
            "last_eval_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="最近评估时间",
        ),
        sa.Column(
            "promoted_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="晋升时间",
        ),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_spec_kb_candidate_hash", "spec_kb_candidate", ["canonical_hash"], unique=True)
    op.create_index("ix_spec_kb_candidate_status", "spec_kb_candidate", ["status"])


def downgrade() -> None:
    op.drop_index("ix_spec_kb_candidate_status", table_name="spec_kb_candidate")
    op.drop_index("ix_spec_kb_candidate_hash", table_name="spec_kb_candidate")
    op.drop_table("spec_kb_candidate")
