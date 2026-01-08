"""
Orchestrator 编排模块

提供网关请求的步骤化编排执行能力：
- 拓扑排序 + 并行执行
- 重试/超时/降级
- 内外通道差异化配置
- 观测与审计打点

使用方式:
    from app.services.orchestrator import (
        GatewayOrchestrator,
        WorkflowContext,
        Channel,
        get_orchestrator,
    )

    # FastAPI 路由中使用
    @router.post("/v1/chat/completions")
    async def chat(
        request: ChatRequest,
        orchestrator: GatewayOrchestrator = Depends(get_orchestrator),
    ):
        ctx = WorkflowContext(
            channel=Channel.EXTERNAL,
            tenant_id=...,
            capability="chat",
        )
        ctx.set("validation", "request", request)

        result = await orchestrator.execute(ctx)
        return result.ctx.get("response_transform", "response")
"""

# 导入 workflow.steps 以触发步骤注册
import app.services.workflow.steps  # noqa: F401
from app.services.orchestrator.config import (
    WORKFLOW_TEMPLATES,
    WorkflowConfig,
    WorkflowTemplate,
    get_workflow_for_channel,
)
from app.services.orchestrator.context import (
    BillingInfo,
    Channel,
    ErrorSource,
    UpstreamResult,
    WorkflowContext,
)
from app.services.orchestrator.engine import (
    CyclicDependencyError,
    ExecutionResult,
    OrchestrationEngine,
    StepExecutionError,
)
from app.services.orchestrator.orchestrator import (
    GatewayOrchestrator,
    get_external_orchestrator,
    get_internal_orchestrator,
    get_orchestrator,
)
from app.services.orchestrator.registry import (
    StepNotFoundError,
    StepRegistry,
    step_registry,
)

__all__ = [
    # Context
    "WorkflowContext",
    "Channel",
    "ErrorSource",
    "UpstreamResult",
    "BillingInfo",
    # Engine
    "OrchestrationEngine",
    "ExecutionResult",
    "CyclicDependencyError",
    "StepExecutionError",
    # Registry
    "StepRegistry",
    "step_registry",
    "StepNotFoundError",
    # Config
    "WorkflowConfig",
    "WorkflowTemplate",
    "WORKFLOW_TEMPLATES",
    "get_workflow_for_channel",
    # Orchestrator
    "GatewayOrchestrator",
    "get_orchestrator",
    "get_external_orchestrator",
    "get_internal_orchestrator",
]
