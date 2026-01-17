from pydantic import Field

from app.schemas.base import BaseSchema


class SystemEmbeddingSettingDTO(BaseSchema):
    model_name: str | None = None


class SystemEmbeddingSettingUpdateRequest(BaseSchema):
    model_name: str = Field(..., max_length=128, description="Embedding 模型名称")
