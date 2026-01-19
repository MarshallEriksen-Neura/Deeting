"""create image generation tables and media asset expiry

Revision ID: 20260119_01_create_image_generation_tables
Revises: 20260118_01_create_upstream_secret_store
Create Date: 2026-01-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260119_01_create_image_generation_tables"
down_revision: Union[str, None] = "20260118_01_create_upstream_secret_store"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "media_asset",
        sa.Column(
            "expire_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="过期时间（用于生命周期清理）",
        ),
    )
    op.create_index("ix_media_asset_expire_at", "media_asset", ["expire_at"])

    op.create_table(
        "image_generation_task",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True, comment="内部用户 ID"),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, comment="租户 ID（内部可为空）"),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), nullable=True, comment="API Key ID（内部通道可复用用户 ID）"),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True, comment="会话 ID（可选）"),
        sa.Column("request_id", sa.String(length=64), nullable=True, comment="幂等请求 ID"),
        sa.Column("trace_id", sa.String(length=64), nullable=True, comment="链路追踪 ID"),
        sa.Column("model", sa.String(length=128), nullable=False, comment="请求模型标识"),
        sa.Column("provider_model_id", postgresql.UUID(as_uuid=True), nullable=True, comment="命中的 ProviderModel ID"),
        sa.Column("provider_instance_id", postgresql.UUID(as_uuid=True), nullable=True, comment="命中的 ProviderInstance ID"),
        sa.Column("preset_id", postgresql.UUID(as_uuid=True), nullable=True, comment="命中的 ProviderPreset ID"),
        sa.Column("provider", sa.String(length=64), nullable=True, comment="上游厂商标识"),
        sa.Column("prompt_raw", sa.Text(), nullable=False, comment="提示词（明文）"),
        sa.Column("negative_prompt", sa.Text(), nullable=True, comment="反向提示词（可选）"),
        sa.Column("prompt_hash", sa.String(length=64), nullable=False, comment="提示词哈希（HMAC-SHA256）"),
        sa.Column(
            "prompt_encrypted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否保存加密提示词",
        ),
        sa.Column("prompt_ciphertext", sa.Text(), nullable=True, comment="提示词密文（Fernet）"),
        sa.Column("width", sa.Integer(), nullable=True, comment="输出宽度"),
        sa.Column("height", sa.Integer(), nullable=True, comment="输出高度"),
        sa.Column("aspect_ratio", sa.String(length=20), nullable=True, comment="纵横比"),
        sa.Column(
            "num_outputs",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
            comment="输出数量",
        ),
        sa.Column("steps", sa.Integer(), nullable=True, comment="推理步数"),
        sa.Column("cfg_scale", sa.Float(), nullable=True, comment="CFG 指数"),
        sa.Column("seed", sa.Integer(), nullable=True, comment="随机种子"),
        sa.Column("sampler_name", sa.String(length=64), nullable=True, comment="采样器"),
        sa.Column("quality", sa.String(length=32), nullable=True, comment="质量/风格"),
        sa.Column("style", sa.String(length=32), nullable=True, comment="风格"),
        sa.Column("response_format", sa.String(length=32), nullable=True, comment="返回格式 url/b64_json"),
        sa.Column(
            "extra_params",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="厂商扩展参数",
        ),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'queued'"), comment="任务状态"),
        sa.Column("error_code", sa.String(length=64), nullable=True, comment="错误码"),
        sa.Column("error_message", sa.Text(), nullable=True, comment="错误信息（脱敏）"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="输入 token 数"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="输出 token 数"),
        sa.Column("media_tokens", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="媒体/像素计量"),
        sa.Column("cost_upstream", sa.Float(), nullable=False, server_default=sa.text("0"), comment="上游成本"),
        sa.Column("cost_user", sa.Float(), nullable=False, server_default=sa.text("0"), comment="用户扣费"),
        sa.Column("currency", sa.String(length=16), nullable=True, comment="币种"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True, comment="开始执行时间"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True, comment="完成时间"),
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

    op.create_index("ix_image_task_user_id", "image_generation_task", ["user_id"])
    op.create_index("ix_image_task_tenant_id", "image_generation_task", ["tenant_id"])
    op.create_index("ix_image_task_status", "image_generation_task", ["status"])
    op.create_index("ix_image_task_session_id", "image_generation_task", ["session_id"])
    op.create_index("ix_image_task_request_id", "image_generation_task", ["request_id"])
    op.create_index("idx_image_task_created_at", "image_generation_task", ["created_at"])

    op.create_table(
        "image_generation_output",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("image_generation_task.id", ondelete="CASCADE"),
            nullable=False,
            comment="任务 ID",
        ),
        sa.Column("output_index", sa.Integer(), nullable=False, comment="输出序号（从 0 开始）"),
        sa.Column(
            "media_asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("media_asset.id", ondelete="SET NULL"),
            nullable=True,
            comment="关联媒体资产 ID",
        ),
        sa.Column("source_url", sa.String(length=512), nullable=True, comment="上游原始 URL（可选）"),
        sa.Column("seed", sa.Integer(), nullable=True, comment="生成种子"),
        sa.Column("content_type", sa.String(length=120), nullable=True, comment="内容类型"),
        sa.Column("size_bytes", sa.Integer(), nullable=True, comment="大小（字节）"),
        sa.Column("width", sa.Integer(), nullable=True, comment="宽度"),
        sa.Column("height", sa.Integer(), nullable=True, comment="高度"),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
            comment="扩展元信息",
        ),
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

    op.create_index("ix_image_output_task_id", "image_generation_output", ["task_id"])
    op.create_index("ix_image_output_media_asset_id", "image_generation_output", ["media_asset_id"])
    op.create_index(
        "uq_image_output_task_index",
        "image_generation_output",
        ["task_id", "output_index"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_image_output_task_index", table_name="image_generation_output")
    op.drop_index("ix_image_output_media_asset_id", table_name="image_generation_output")
    op.drop_index("ix_image_output_task_id", table_name="image_generation_output")
    op.drop_table("image_generation_output")

    op.drop_index("idx_image_task_created_at", table_name="image_generation_task")
    op.drop_index("ix_image_task_request_id", table_name="image_generation_task")
    op.drop_index("ix_image_task_session_id", table_name="image_generation_task")
    op.drop_index("ix_image_task_status", table_name="image_generation_task")
    op.drop_index("ix_image_task_tenant_id", table_name="image_generation_task")
    op.drop_index("ix_image_task_user_id", table_name="image_generation_task")
    op.drop_table("image_generation_task")

    op.drop_index("ix_media_asset_expire_at", table_name="media_asset")
    op.drop_column("media_asset", "expire_at")
