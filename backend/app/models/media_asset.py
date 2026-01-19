from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MediaAsset(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "media_asset"
    __table_args__ = (
        UniqueConstraint("content_hash", "size_bytes", name="uq_media_asset_hash_size"),
        UniqueConstraint("object_key", name="uq_media_asset_object_key"),
        Index("ix_media_asset_content_hash", "content_hash"),
        Index("ix_media_asset_object_key", "object_key"),
        Index("ix_media_asset_expire_at", "expire_at"),
        Index(
            "idx_media_asset_created_at",
            "created_at",
            **(
                {"postgresql_using": "brin"}
                if settings.DATABASE_URL.startswith("postgresql")
                else {}
            ),
        ),
    )

    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="SHA-256 内容哈希（hex）",
    )
    size_bytes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="内容大小（字节）",
    )
    content_type: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="内容类型",
    )
    object_key: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="对象存储 Key",
    )
    etag: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="对象存储 ETag",
    )
    expire_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="过期时间（用于生命周期清理）",
    )
    uploader_user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="上传用户 ID",
    )

    def __repr__(self) -> str:
        return f"<MediaAsset(id={self.id}, hash={self.content_hash}, size={self.size_bytes})>"
