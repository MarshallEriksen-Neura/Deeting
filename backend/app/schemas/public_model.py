
from pydantic import Field

from .base import BaseSchema, IDSchema, TimestampSchema


class PublicModelBase(BaseSchema):
    model_id: str = Field(..., max_length=128, description="模型唯一标识 (如 gpt-4o)")
    display_name: str = Field(..., max_length=128, description="展示名称")
    family: str | None = Field(None, max_length=64, description="模型家族")
    type: str = Field(..., max_length=32, description="模型类型")

    context_window: int | None = Field(None, description="上下文窗口大小")
    description: str | None = Field(None, description="模型描述")
    icon_url: str | None = Field(None, max_length=255, description="图标 URL")

    input_price_display: str | None = Field(None, max_length=64, description="输入价格展示")
    output_price_display: str | None = Field(None, max_length=64, description="输出价格展示")

    sort_order: int = Field(0, description="排序权重")
    is_public: bool = Field(True, description="是否公开可见")

class PublicModelCreate(PublicModelBase):
    pass

class PublicModelUpdate(BaseSchema):
    display_name: str | None = Field(None, max_length=128)
    family: str | None = Field(None, max_length=64)
    type: str | None = Field(None, max_length=32)
    context_window: int | None = None
    description: str | None = None
    icon_url: str | None = Field(None, max_length=255)
    input_price_display: str | None = Field(None, max_length=64)
    output_price_display: str | None = Field(None, max_length=64)
    sort_order: int | None = None
    is_public: bool | None = None

class PublicModelDTO(PublicModelBase, IDSchema, TimestampSchema):
    pass
