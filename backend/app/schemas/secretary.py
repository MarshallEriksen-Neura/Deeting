from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class UserSecretaryDTO(IDSchema, TimestampSchema):
    user_id: UUID
    name: str
    model_name: str | None = None


class UserSecretaryUpdateRequest(BaseSchema):
    model_name: str | None = Field(None, max_length=128, description="秘书模型名称")
