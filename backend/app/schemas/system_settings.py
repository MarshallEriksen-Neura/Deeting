from pydantic import Field, field_validator

from app.schemas.base import BaseSchema


class SystemEmbeddingSettingDTO(BaseSchema):
    model_name: str | None = None


class SystemEmbeddingSettingUpdateRequest(BaseSchema):
    model_name: str = Field(..., max_length=128, description="Embedding 模型名称")


class SystemRechargePolicyDTO(BaseSchema):
    credit_per_unit: float = Field(
        ..., gt=0, description="每 1 单位货币对应的积分数量"
    )
    currency: str = Field(..., min_length=1, max_length=16, description="货币代码")


class SystemRechargePolicyUpdateRequest(BaseSchema):
    credit_per_unit: float = Field(
        ..., gt=0, description="每 1 单位货币对应的积分数量"
    )
    currency: str = Field("USD", min_length=1, max_length=16, description="货币代码")

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("currency cannot be empty")
        return normalized
