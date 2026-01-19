from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema


class ImageGenerationTaskCreateRequest(BaseSchema):
    model: str = Field(..., description="模型标识")
    prompt: str = Field(..., description="提示词")
    negative_prompt: str | None = Field(None, description="反向提示词")

    width: int | None = Field(None, ge=1, description="输出宽度")
    height: int | None = Field(None, ge=1, description="输出高度")
    aspect_ratio: str | None = Field(None, description="纵横比")

    num_outputs: int = Field(1, ge=1, description="生成图片数量")
    steps: int | None = Field(None, description="推理步数")
    cfg_scale: float | None = Field(None, description="CFG 指数")
    seed: int | None = Field(None, description="随机种子")
    sampler_name: str | None = Field(None, description="采样器")
    quality: str | None = Field(None, description="质量/风格")
    style: str | None = Field(None, description="风格")
    response_format: str | None = Field(None, description="返回格式 url/b64_json")
    extra_params: dict[str, Any] = Field(default_factory=dict, description="扩展参数")

    provider_model_id: UUID | None = Field(None, description="指定 ProviderModel ID")
    session_id: str | None = Field(None, description="会话 ID（可选）")
    request_id: str | None = Field(None, description="幂等请求 ID")
    encrypt_prompt: bool = Field(False, description="是否保存加密提示词")


class ImageGenerationTaskCreateResponse(BaseSchema):
    task_id: UUID = Field(..., description="任务 ID")
    status: str = Field(..., description="任务状态")
    created_at: datetime = Field(..., description="创建时间")
    deduped: bool = Field(False, description="是否命中幂等")


class ImageGenerationOutputItem(BaseSchema):
    output_index: int
    asset_url: str | None = None
    source_url: str | None = None
    seed: int | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None


class ImageGenerationTaskDetail(BaseSchema):
    task_id: UUID
    status: str
    model: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    outputs: list[ImageGenerationOutputItem] = Field(default_factory=list)


__all__ = [
    "ImageGenerationTaskCreateRequest",
    "ImageGenerationTaskCreateResponse",
    "ImageGenerationOutputItem",
    "ImageGenerationTaskDetail",
]
