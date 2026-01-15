from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.models.assistant import AssistantStatus, AssistantVisibility
from .base import BaseSchema, IDSchema, TimestampSchema


class AssistantVersionBase(BaseSchema):
    name: str = Field(..., max_length=100, description="版本名称/展示名")
    description: str | None = Field(None, description="描述/用途说明")
    system_prompt: str = Field(..., description="系统提示词内容")
    config: dict[str, Any] = Field(
        default_factory=dict,
        description="模型与参数配置",
        alias="model_config",
        validation_alias="model_config",
        serialization_alias="model_config",
    )
    skill_refs: list[dict[str, Any]] = Field(
        default_factory=list,
        description="依赖的技能列表，元素包含 skill_id/version 等",
    )
    tags: list[str] = Field(default_factory=list, description="标签列表")
    changelog: str | None = Field(None, description="版本变更说明")


class AssistantVersionCreate(AssistantVersionBase):
    version: str = Field("0.1.0", max_length=32, description="语义化版本号")


class AssistantVersionUpdate(BaseSchema):
    version: str | None = Field(None, max_length=32)
    name: str | None = Field(None, max_length=100)
    description: str | None = None
    system_prompt: str | None = None
    config: dict[str, Any] | None = Field(
        None,
        alias="model_config",
        validation_alias="model_config",
        serialization_alias="model_config",
    )
    skill_refs: list[dict[str, Any]] | None = None
    tags: list[str] | None = None
    changelog: str | None = None
    published_at: datetime | None = None


class AssistantVersionDTO(AssistantVersionBase, IDSchema, TimestampSchema):
    assistant_id: UUID
    version: str
    published_at: datetime | None = None


class AssistantBase(BaseSchema):
    visibility: AssistantVisibility = Field(
        AssistantVisibility.PRIVATE,
        description="可见性: private/unlisted/public",
    )
    status: AssistantStatus = Field(
        AssistantStatus.DRAFT,
        description="发布状态: draft/published/archived",
    )
    share_slug: str | None = Field(None, max_length=64, description="分享访问标识（unlisted/public 使用）")
    summary: str | None = Field(None, max_length=200, description="助手简介（两行展示）")
    icon_id: str | None = Field(None, max_length=255, description="图标 ID（如 lucide:bot）")


class AssistantCreate(AssistantBase):
    version: AssistantVersionCreate


class AssistantUpdate(BaseSchema):
    visibility: AssistantVisibility | None = None
    status: AssistantStatus | None = None
    share_slug: str | None = Field(None, max_length=64)
    current_version_id: UUID | None = None
    summary: str | None = Field(None, max_length=200)
    icon_id: str | None = Field(None, max_length=255)


class AssistantDTO(AssistantBase, IDSchema, TimestampSchema):
    owner_user_id: UUID | None = None
    current_version_id: UUID | None = None
    published_at: datetime | None = None
    versions: list[AssistantVersionDTO] = Field(default_factory=list)
    install_count: int = 0
    rating_avg: float = 0.0
    rating_count: int = 0


class AssistantPublishRequest(BaseSchema):
    version_id: UUID | None = Field(
        None,
        description="可选：发布时切换到指定版本；为空则使用当前版本",
    )


class AssistantListResponse(BaseSchema):
    items: list[AssistantDTO]
    next_cursor: str | None = Field(None, description="下页游标，若为空则无更多数据")
    size: int = Field(..., description="本页返回数量")
