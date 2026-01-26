from __future__ import annotations

from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema
from app.schemas.spec_agent import SpecManifest


class SpecDraftRequest(BaseSchema):
    query: str = Field(..., min_length=1, description="用户需求描述")
    context: Optional[Dict[str, Any]] = Field(default=None, description="上下文补充信息")


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


class SpecPlanStatusResponse(BaseSchema):
    execution: SpecExecutionStatus
    nodes: List[SpecNodeStatus]
    checkpoint: Optional[Dict[str, Any]] = Field(
        None, description="当前需要用户审批的检查点"
    )


class SpecPlanDetailResponse(BaseSchema):
    id: UUID
    project_name: str
    manifest: SpecManifest
    connections: List[Dict[str, str]]
    execution: SpecExecutionStatus


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
