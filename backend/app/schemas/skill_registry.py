from typing import Any

from pydantic import Field

from app.schemas.base import BaseSchema, TimestampSchema


class SkillRegistryBase(BaseSchema):
    name: str = Field(..., max_length=200, description="技能名称")
    status: str = Field("draft", max_length=20, description="技能状态: draft/active/disabled")
    type: str = Field("SKILL", max_length=20, description="资源类型: SKILL")
    runtime: str | None = Field(None, max_length=40, description="运行时类型（如 opensandbox）")
    version: str | None = Field(None, max_length=32, description="语义化版本号")
    description: str | None = Field(None, description="技能描述")
    source_repo: str | None = Field(None, max_length=1024, description="源码仓库地址")
    source_subdir: str | None = Field(None, max_length=255, description="源码子目录")
    source_revision: str | None = Field(None, max_length=128, description="源码版本/提交")
    risk_level: str | None = Field(None, max_length=20, description="风险等级")
    complexity_score: float | None = Field(None, description="复杂度评分")
    manifest_json: dict[str, Any] = Field(default_factory=dict, description="技能清单/Manifest")
    env_requirements: dict[str, Any] = Field(default_factory=dict, description="运行环境依赖")
    vector_id: str | None = Field(None, max_length=120, description="向量索引 ID")


class SkillRegistryCreate(SkillRegistryBase):
    id: str = Field(..., max_length=120, description="技能唯一标识（如 core.tools.crawler）")


class SkillRegistryUpdate(BaseSchema):
    name: str | None = Field(None, max_length=200, description="技能名称")
    status: str | None = Field(None, max_length=20, description="技能状态: draft/active/disabled")
    type: str | None = Field(None, max_length=20, description="资源类型: SKILL")
    runtime: str | None = Field(None, max_length=40, description="运行时类型（如 opensandbox）")
    version: str | None = Field(None, max_length=32, description="语义化版本号")
    description: str | None = Field(None, description="技能描述")
    source_repo: str | None = Field(None, max_length=1024, description="源码仓库地址")
    source_subdir: str | None = Field(None, max_length=255, description="源码子目录")
    source_revision: str | None = Field(None, max_length=128, description="源码版本/提交")
    risk_level: str | None = Field(None, max_length=20, description="风险等级")
    complexity_score: float | None = Field(None, description="复杂度评分")
    manifest_json: dict[str, Any] | None = Field(None, description="技能清单/Manifest")
    env_requirements: dict[str, Any] | None = Field(None, description="运行环境依赖")
    vector_id: str | None = Field(None, max_length=120, description="向量索引 ID")


class SkillRegistryDTO(SkillRegistryBase, TimestampSchema):
    id: str
