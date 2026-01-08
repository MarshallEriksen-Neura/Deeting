"""
GatewayOrchestrator: 网关编排器

对外提供的高层接口，封装引擎创建和执行逻辑。
支持 FastAPI 依赖注入。
"""

import logging
from collections.abc import Sequence

from app.services.orchestrator.config import (
    WorkflowConfig,
    get_workflow_for_channel,
)
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.engine import ExecutionResult, OrchestrationEngine
from app.services.orchestrator.registry import StepNotFoundError, step_registry
from app.services.workflow.steps.base import BaseStep

logger = logging.getLogger(__name__)


class GatewayOrchestrator:
    """
    网关编排器

    职责：
    - 根据通道/能力选择编排模板
    - 从注册表获取步骤实例
    - 创建并执行编排引擎

    使用方式 (FastAPI):
        @router.post("/v1/chat/completions")
        async def chat(
            request: ChatRequest,
            orchestrator: GatewayOrchestrator = Depends(get_orchestrator),
        ):
            ctx = WorkflowContext(channel=Channel.EXTERNAL, ...)
            result = await orchestrator.execute(ctx)
    """

    def __init__(
        self,
        workflow_config: WorkflowConfig | None = None,
        custom_steps: Sequence[BaseStep] | None = None,
    ):
        """
        初始化编排器

        Args:
            workflow_config: 自定义编排配置，None 则根据上下文自动选择
            custom_steps: 自定义步骤实例，用于测试或特殊场景
        """
        self._workflow_config = workflow_config
        self._custom_steps = custom_steps
        self._engine: OrchestrationEngine | None = None

    def _build_engine(
        self,
        ctx: WorkflowContext,
    ) -> OrchestrationEngine:
        """
        构建执行引擎

        Args:
            ctx: 工作流上下文（用于选择模板）

        Returns:
            配置好的执行引擎
        """
        # 获取编排配置
        if self._workflow_config:
            config = self._workflow_config
        else:
            config = get_workflow_for_channel(
                ctx.channel,
                ctx.capability or "chat",
            )

        logger.debug(
            f"Building engine template={config.template.value} "
            f"steps={config.steps}"
        )

        # 获取步骤实例
        if self._custom_steps:
            steps = list(self._custom_steps)
        else:
            steps = []
            for step_name in config.steps:
                try:
                    step_config = config.step_configs.get(step_name)
                    step = step_registry.get(step_name, step_config)
                    steps.append(step)
                except StepNotFoundError:
                    logger.warning(
                        f"Step '{step_name}' not found, skipping. "
                        f"Make sure it's registered."
                    )

        return OrchestrationEngine(steps)

    async def execute(self, ctx: WorkflowContext) -> ExecutionResult:
        """
        执行编排流程

        Args:
            ctx: 工作流上下文

        Returns:
            执行结果
        """
        engine = self._build_engine(ctx)
        return await engine.execute(ctx)

    @classmethod
    def for_channel(
        cls,
        channel: Channel,
        capability: str = "chat",
    ) -> "GatewayOrchestrator":
        """
        工厂方法：根据通道创建编排器

        Args:
            channel: 通道类型
            capability: 能力类型

        Returns:
            配置好的编排器实例
        """
        config = get_workflow_for_channel(channel, capability)
        return cls(workflow_config=config)


# ===== FastAPI 依赖注入 =====


def get_orchestrator() -> GatewayOrchestrator:
    """
    FastAPI 依赖：获取编排器实例

    编排器会根据请求上下文自动选择合适的编排模板
    """
    return GatewayOrchestrator()


def get_external_orchestrator() -> GatewayOrchestrator:
    """FastAPI 依赖：获取外部通道编排器"""
    return GatewayOrchestrator.for_channel(Channel.EXTERNAL)


def get_internal_orchestrator() -> GatewayOrchestrator:
    """FastAPI 依赖：获取内部通道编排器"""
    return GatewayOrchestrator.for_channel(Channel.INTERNAL)
