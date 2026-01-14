from typing import Any
from uuid import UUID

from pydantic import Field

from .base import BaseSchema, IDSchema


class GatewayLogBase(BaseSchema):
    user_id: UUID | None = Field(None, description="调用者用户 ID")
    api_key_id: UUID | None = Field(None, description="调用使用的 API Key ID")
    preset_id: UUID | None = Field(None, description="命中的预设 ID")

    model: str = Field(..., max_length=128, description="请求的上游模型名称")
    status_code: int = Field(..., description="响应状态码")

    duration_ms: int = Field(..., description="总耗时(ms)")
    ttft_ms: int | None = Field(None, description="首包时间(ms)")

    input_tokens: int = Field(0, description="输入 Token 数")
    output_tokens: int = Field(0, description="输出 Token 数")
    total_tokens: int = Field(0, description="总 Token 数")

    cost_upstream: float = Field(0.0, description="上游成本")
    cost_user: float = Field(0.0, description="用户扣费")

    is_cached: bool = Field(False, description="是否命中缓存")
    error_code: str | None = Field(None, max_length=64, description="统一错误码")

class GatewayLogCreate(GatewayLogBase):
    pass

class GatewayLogDTO(GatewayLogBase, IDSchema):
    # GatewayLog 没有 updated_at，只有 created_at
    created_at: Any # datetime, but Pydantic handles it
