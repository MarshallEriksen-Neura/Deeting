from __future__ import annotations

from datetime import datetime
import re
from typing import Any
from uuid import UUID

from pydantic import Field
from pydantic import field_validator

from app.models.monitor import MonitorStatus
from app.schemas.base import BaseSchema
from app.services.monitor_cron import validate_cron_expr

_ALLOWED_TOOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$")


def _normalize_allowed_tools(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        name = str(raw or "").strip()
        if not name:
            continue
        if not _ALLOWED_TOOL_PATTERN.match(name):
            raise ValueError(f"allowed_tools 含非法工具名: {name}")
        if name in seen:
            continue
        seen.add(name)
        normalized.append(name)
    if len(normalized) > 32:
        raise ValueError("allowed_tools 最多允许 32 个工具")
    return normalized


class MonitorTaskCreate(BaseSchema):
    title: str = Field(..., max_length=200, description="任务名称")
    objective: str = Field(..., description="核心目标 Prompt")
    cron_expr: str = Field("0 */6 * * *", description="Cron 表达式")
    notify_config: dict[str, Any] = Field(default_factory=dict, description="触达配置")
    allowed_tools: list[str] = Field(default_factory=list, description="允许的工具列表")

    @field_validator("cron_expr")
    @classmethod
    def _validate_cron_expr(cls, value: str) -> str:
        ok, error = validate_cron_expr(value)
        if not ok:
            raise ValueError(f"Cron 表达式非法: {error}")
        return value.strip()

    @field_validator("allowed_tools")
    @classmethod
    def _validate_allowed_tools(cls, value: list[str]) -> list[str]:
        return _normalize_allowed_tools(value)


class MonitorTaskUpdate(BaseSchema):
    title: str | None = Field(None, max_length=200, description="任务名称")
    objective: str | None = Field(None, description="核心目标 Prompt")
    cron_expr: str | None = Field(None, description="Cron 表达式")
    status: MonitorStatus | None = Field(None, description="任务状态")
    notify_config: dict[str, Any] | None = Field(None, description="触达配置")
    allowed_tools: list[str] | None = Field(None, description="允许的工具列表")

    @field_validator("cron_expr")
    @classmethod
    def _validate_optional_cron_expr(cls, value: str | None) -> str | None:
        if value is None:
            return value
        ok, error = validate_cron_expr(value)
        if not ok:
            raise ValueError(f"Cron 表达式非法: {error}")
        return value.strip()

    @field_validator("allowed_tools")
    @classmethod
    def _validate_optional_allowed_tools(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return _normalize_allowed_tools(value)


class MonitorTaskResponse(BaseSchema):
    id: UUID = Field(..., description="任务 ID")
    user_id: UUID = Field(..., description="用户 ID")
    title: str = Field(..., description="任务名称")
    objective: str = Field(..., description="核心目标 Prompt")
    cron_expr: str = Field(..., description="Cron 表达式")
    status: MonitorStatus = Field(..., description="任务状态")
    last_snapshot: dict[str, Any] | None = Field(None, description="最后快照")
    last_executed_at: datetime | None = Field(None, description="最后执行时间")
    error_count: int = Field(..., description="连续失败次数")
    notify_config: dict[str, Any] = Field(..., description="触达配置")
    allowed_tools: list[str] = Field(..., description="允许的工具")
    total_tokens: int = Field(..., description="累计 Token 消耗")
    is_active: bool = Field(..., description="是否有效")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")


class MonitorTaskListResponse(BaseSchema):
    items: list[MonitorTaskResponse] = Field(default_factory=list, description="任务列表")
    total: int = Field(..., ge=0, description="总数")
    skip: int = Field(..., ge=0, description="跳过数量")
    limit: int = Field(..., ge=1, description="每页数量")


class MonitorExecutionLogResponse(BaseSchema):
    id: UUID = Field(..., description="日志 ID")
    task_id: UUID = Field(..., description="任务 ID")
    triggered_at: datetime = Field(..., description="触发时间")
    status: str = Field(..., description="执行状态")
    input_data: dict[str, Any] | None = Field(None, description="输入数据")
    output_data: dict[str, Any] | None = Field(None, description="输出数据")
    tokens_used: int = Field(..., description="Token 消耗")
    error_message: str | None = Field(None, description="错误信息")
    created_at: datetime = Field(..., description="创建时间")


class MonitorExecutionLogListResponse(BaseSchema):
    items: list[MonitorExecutionLogResponse] = Field(default_factory=list, description="执行日志列表")
    total: int = Field(..., ge=0, description="总数")
    skip: int = Field(..., ge=0, description="跳过数量")
    limit: int = Field(..., ge=1, description="每页数量")


class MonitorStatsResponse(BaseSchema):
    total_tasks: int = Field(..., description="总任务数")
    active_tasks: int = Field(..., description="活跃任务数")
    paused_tasks: int = Field(..., description="暂停任务数")
    failed_suspended_tasks: int = Field(..., description="熔断任务数")
    total_tokens: int = Field(..., description="总 Token 消耗")
    total_executions: int = Field(..., description="总执行次数")


class MonitorTriggerRequest(BaseSchema):
    task_id: UUID = Field(..., description="任务 ID")
