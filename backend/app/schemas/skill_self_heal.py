from typing import Any

from pydantic import Field

from app.schemas.base import BaseSchema


class SkillSelfHealPatch(BaseSchema):
    path: str = Field(..., description="修复目标路径（JSONPath/字段路径）")
    action: str = Field(..., description="修复动作: set/remove/append/replace")
    value: Any | None = Field(None, description="写入或替换的值")
    reason: str | None = Field(None, description="修复原因说明")


class SkillSelfHealRequest(BaseSchema):
    skill_id: str = Field(..., description="技能唯一标识")
    error_code: str | None = Field(None, description="错误码")
    error_message: str | None = Field(None, description="错误信息")
    manifest_json: dict[str, Any] = Field(default_factory=dict, description="原始 manifest 数据")
    logs: list[str] = Field(default_factory=list, description="相关日志片段")
    runtime: str | None = Field(None, description="运行时类型")
    intent: str | None = Field(None, description="用户意图")


class SkillSelfHealResponse(BaseSchema):
    status: str = Field(..., description="修复状态: success/failed/noop")
    summary: str | None = Field(None, description="修复摘要")
    patches: list[SkillSelfHealPatch] = Field(default_factory=list, description="修复补丁列表")
    updated_manifest: dict[str, Any] | None = Field(None, description="修复后的 manifest")
    warnings: list[str] = Field(default_factory=list, description="修复警告")
    error: str | None = Field(None, description="失败原因")


class SkillSelfHealResult(BaseSchema):
    request: SkillSelfHealRequest
    response: SkillSelfHealResponse
    elapsed_ms: int | None = Field(None, description="修复耗时（毫秒）")
