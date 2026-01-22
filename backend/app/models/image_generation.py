from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class ImageGenerationStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


class GenerationTaskType(str, enum.Enum):
    IMAGE_GENERATION = "image_generation"
    TEXT_TO_SPEECH = "text_to_speech"
    VIDEO_GENERATION = "video_generation"


class GenerationTask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "generation_task"
    __table_args__ = (
        Index("ix_image_task_user_id", "user_id"),
        Index("ix_image_task_tenant_id", "tenant_id"),
        Index("ix_image_task_status", "status"),
        Index("ix_image_task_session_id", "session_id"),
        Index("ix_image_task_request_id", "request_id"),
        Index("idx_image_task_created_at", "created_at"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="内部用户 ID",
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="租户 ID（内部可为空）",
    )
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="API Key ID（内部通道可复用用户 ID）",
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="会话 ID（可选）",
    )
    request_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="幂等请求 ID",
    )
    trace_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="链路追踪 ID",
    )

    model: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="请求模型标识",
    )
    provider_model_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="命中的 ProviderModel ID",
    )
    provider_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="命中的 ProviderInstance ID",
    )
    preset_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="命中的 ProviderPreset ID",
    )
    provider: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="上游厂商标识",
    )

    task_type: Mapped[GenerationTaskType] = mapped_column(
        String(32),
        nullable=False,
        default=GenerationTaskType.IMAGE_GENERATION,
        server_default=GenerationTaskType.IMAGE_GENERATION.value,
        comment="任务类型（image_generation/text_to_speech/video_generation）",
    )
    input_params: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="通用输入参数（JSONB）",
    )
    output_meta: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="通用输出元信息（JSONB）",
    )

    prompt_raw: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="提示词（明文）",
    )
    negative_prompt: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="反向提示词（可选）",
    )
    prompt_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="提示词哈希（HMAC-SHA256）",
    )
    prompt_encrypted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否保存加密提示词",
    )
    prompt_ciphertext: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="提示词密文（Fernet）",
    )

    width: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="输出宽度")
    height: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="输出高度")
    aspect_ratio: Mapped[str | None] = mapped_column(String(20), nullable=True, comment="纵横比")
    num_outputs: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
        comment="输出数量",
    )
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="推理步数")
    cfg_scale: Mapped[float | None] = mapped_column(
        Float, nullable=True, comment="CFG 指数"
    )
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="随机种子")
    sampler_name: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="采样器")
    quality: Mapped[str | None] = mapped_column(String(32), nullable=True, comment="质量/风格")
    style: Mapped[str | None] = mapped_column(String(32), nullable=True, comment="风格")
    response_format: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="返回格式 url/b64_json"
    )
    extra_params: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="厂商扩展参数",
    )

    status: Mapped[ImageGenerationStatus] = mapped_column(
        String(20),
        nullable=False,
        default=ImageGenerationStatus.QUEUED,
        server_default=ImageGenerationStatus.QUEUED.value,
        comment="任务状态",
    )
    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="错误码",
    )
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="错误信息（脱敏）",
    )

    input_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="输入 token 数",
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="输出 token 数",
    )
    media_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="媒体/像素计量",
    )
    cost_upstream: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0",
        comment="上游成本",
    )
    cost_user: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0",
        comment="用户扣费",
    )
    currency: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        comment="币种",
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="开始执行时间",
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="完成时间",
    )


class ImageGenerationOutput(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "image_generation_output"
    __table_args__ = (
        Index("ix_image_output_task_id", "task_id"),
        Index("ix_image_output_media_asset_id", "media_asset_id"),
        Index("uq_image_output_task_index", "task_id", "output_index", unique=True),
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
        comment="关联媒体资产 ID",
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
    meta: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="扩展元信息",
    )
