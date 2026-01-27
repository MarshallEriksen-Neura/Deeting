from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema
from app.schemas.spec_agent import SpecManifest, SpecNode


class SpecDraftRequest(BaseSchema):
    query: str = Field(..., min_length=1, description="用户需求描述")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文补充信息")
    model: Optional[str] = Field(default=None, description="规划阶段使用的模型")


class SpecDraftResponse(BaseSchema):
    plan_id: UUID = Field(..., description="生成的计划 ID")
    manifest: SpecManifest


class SpecExecutionStatus(BaseSchema):
    status: Literal["drafting", "running", "waiting", "completed", "error"] = Field(
        ..., description="计划执行状态"
    )
    progress: int = Field(0, ge=0, le=100, description="进度百分比")


class SpecNodeStatus(BaseSchema):
    id: str = Field(..., description="节点 ID")
    status: Literal["pending", "active", "completed", "error", "waiting"] = Field(
        ..., description="节点状态"
    )
    duration_ms: Optional[int] = Field(None, description="节点耗时（毫秒）")
    output_preview: Optional[str] = Field(None, description="输出预览或错误摘要")
    pulse: Optional[str] = Field(None, description="运行中提示文案")
    skipped: bool = Field(False, description="是否被剪枝跳过")
    logs: List[str] = Field(default_factory=list, description="节点执行日志")


class SpecNodeExecutionDetail(BaseSchema):
    status: Literal["pending", "active", "completed", "error", "waiting"] = Field(
        ..., description="节点状态"
    )
    created_at: Optional[datetime] = Field(None, description="日志创建时间")
    started_at: Optional[datetime] = Field(None, description="节点开始时间")
    completed_at: Optional[datetime] = Field(None, description="节点完成时间")
    duration_ms: Optional[int] = Field(None, description="节点耗时（毫秒）")
    input_snapshot: Optional[Dict[str, Any]] = Field(None, description="输入快照")
    output_data: Optional[Dict[str, Any]] = Field(None, description="输出数据")
    raw_response: Optional[Any] = Field(None, description="原始响应")
    error_message: Optional[str] = Field(None, description="错误信息")
    worker_snapshot: Optional[Dict[str, Any]] = Field(
        None, description="执行器快照"
    )
    logs: List[str] = Field(default_factory=list, description="节点执行日志")


class SpecPlanNodeDetailResponse(BaseSchema):
    plan_id: UUID
    node_id: str
    node: SpecNode
    execution: SpecNodeExecutionDetail


class SpecPlanNodeRerunResponse(BaseSchema):
    plan_id: UUID
    node_id: str
    queued_nodes: List[str] = Field(default_factory=list, description="被重跑的节点")


class SpecPlanNodeEventRequest(BaseSchema):
    event: str = Field(..., description="事件名称")
    source: str = Field(..., description="触发来源")
    payload: Optional[Dict[str, Any]] = Field(
        default=None, description="事件附加信息（如 edit_distance/error_code 等）"
    )


class SpecPlanNodeEventResponse(BaseSchema):
    status: str = Field(..., description="处理结果")


class SpecPlanStatusResponse(BaseSchema):
    execution: SpecExecutionStatus
    nodes: List[SpecNodeStatus]
    checkpoint: Optional[Dict[str, Any]] = Field(
        None, description="当前需要用户审批的检查点"
    )


class SpecPlanDetailResponse(BaseSchema):
    id: UUID
    conversation_session_id: UUID | None = None
    project_name: str
    manifest: SpecManifest
    connections: List[Dict[str, str]]
    execution: SpecExecutionStatus


class SpecPlanListItem(BaseSchema):
    id: UUID
    project_name: str
    status: str
    created_at: datetime
    updated_at: datetime


class SpecPlanStartResponse(BaseSchema):
    status: str = Field(..., description="执行器返回状态")
    executed: Optional[int] = Field(None, description="本次推进的节点数")
    nodes: Optional[List[str]] = Field(None, description="相关节点列表")


class SpecPlanInteractRequest(BaseSchema):
    node_id: str = Field(..., description="审批节点 ID")
    decision: Literal["approve", "reject", "modify"] = Field(..., description="用户决策")
    feedback: Optional[str] = Field(None, description="用户补充意见")


class SpecPlanInteractResponse(BaseSchema):
    plan_id: UUID
    node_id: str
    decision: Literal["approve", "reject", "modify"]


class SpecPlanNodeUpdateRequest(BaseSchema):
    model_override: Optional[str] = Field(
        None, description="节点级模型覆盖，传 null 则清空"
    )
    instruction: Optional[str] = Field(
        None, description="节点指令更新（仅 action 节点，等待审批时可用）"
    )


class SpecPlanNodeUpdateResponse(BaseSchema):
    plan_id: UUID
    node_id: str
    model_override: Optional[str] = None
    instruction: Optional[str] = None
    pending_instruction: Optional[str] = None
