from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class VideoGenerationTaskCreateRequest(BaseSchema):
    model: str = Field(..., description="模型标识")
    prompt: str = Field(..., description="提示词")
    negative_prompt: str | None = Field(None, description="反向提示词")
    image_url: str | None = Field(None, description="参考图 URL (img2vid)")

    width: int | None = Field(None, ge=1, description="输出宽度")
    height: int | None = Field(None, ge=1, description="输出高度")
    aspect_ratio: str | None = Field(None, description="纵横比 (16:9, 9:16, etc)")
    
    duration: int | None = Field(None, ge=1, description="视频时长(秒)")
    fps: int | None = Field(None, ge=1, description="帧率")
    motion_bucket_id: int | None = Field(None, description="运动幅度 (SVD param)")
    
    num_outputs: int = Field(1, ge=1, description="生成视频数量")
    steps: int | None = Field(None, description="推理步数")
    cfg_scale: float | None = Field(None, description="CFG 指数")
    seed: int | None = Field(None, description="随机种子")
    
    quality: str | None = Field(None, description="质量/风格")
    style: str | None = Field(None, description="风格")
    
    extra_params: dict[str, Any] = Field(default_factory=dict, description="扩展参数")

    provider_model_id: UUID | None = Field(None, description="指定 ProviderModel ID")
    session_id: str | None = Field(None, description="会话 ID（可选）")
    request_id: str | None = Field(None, description="幂等请求 ID")
    encrypt_prompt: bool = Field(False, description="是否保存加密提示词")


class VideoGenerationTaskCreateResponse(BaseSchema):
    task_id: UUID = Field(..., description="任务 ID")
    status: str = Field(..., description="任务状态")
    created_at: datetime = Field(..., description="创建时间")
    deduped: bool = Field(False, description="是否命中幂等")


class VideoGenerationOutputItem(BaseSchema):
    output_index: int
    asset_url: str | None = None
    source_url: str | None = None
    cover_url: str | None = None  # 视频封面
    seed: int | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None


class VideoGenerationTaskDetail(BaseSchema):
    task_id: UUID
    status: str
    model: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    outputs: list[VideoGenerationOutputItem] = Field(default_factory=list)


class VideoGenerationTaskListItem(BaseSchema):
    task_id: UUID
    status: str
    model: str
    session_id: UUID | None = None
    prompt: str | None = None
    prompt_encrypted: bool = False
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    preview: VideoGenerationOutputItem | None = None


__all__ = [
    "VideoGenerationTaskCreateRequest",
    "VideoGenerationTaskCreateResponse",
    "VideoGenerationOutputItem",
    "VideoGenerationTaskDetail",
    "VideoGenerationTaskListItem",
]
