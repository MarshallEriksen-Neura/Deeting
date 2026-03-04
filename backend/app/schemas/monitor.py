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
from app.services.monitor_dispatch import (
    MonitorExecutionTarget,
    normalize_monitor_execution_target,
)

_ALLOWED_TOOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$")
_AGENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{1,63}$")


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
    execution_target: MonitorExecutionTarget = Field(
        default=MonitorExecutionTarget.CLOUD,
        description="执行目标: cloud | desktop | desktop_preferred",
    )

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

    @field_validator("execution_target", mode="before")
    @classmethod
    def _validate_execution_target(cls, value: Any) -> MonitorExecutionTarget:
        return normalize_monitor_execution_target(value)


class MonitorTaskUpdate(BaseSchema):
    title: str | None = Field(None, max_length=200, description="任务名称")
    objective: str | None = Field(None, description="核心目标 Prompt")
    cron_expr: str | None = Field(None, description="Cron 表达式")
    status: MonitorStatus | None = Field(None, description="任务状态")
    notify_config: dict[str, Any] | None = Field(None, description="触达配置")
    allowed_tools: list[str] | None = Field(None, description="允许的工具列表")
    execution_target: MonitorExecutionTarget | None = Field(
        None,
        description="执行目标: cloud | desktop | desktop_preferred",
    )

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

    @field_validator("execution_target", mode="before")
    @classmethod
    def _validate_optional_execution_target(
        cls, value: Any
    ) -> MonitorExecutionTarget | None:
        if value is None:
            return None
        return normalize_monitor_execution_target(value)


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
    execution_target: MonitorExecutionTarget = Field(..., description="执行目标")
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


def _normalize_agent_id(value: Any) -> str:
    agent_id = str(value or "").strip()
    if not _AGENT_ID_PATTERN.match(agent_id):
        raise ValueError("agent_id 非法，仅支持字母数字及 . _ : -，长度 2~64")
    return agent_id


class MonitorDesktopHeartbeatRequest(BaseSchema):
    agent_id: str = Field(..., description="桌面实例 ID")

    @field_validator("agent_id")
    @classmethod
    def _validate_agent_id(cls, value: str) -> str:
        return _normalize_agent_id(value)


class MonitorDesktopPullRequest(BaseSchema):
    agent_id: str = Field(..., description="桌面实例 ID")
    limit: int = Field(5, ge=1, le=20, description="单次拉取任务数量")

    @field_validator("agent_id")
    @classmethod
    def _validate_agent_id(cls, value: str) -> str:
        return _normalize_agent_id(value)


class MonitorDesktopTaskPayload(BaseSchema):
    task_id: UUID = Field(..., description="任务 ID")
    title: str = Field(..., description="任务标题")
    objective: str = Field(..., description="任务目标")
    cron_expr: str = Field(..., description="Cron 表达式")
    model_id: str | None = Field(None, description="建议模型 ID")
    allowed_tools: list[str] = Field(default_factory=list, description="允许工具列表")
    last_snapshot: dict[str, Any] = Field(default_factory=dict, description="最近快照")
    notify_config: dict[str, Any] = Field(default_factory=dict, description="触达配置（脱敏）")
    execution_target: MonitorExecutionTarget = Field(..., description="执行目标")
    claimed_until: datetime = Field(..., description="本次领取租约结束时间")


class MonitorDesktopPullResponse(BaseSchema):
    items: list[MonitorDesktopTaskPayload] = Field(default_factory=list, description="本次领取到的任务")
    claimed: int = Field(0, ge=0, description="本次领取数量")
    server_time: datetime = Field(..., description="服务端时间")


class MonitorDesktopReportRequest(BaseSchema):
    agent_id: str = Field(..., description="桌面实例 ID")
    status: str = Field(..., description="执行状态: success|failure|skipped")
    is_significant_change: bool = Field(False, description="是否检测到显著变化")
    change_summary: str = Field("", description="变化摘要")
    new_snapshot: dict[str, Any] = Field(default_factory=dict, description="新快照")
    tokens_used: int = Field(0, ge=0, description="本次 token 消耗")
    error_message: str | None = Field(None, description="失败原因")
    force_notify: bool = Field(False, description="是否强制触发通知")
    model_id: str | None = Field(None, description="本地执行使用的模型 ID")
    strategy: str | None = Field(None, description="本地执行策略标识")

    @field_validator("agent_id")
    @classmethod
    def _validate_agent_id(cls, value: str) -> str:
        return _normalize_agent_id(value)

    @field_validator("status")
    @classmethod
    def _validate_status(cls, value: str) -> str:
        status = str(value or "").strip().lower()
        if status not in {"success", "failure", "skipped"}:
            raise ValueError("status 仅支持 success/failure/skipped")
        return status
