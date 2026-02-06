from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.media_asset import MediaAsset
from app.models.provider_preset import JSONBCompat


class UserDocument(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    用户上传的 RAG 文档 (User RAG Document)。
    
    设计要点：
    1. 复用 MediaAsset: 物理文件存储（OSS/Local）、去重、元数据由 MediaAsset 管理。
    2. 独立生命周期: 用户可能上传同一个文件多次（在不同上下文），或者不同用户上传相同文件。
       UserDocument 代表"某用户在某次操作中引入的文档"，即使底层 MediaAsset 相同。
    3. 状态追踪: 记录解析、切片、索引的全过程。
    """

    __tablename__ = "user_document"
    __table_args__ = (
        Index("ix_user_document_user_id", "user_id"),
        Index("ix_user_document_status", "status"),
        Index("ix_user_document_media_asset_id", "media_asset_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="归属用户",
    )

    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("media_asset.id", ondelete="RESTRICT"),
        nullable=False,
        comment="关联的物理文件资产",
    )

    filename: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="显示文件名（用户上传时指定或原名）"
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default="'pending'",
        comment="状态: pending, processing, indexed, failed",
    )

    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="处理失败时的错误信息"
    )

    # 索引统计信息 (用于 Qdrant 一致性校验)
    chunk_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", comment="切片数量"
    )
    
    embedding_model: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="使用的 Embedding 模型版本"
    )

    meta_info: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="解析元数据 (如页数、解析器版本、自定义Tag)",
    )

    # 关系
    media_asset: Mapped[MediaAsset] = relationship("MediaAsset")

    def __repr__(self) -> str:
        return f"<UserDocument(id={self.id}, user={self.user_id}, file={self.filename}, status={self.status})>"
