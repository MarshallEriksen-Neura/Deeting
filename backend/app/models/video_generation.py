from __future__ import annotations

import uuid

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Float,
)
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class VideoGenerationOutput(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "video_generation_output"
    __table_args__ = (
        Index("ix_video_output_task_id", "task_id"),
        Index("ix_video_output_media_asset_id", "media_asset_id"),
        Index("uq_video_output_task_index", "task_id", "output_index", unique=True),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("generation_task.id", ondelete="CASCADE"),
        nullable=False,
        comment="任务 ID",
    )
    output_index: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="输出序号（从 0 开始）",
    )
    media_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("media_asset.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联视频资产 ID",
    )
    cover_media_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("media_asset.id", ondelete="SET NULL"),
        nullable=True,
        comment="关联封面资产 ID",
    )
    source_url: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="上游原始 URL（可选）",
    )
    seed: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="生成种子",
    )
    content_type: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="内容类型",
    )
    size_bytes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="大小（字节）",
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="宽度")
    height: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="高度")
    duration: Mapped[float | None] = mapped_column(Float, nullable=True, comment="时长(秒)")
    fps: Mapped[float | None] = mapped_column(Float, nullable=True, comment="帧率")
    
    meta: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="扩展元信息",
    )
