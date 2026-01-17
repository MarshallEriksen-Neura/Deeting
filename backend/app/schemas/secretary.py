from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class UserSecretaryDTO(IDSchema, TimestampSchema):
    user_id: UUID
    current_phase_id: UUID
    name: str
    model_name: str | None = None
    embedding_model: str | None = None
    topic_naming_model: str | None = None


class UserSecretaryUpdateRequest(BaseSchema):
    model_name: str | None = Field(None, max_length=128, description="秘书模型名称")
    embedding_model: str | None = Field(None, max_length=128, description="秘书 embedding 模型名称")
    topic_naming_model: str | None = Field(None, max_length=128, description="话题自动命名模型名称")
