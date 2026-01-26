"""create spec agent tables

Revision ID: 20260126_01_create_spec_agent_tables
Revises: 20260121_03_rename_generation_task_table
Create Date: 2026-01-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260126_01_create_spec_agent_tables"
down_revision: Union[str, None] = "20260121_03_rename_generation_task_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "spec_plan",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.id", ondelete="CASCADE"),
            nullable=False,
            comment="任务发起人",
        ),
        sa.Column("project_name", sa.String(length=200), nullable=False, comment="任务/项目名称"),
        sa.Column(
            "manifest_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="完整的 DAG 蓝图结构 (Nodes, Edges, Rules)",
        ),
        sa.Column(
            "current_context",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="全局变量池 (Context Snapshot)",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'DRAFT'"),
            comment="执行状态: DRAFT, RUNNING, PAUSED, COMPLETED, FAILED",
        ),
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default="1",
            comment="蓝图版本号 (Re-plan 时递增)",
        ),
        sa.Column(
            "priority",
            sa.SmallInteger(),
            nullable=False,
            server_default="0",
            comment="调度优先级 (越大越高)",
        ),
        sa.Column(
            "execution_config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="执行策略 (max_retries, timeout, cache_policy等)",
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
    op.create_index("ix_spec_plan_user", "spec_plan", ["user_id"])
    op.create_index("ix_spec_plan_status", "spec_plan", ["status"])

    op.create_table(
        "spec_execution_log",
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("spec_plan.id", ondelete="CASCADE"),
            nullable=False,
            comment="所属 Plan ID",
        ),
        sa.Column(
            "node_id",
            sa.String(length=100),
            nullable=False,
            comment="DAG 中的节点 ID (e.g. T1_Search)",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'PENDING'"),
            comment="节点状态: PENDING, RUNNING, SUCCESS, FAILED, SKIPPED, WAITING_APPROVAL",
        ),
        sa.Column(
            "input_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="执行时的入参快照 (Resolved Args)",
        ),
        sa.Column(
            "raw_response",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Worker/Tool 的原始返回 (用于 Debug/人工修复)",
        ),
        sa.Column(
            "output_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="清洗后的结构化结果 (供下游消费)",
        ),
        sa.Column(
            "worker_info",
            sa.String(length=255),
            nullable=True,
            comment="执行者标识 (e.g. GenericWorker/Kimi-K2)",
        ),
        sa.Column(
            "worker_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="执行时的 Prompt/Config 备份",
        ),
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="重试次数",
        ),
        sa.Column("error_message", sa.Text(), nullable=True, comment="错误信息"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True, comment="开始执行时间"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True, comment="完成/失败时间"),
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
    op.create_index("ix_spec_log_plan_node", "spec_execution_log", ["plan_id", "node_id"])
    op.create_index("ix_spec_log_status", "spec_execution_log", ["status"])

    op.create_table(
        "spec_worker_session",
        sa.Column(
            "log_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("spec_execution_log.id", ondelete="CASCADE"),
            nullable=False,
            comment="关联的执行日志节点",
        ),
        sa.Column(
            "internal_messages",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="内部对话历史 (Role: system/user/assistant/tool)",
        ),
        sa.Column(
            "thought_trace",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
            comment="思维链路摘要/步骤 (Step 1, Step 2...)",
        ),
        sa.Column(
            "total_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="本次会话消耗 Token 数",
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
    op.create_index("ix_spec_session_log", "spec_worker_session", ["log_id"])


def downgrade() -> None:
    op.drop_index("ix_spec_session_log", table_name="spec_worker_session")
    op.drop_table("spec_worker_session")
    op.drop_index("ix_spec_log_status", table_name="spec_execution_log")
    op.drop_index("ix_spec_log_plan_node", table_name="spec_execution_log")
    op.drop_table("spec_execution_log")
    op.drop_index("ix_spec_plan_status", table_name="spec_plan")
    op.drop_index("ix_spec_plan_user", table_name="spec_plan")
    op.drop_table("spec_plan")
