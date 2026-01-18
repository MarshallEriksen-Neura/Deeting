from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UpstreamSecret(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    上游凭证密钥加密存储
    """

    __tablename__ = "upstream_secret"

    provider: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        index=True,
        comment="provider slug/命名空间",
    )
    encrypted_secret: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="加密后的密钥",
    )
    secret_hint: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        comment="密钥尾部提示（最多 4-8 位）",
    )
