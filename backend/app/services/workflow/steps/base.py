"""
BaseStep: 原子步骤抽象基类

所有编排步骤必须继承此基类，实现统一接口。
禁止在路由里用 if/else 手写分支，统一通过步骤注册表管理。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext


class StepStatus(str, Enum):
    """步骤执行状态"""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    DEGRADED = "degraded"  # 降级执行


class FailureAction(str, Enum):
    """失败后的处理动作"""

    RETRY = "retry"  # 重试
    SKIP = "skip"  # 跳过当前步骤继续
    DEGRADE = "degrade"  # 降级（如切换备用上游）
    ABORT = "abort"  # 中止整个流程


@dataclass
class StepResult:
    """步骤执行结果"""

    status: StepStatus = StepStatus.SUCCESS
    message: str | None = None
    data: dict | None = None
    duration_ms: float = 0.0


@dataclass
class StepConfig:
    """步骤配置（可从 DB/JSON 加载）"""

    timeout: float = 30.0  # 超时秒数
    max_retries: int = 0  # 最大重试次数
    retry_delay: float = 1.0  # 重试间隔秒数
    retry_backoff: float = 2.0  # 重试退避倍数
    enabled: bool = True  # 是否启用
    skip_on_channels: list[str] = field(default_factory=list)  # 在这些通道跳过


class BaseStep(ABC):
    """
    原子步骤抽象基类

    子类必须实现:
    - name: 步骤唯一标识
    - execute(): 执行逻辑

    可选覆盖:
    - depends_on: 依赖的步骤列表
    - retry_on: 可重试的异常类型
    - on_failure(): 失败回调
    - should_skip(): 是否跳过
    """

    # ===== 必须定义 =====
    name: str  # 步骤唯一标识，如 "validation", "routing"

    # ===== 可选配置 =====
    depends_on: list[str] = []  # 依赖的步骤名称列表
    retry_on: tuple[type[Exception], ...] = ()  # 可重试的异常类型

    def __init__(self, config: StepConfig | None = None):
        """
        初始化步骤

        Args:
            config: 步骤配置，可从 DB/JSON 加载覆盖默认值
        """
        self.config = config or StepConfig()

    @abstractmethod
    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """
        执行步骤核心逻辑

        Args:
            ctx: 工作流上下文

        Returns:
            StepResult: 执行结果

        Raises:
            可抛出异常，由引擎捕获处理
        """
        pass

    async def on_failure(
        self,
        ctx: "WorkflowContext",
        error: Exception,
        attempt: int,
    ) -> FailureAction:
        """
        失败回调：决定重试/跳过/降级/中止

        Args:
            ctx: 工作流上下文
            error: 捕获的异常
            attempt: 当前重试次数（从 1 开始）

        Returns:
            FailureAction: 后续处理动作
        """
        # 默认：可重试异常且未超限则重试，否则中止
        if isinstance(error, self.retry_on) and attempt <= self.config.max_retries:
            return FailureAction.RETRY
        return FailureAction.ABORT

    async def on_skip(self, ctx: "WorkflowContext") -> None:
        """
        跳过回调：步骤被跳过时的处理

        可用于设置默认值或记录日志
        """
        pass

    async def on_degrade(
        self,
        ctx: "WorkflowContext",
        error: Exception,
    ) -> StepResult:
        """
        降级回调：返回降级响应

        子类可覆盖以提供备用逻辑（如切换上游）
        """
        return StepResult(
            status=StepStatus.DEGRADED,
            message=f"Step {self.name} degraded: {error}",
        )

    def should_skip(self, ctx: "WorkflowContext") -> bool:
        """
        判断是否应该跳过此步骤

        Args:
            ctx: 工作流上下文

        Returns:
            True 则跳过执行
        """
        # 步骤未启用
        if not self.config.enabled:
            return True

        # 当前通道在跳过列表中
        if ctx.channel.value in self.config.skip_on_channels:
            return True

        return False

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name}>"
