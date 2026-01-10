import uuid
from typing import Any

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
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
    Provider Preset (模板)
    仅定义协议与默认配置；实例/模型在 provider_instance / provider_model 中管理。
    """

    __tablename__ = "provider_preset"

    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, comment="模板名称（展示用）")
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True, comment="机器可读标识，供实例引用")
    provider: Mapped[str] = mapped_column(String(40), nullable=False, comment="上游厂商/驱动名称")
    icon: Mapped[str] = mapped_column(
        String(255), nullable=False, default="lucide:cpu", server_default="lucide:cpu", comment="品牌/图标引用"
    )
    theme_color: Mapped[str] = mapped_column(
        String(20), nullable=True, comment="品牌主色调 (Hex/Tailwind class)"
    )
    base_url: Mapped[str] = mapped_column(String(255), nullable=False, comment="上游基础 URL")

    auth_type: Mapped[str] = mapped_column(String(20), nullable=False, comment="认证方式: api_key, bearer, none")
    auth_config: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="认证配置（无明文密钥）")

    default_headers: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="通用 Header 模板")
    default_params: Mapped[dict[str, Any]] = mapped_column(JSONBCompat, nullable=False, default=dict, server_default="{}", comment="通用请求体参数默认值")

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", comment="乐观锁版本号")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", comment="是否启用")

    def __repr__(self) -> str:
        return f"<ProviderPreset(slug={self.slug}, provider={self.provider})>"
