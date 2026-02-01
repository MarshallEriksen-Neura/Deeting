from pydantic import Field

from app.schemas.base import BaseSchema, TimestampSchema


class SkillRegistryBase(BaseSchema):
    name: str = Field(..., max_length=200, description="技能名称")
    status: str = Field("draft", max_length=20, description="技能状态: draft/active/disabled")


class SkillRegistryCreate(SkillRegistryBase):
    id: str = Field(..., max_length=120, description="技能唯一标识（如 core.tools.crawler）")


class SkillRegistryUpdate(BaseSchema):
    name: str | None = Field(None, max_length=200, description="技能名称")
    status: str | None = Field(None, max_length=20, description="技能状态: draft/active/disabled")


class SkillRegistryDTO(SkillRegistryBase, TimestampSchema):
    id: str
