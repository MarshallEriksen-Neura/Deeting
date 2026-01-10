"""create api_key related tables

Revision ID: 20260106_01
Revises: 20260105_01
Create Date: 2026-01-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260106_01"
down_revision = "20260105_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ============================================================
    # api_key 主表
    # ============================================================
    op.create_table(
        "api_key",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key_prefix", sa.String(length=12), nullable=False, comment="Key 前缀 (sk-ext- / sk-int-)"),
        sa.Column("key_hash", sa.String(length=64), nullable=False, unique=True, comment="HMAC-SHA256 哈希"),
        sa.Column("key_hint", sa.String(length=8), nullable=False, comment="Key 末 4 位 (****abcd)"),
        sa.Column("type", sa.String(length=20), nullable=False, comment="Key 类型: internal/external"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active", comment="Key 状态"),
        sa.Column("name", sa.String(length=100), nullable=False, comment="Key 名称/描述"),
        sa.Column("description", sa.Text(), nullable=True, comment="详细描述"),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True, comment="外部 Key 绑定的租户 ID"),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL"), nullable=True, comment="内部 Key 绑定的用户/服务账号 ID"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_account.id", ondelete="SET NULL"), nullable=False, comment="创建人 ID"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True, comment="过期时间 (NULL = 永不过期)"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True, comment="最近使用时间"),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True, comment="吊销时间"),
        sa.Column("revoked_reason", sa.String(length=255), nullable=True, comment="吊销原因"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_api_key_key_hash", "api_key", ["key_hash"])
    op.create_index("ix_api_key_tenant_id", "api_key", ["tenant_id"])
    op.create_index("ix_api_key_user_id", "api_key", ["user_id"])
    op.create_index("ix_api_key_status", "api_key", ["status"])

    # ============================================================
    # api_key_scope 权限范围表
    # ============================================================
    op.create_table(
        "api_key_scope",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_key.id", ondelete="CASCADE"), nullable=False, comment="关联 api_key.id"),
        sa.Column("scope_type", sa.String(length=20), nullable=False, comment="范围类型: capability/model/endpoint"),
        sa.Column("scope_value", sa.String(length=100), nullable=False, comment="具体值 (chat, gpt-4, /v1/chat/completions)"),
        sa.Column("permission", sa.String(length=10), nullable=False, server_default="allow", comment="权限类型: allow/deny"),
        sa.UniqueConstraint("api_key_id", "scope_type", "scope_value", name="uq_api_key_scope"),
    )

    # ============================================================
    # api_key_rate_limit 限流配置表
    # ============================================================
    op.create_table(
        "api_key_rate_limit",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_key.id", ondelete="CASCADE"), nullable=False, unique=True, comment="关联 api_key.id"),
        sa.Column("rpm", sa.Integer(), nullable=True, comment="每分钟请求数限制"),
        sa.Column("tpm", sa.Integer(), nullable=True, comment="每分钟 Token 数限制"),
        sa.Column("rpd", sa.Integer(), nullable=True, comment="每日请求数限制"),
        sa.Column("tpd", sa.Integer(), nullable=True, comment="每日 Token 数限制"),
        sa.Column("concurrent_limit", sa.Integer(), nullable=True, comment="并发请求数限制"),
        sa.Column("burst_limit", sa.Integer(), nullable=True, comment="突发上限"),
        sa.Column("is_whitelist", sa.Boolean(), nullable=False, server_default=sa.text("false"), comment="是否白名单 (跳过全局限流)"),
    )

    # ============================================================
    # api_key_quota 配额表
    # ============================================================
    op.create_table(
        "api_key_quota",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_key.id", ondelete="CASCADE"), nullable=False, comment="关联 api_key.id"),
        sa.Column("quota_type", sa.String(length=20), nullable=False, comment="配额类型: token/request/cost"),
        sa.Column("total_quota", sa.BigInteger(), nullable=False, comment="总配额"),
        sa.Column("used_quota", sa.BigInteger(), nullable=False, server_default="0", comment="已用配额"),
        sa.Column("reset_period", sa.String(length=20), nullable=False, server_default="monthly", comment="重置周期: daily/monthly/never"),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=True, comment="下次重置时间"),
        sa.UniqueConstraint("api_key_id", "quota_type", name="uq_api_key_quota"),
    )

    # ============================================================
    # api_key_ip_whitelist IP 白名单表
    # ============================================================
    op.create_table(
        "api_key_ip_whitelist",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_key.id", ondelete="CASCADE"), nullable=False, comment="关联 api_key.id"),
        sa.Column("ip_pattern", sa.String(length=50), nullable=False, comment="IP 或 CIDR (192.168.1.0/24)"),
        sa.Column("description", sa.String(length=100), nullable=True, comment="描述"),
        sa.UniqueConstraint("api_key_id", "ip_pattern", name="uq_api_key_ip"),
    )

    # ============================================================
    # api_key_usage 使用统计表
    # ============================================================
    op.create_table(
        "api_key_usage",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("api_key.id", ondelete="CASCADE"), nullable=False, comment="关联 api_key.id"),
        sa.Column("stat_date", sa.Date(), nullable=False, comment="统计日期"),
        sa.Column("stat_hour", sa.SmallInteger(), nullable=False, comment="统计小时 (0-23)"),
        sa.Column("request_count", sa.BigInteger(), nullable=False, server_default="0", comment="请求数"),
        sa.Column("token_count", sa.BigInteger(), nullable=False, server_default="0", comment="Token 消耗"),
        sa.Column("cost", sa.Numeric(precision=18, scale=8), nullable=False, server_default="0", comment="费用"),
        sa.Column("error_count", sa.BigInteger(), nullable=False, server_default="0", comment="错误数"),
        sa.UniqueConstraint("api_key_id", "stat_date", "stat_hour", name="uq_api_key_usage"),
    )
    op.create_index("ix_api_key_usage_date", "api_key_usage", ["stat_date"])


def downgrade() -> None:
    op.drop_table("api_key_usage")
    op.drop_table("api_key_ip_whitelist")
    op.drop_table("api_key_quota")
    op.drop_table("api_key_rate_limit")
    op.drop_table("api_key_scope")
    op.drop_index("ix_api_key_status", table_name="api_key")
    op.drop_index("ix_api_key_user_id", table_name="api_key")
    op.drop_index("ix_api_key_tenant_id", table_name="api_key")
    op.drop_index("ix_api_key_key_hash", table_name="api_key")
    op.drop_table("api_key")
