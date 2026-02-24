from __future__ import annotations

from uuid import UUID

from pydantic import Field, HttpUrl

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class PluginSubmitRequest(BaseSchema):
    repo_url: HttpUrl = Field(..., description="GitHub 仓库 URL")
    revision: str = Field("main", max_length=128, description="分支或 Tag")
    skill_id: str | None = Field(None, max_length=120, description="可选技能 ID")
    runtime_hint: str | None = Field(
        None, max_length=40, description="可选运行时提示（如 opensandbox）"
    )


class PluginSubmitResponse(BaseSchema):
    status: str = Field(..., description="任务状态")
    task_id: str = Field(..., description="异步任务 ID")


class PluginMarketSkillItem(TimestampSchema):
    id: str
    name: str
    description: str | None = None
    version: str | None = None
    source_repo: str | None = None
    source_revision: str | None = None
    status: str
    installed: bool = False


class PluginInstallRequest(BaseSchema):
    alias: str | None = Field(None, max_length=120)
    config_json: dict = Field(default_factory=dict)


class PluginInstallationItem(IDSchema, TimestampSchema):
    user_id: UUID
    skill_id: str
    alias: str | None = None
    config_json: dict = Field(default_factory=dict)
    granted_permissions: list[str] = Field(default_factory=list)
    installed_revision: str | None = None
    is_enabled: bool


class PluginUiSessionRequest(BaseSchema):
    ttl_seconds: int = Field(300, ge=30, le=1800, description="UI 会话令牌有效期（秒）")


class PluginUiSessionResponse(BaseSchema):
    skill_id: str
    revision: str
    renderer_asset_path: str
    renderer_url: str
    expires_at: int
