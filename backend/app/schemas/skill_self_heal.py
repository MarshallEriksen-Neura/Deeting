from pydantic import Field

from app.schemas.base import BaseSchema


class SkillSelfHealResult(BaseSchema):
    status: str = Field(..., description="self-heal status")
    updated_fields: list[str] = Field(default_factory=list, description="updated manifest fields")
    error_code: str | None = Field(None, description="error code")
    error_message: str | None = Field(None, description="error message")
