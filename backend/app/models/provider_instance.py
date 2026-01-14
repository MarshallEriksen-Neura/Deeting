import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, DateTime, text
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat


class ProviderInstance(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    用户级通道实例（BYOP 渠道）

    - preset_slug 指向系统级 provider_preset（模板）
    - user_id 为空表示平台公共实例
    - credentials_ref 作为默认凭证引用；额外多 Key 存在 provider_credential
    """

    __tablename__ = "provider_instance"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True), nullable=True, index=True, comment="所属用户/工作区，为空表示平台公共实例"
    )
    preset_slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True, comment="引用 provider_preset.slug")
    name: Mapped[str] = mapped_column(String(80), nullable=False, comment="实例名称，用户自定义")
    description: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="实例描述")
    base_url: Mapped[str] = mapped_column(String(255), nullable=False, comment="实例基础 URL，可覆盖模板")
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="覆盖模板的图标引用")
    credentials_ref: Mapped[str] = mapped_column(String(128), nullable=False, comment="密钥引用 ID/环境变量名")
    channel: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="external",
        server_default="external",
        comment="可用通道: internal / external / both",
    )
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="路由优先级")
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")
    meta: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="探测日志/健康信息"
    )

    models: Mapped[list["ProviderModel"]] = relationship(
        "ProviderModel",
        back_populates="instance",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    credentials: Mapped[list["ProviderCredential"]] = relationship(
        "ProviderCredential",
        back_populates="instance",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<ProviderInstance(slug={self.preset_slug}, name={self.name}, user={self.user_id})>"


class ProviderModel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    某个实例下的可用模型快照（执行层配置）
    """

    __tablename__ = "provider_model"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True), ForeignKey("provider_instance.id", ondelete="CASCADE"), nullable=False
    )

    capability: Mapped[str] = mapped_column(String(32), nullable=False, index=True, comment="能力类型: chat, embedding 等")
    model_id: Mapped[str] = mapped_column(String(128), nullable=False, comment="上游真实模型标识/部署名")
    unified_model_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True, comment="对外统一/别名模型标识，可为空"
    )
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="友好展示名，可选")

    upstream_path: Mapped[str] = mapped_column(String(255), nullable=False, comment="请求路径（相对 base_url）")
    template_engine: Mapped[str] = mapped_column(
        String(32), nullable=False, default="simple_replace", server_default="simple_replace", comment="模板引擎"
    )
    request_template: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="请求体模板/映射规则"
    )
    response_transform: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="响应变换规则"
    )
    pricing_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="计费配置"
    )
    limit_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="限流/超时/重试配置"
    )
    tokenizer_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="Tokenizer 配置"
    )
    routing_config: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="路由策略配置"
    )

    source: Mapped[str] = mapped_column(String(16), nullable=False, default="auto", server_default="auto", comment="auto/manual")
    extra_meta: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat, nullable=False, default=dict, server_default="{}", comment="上游元数据快照"
    )
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100", comment="负载权重")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="优先级")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")
    synced_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="最近同步时间"
    )

    instance: Mapped["ProviderInstance"] = relationship("ProviderInstance", back_populates="models")

    __table_args__ = (
        UniqueConstraint("instance_id", "capability", "model_id", "upstream_path", name="uq_provider_model_identity"),
        Index(
            "uq_provider_model_unified",
            "instance_id",
            "capability",
            "unified_model_id",
            unique=True,
            postgresql_where=text("unified_model_id IS NOT NULL"),
        ),
        Index("ix_provider_model_lookup", "instance_id", "capability"),
        Index("ix_provider_model_model_id", "model_id"),
    )

    def __repr__(self) -> str:
        return f"<ProviderModel(capability={self.capability}, model_id={self.model_id})>"


class ProviderCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    上游凭证（多 Key 支持），挂载到具体的 ProviderInstance 下。

    - alias 供用户区分用途，如 "default" / "backup-1"
    - secret_ref_id 仅存引用，不存明文
    """

    __tablename__ = "provider_credential"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True), ForeignKey("provider_instance.id", ondelete="CASCADE"), nullable=False
    )
    alias: Mapped[str] = mapped_column(String(80), nullable=False, comment="凭证别名")
    secret_ref_id: Mapped[str] = mapped_column(String(128), nullable=False, comment="密钥引用 ID/环境变量名")
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="候选权重偏移")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="候选优先级偏移")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")

    instance: Mapped["ProviderInstance"] = relationship("ProviderInstance", back_populates="credentials")

    __table_args__ = (
        UniqueConstraint("instance_id", "alias", name="uq_provider_credential_alias"),
        Index("ix_provider_credential_instance", "instance_id"),
    )

    def __repr__(self) -> str:
        return f"<ProviderCredential(instance={self.instance_id}, alias={self.alias})>"
