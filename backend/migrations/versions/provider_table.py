"""create provider preset tables

Revision ID: 20260104_01
Revises:
Create Date: 2026-01-04
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260104_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "public_model",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False, unique=True, comment="模型唯一标识"),
        sa.Column("display_name", sa.String(length=128), nullable=False, comment="展示名称"),
        sa.Column("family", sa.String(length=64), nullable=True, comment="模型家族"),
        sa.Column("type", sa.String(length=32), nullable=False, comment="模型类型"),
        sa.Column("context_window", sa.Integer(), nullable=True, comment="上下文窗口"),
        sa.Column("description", sa.Text(), nullable=True, comment="模型描述"),
        sa.Column("icon_url", sa.String(length=255), nullable=True, comment="图标 URL"),
        sa.Column("input_price_display", sa.String(length=64), nullable=True, comment="输入价格展示"),
        sa.Column("output_price_display", sa.String(length=64), nullable=True, comment="输出价格展示"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="排序权重"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true"), comment="是否公开可见"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_public_model_model_id", "public_model", ["model_id"], unique=True)

    op.create_table(
        "provider_preset",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True, comment="预设名称（展示用）"),
        sa.Column("slug", sa.String(length=80), nullable=False, comment="机器可读标识，供路由引用"),
        sa.Column("provider", sa.String(length=40), nullable=False, comment="上游厂商/驱动名称"),
        sa.Column("base_url", sa.String(length=255), nullable=False, comment="上游基础 URL"),
        sa.Column("auth_type", sa.String(length=20), nullable=False, comment="认证方式: api_key, bearer, none"),
        sa.Column("auth_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="认证配置"),
        sa.Column("default_headers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="通用 Header 模板"),
        sa.Column("default_params", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="通用请求体参数默认值"),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1"), comment="乐观锁版本号"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true"), comment="是否启用"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_provider_preset_slug", "provider_preset", ["slug"], unique=True)

    op.create_table(
        "provider_preset_item",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("preset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("provider_preset.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability", sa.String(length=32), nullable=False, comment="能力类型"),
        sa.Column("subtype", sa.String(length=32), nullable=True, comment="子类型"),
        sa.Column("model", sa.String(length=128), nullable=False, comment="上游实际需要的模型标识/部署名"),
        sa.Column("unified_model_id", sa.String(length=128), nullable=True, comment="统一模型 ID"),
        sa.Column("upstream_path", sa.String(length=255), nullable=False, comment="请求路径（相对 base_url）"),
        sa.Column("template_engine", sa.String(length=32), nullable=False, server_default=sa.text("'simple_replace'"), comment="模板引擎类型"),
        sa.Column("request_template", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="请求体模板"),
        sa.Column("response_transform", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="响应变换"),
        sa.Column("pricing_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="计费配置"),
        sa.Column("limit_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="限流配置"),
        sa.Column("tokenizer_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb"), comment="Tokenizer 配置"),
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default=sa.text("'private'"), comment="可见性"),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True, comment="拥有者用户 ID"),
        sa.Column("shared_scope", sa.String(length=32), nullable=True, comment="共享作用域"),
        sa.Column("shared_targets", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb"), comment="共享对象列表"),
        sa.Column("weight", sa.Integer(), nullable=False, server_default=sa.text("100"), comment="负载分配权重"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0"), comment="回退优先级"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true"), comment="是否启用"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("preset_id", "capability", "model", "upstream_path", name="uq_preset_item_identity"),
    )
    op.create_index("ix_preset_item_lookup", "provider_preset_item", ["preset_id", "capability"], unique=False)
    op.create_index("ix_provider_preset_item_unified_model_id", "provider_preset_item", ["unified_model_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_provider_preset_item_unified_model_id", table_name="provider_preset_item")
    op.drop_index("ix_preset_item_lookup", table_name="provider_preset_item")
    op.drop_table("provider_preset_item")

    op.drop_index("ix_provider_preset_slug", table_name="provider_preset")
    op.drop_table("provider_preset")

    op.drop_index("ix_public_model_model_id", table_name="public_model")
    op.drop_table("public_model")
