import uuid
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JSONBCompat(TypeDecorator):
    """
    PostgreSQL 使用 JSONB，其他方言自动回退 JSON（SQLite 测试用）。
    """
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())

class ProviderPreset(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Provider Preset (主表)
    描述一个预设及其通用配置
    """
    __tablename__ = "provider_preset"

    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, comment="预设名称（展示用）")
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True, comment="机器可读标识，供路由引用")
    provider: Mapped[str] = mapped_column(String(40), nullable=False, comment="上游厂商/驱动名称（如 openai, anthropic）")
    base_url: Mapped[str] = mapped_column(String(255), nullable=False, comment="上游基础 URL")

    # 认证配置
    auth_type: Mapped[str] = mapped_column(String(20), nullable=False, comment="认证方式: api_key, bearer, none")
    auth_config: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="认证配置")

    # 通用参数模板
    default_headers: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="通用 Header 模板")
    default_params: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="通用请求体参数默认值")

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", comment="乐观锁版本号")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")

    # 关系
    items: Mapped[list["ProviderPresetItem"]] = relationship(
        "ProviderPresetItem",
        back_populates="preset",
        cascade="all, delete-orphan",
        passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<ProviderPreset(slug={self.slug}, provider={self.provider})>"


class ProviderPresetItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Provider Preset Item (子表)
    描述预设下具体 capability/model 的路由与参数
    """
    __tablename__ = "provider_preset_item"

    preset_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("provider_preset.id", ondelete="CASCADE"),
        nullable=False
    )

    # 能力与路由
    capability: Mapped[str] = mapped_column(String(32), nullable=False, index=True, comment="能力类型: chat, embedding, tts, vision 等")
    subtype: Mapped[str | None] = mapped_column(String(32), nullable=True, comment="子类型: chat/completion")

    model: Mapped[str] = mapped_column(String(128), nullable=False, comment="上游实际需要的模型标识/部署名")
    unified_model_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True, comment="逻辑层统一模型 ID")

    upstream_path: Mapped[str] = mapped_column(String(255), nullable=False, comment="请求路径（相对 base_url）")

    # 通道与灰度/路由配置
    channel: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="external",
        server_default="external",
        comment="可用通道: internal / external / both",
    )

    # 模板与变换
    template_engine: Mapped[str] = mapped_column(String(32), nullable=False, default="simple_replace", server_default="simple_replace", comment="模板引擎类型")
    request_template: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="请求体模板/映射规则")
    response_transform: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="响应变换规则")

    # 进阶配置
    pricing_config: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="计费配置")
    limit_config: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="限流/超时/重试配置")
    tokenizer_config: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="Tokenizer 配置")
    routing_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="路由策略配置（bandit / 灰度 / 熔断降级）",
    )

    # 权限与可见性
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="private", server_default="private", comment="可见性: private, public, shared")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(SA_UUID(as_uuid=True), nullable=True, comment="拥有者用户 ID")
    shared_scope: Mapped[str | None] = mapped_column(String(32), nullable=True, comment="共享作用域")
    shared_targets: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=list, server_default="[]", comment="共享对象列表")

    # 调度控制
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100", comment="负载分配权重")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="回退优先级")

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")

    # 关系
    preset: Mapped["ProviderPreset"] = relationship("ProviderPreset", back_populates="items")

    __table_args__ = (
        UniqueConstraint("preset_id", "capability", "model", "upstream_path", name="uq_preset_item_identity"),
        Index("ix_preset_item_lookup", "preset_id", "capability"),
    )

    def __repr__(self) -> str:
        return f"<ProviderPresetItem(capability={self.capability}, model={self.model})>"
