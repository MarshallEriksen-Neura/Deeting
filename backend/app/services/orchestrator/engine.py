"""
OrchestrationEngine: 编排执行引擎

核心能力：
- 拓扑排序：按依赖关系排列步骤执行顺序
- 并行执行：无依赖的步骤使用 asyncio.gather 并行
- 重试/超时/降级：按步骤配置处理失败情况
- 观测打点：记录各步骤耗时、状态、重试次数
"""

import asyncio
import inspect
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field

from app.services.orchestrator.context import ErrorSource, WorkflowContext
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepResult,
    StepStatus,
)

logger = logging.getLogger(__name__)

STEP_STATUS_STAGE_MAP: dict[str, str] = {
    "request_adapter": "listen",
    "validation": "listen",
    "quota_check": "listen",
    "rate_limit": "listen",
    "conversation_load": "remember",
    "resolve_assets": "remember",
    "routing": "remember",
    "template_render": "evolve",
    "agent_executor": "evolve",
    "upstream_call": "evolve",
    "provider_execution": "evolve",
    "response_transform": "render",
    "conversation_append": "render",
    "memory_write": "render",
    "sanitize": "render",
    "billing": "render",
    "audit_log": "render",
}

class CyclicDependencyError(Exception):
    """循环依赖异常"""

    def __init__(self, cycle: list[str]):
        self.cycle = cycle
        super().__init__(f"Cyclic dependency detected: {' -> '.join(cycle)}")


class StepExecutionError(Exception):
    """步骤执行异常"""

    def __init__(
        self,
        step_name: str,
        original_error: Exception,
        attempts: int = 1,
    ):
        self.step_name = step_name
        self.original_error = original_error
        self.attempts = attempts
        super().__init__(
            f"Step '{step_name}' failed after {attempts} attempts: {original_error}"
        )


@dataclass
class ExecutionResult:
    """编排执行结果"""

    success: bool = True
    ctx: WorkflowContext | None = None
    failed_step: str | None = None
    error: Exception | None = None
    step_results: dict[str, StepResult] = field(default_factory=dict)


class OrchestrationEngine:
    """
    编排执行引擎

    使用方式:
        engine = OrchestrationEngine(steps=[
            ValidationStep(),
            RoutingStep(),
            UpstreamCallStep(),
        ])
        result = await engine.execute(ctx)
    """

    def __init__(self, steps: list[BaseStep]):
        """
        初始化引擎

        Args:
            steps: 步骤实例列表

        Raises:
            CyclicDependencyError: 存在循环依赖
        """
        self.steps = {step.name: step for step in steps}
        self._execution_layers: list[list[str]] | None = None
        self._validate_dag()

    def _validate_dag(self) -> None:
        """
        验证步骤依赖是有向无环图

        Raises:
            CyclicDependencyError: 存在循环依赖
            ValueError: 依赖的步骤不存在
        """
        # 检查依赖是否存在
        for name, step in self.steps.items():
            for dep in step.depends_on:
                if dep not in self.steps:
                    raise ValueError(
                        f"Step '{name}' depends on unknown step '{dep}'"
                    )

        # 使用 DFS 检测环
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {name: WHITE for name in self.steps}
        path = []

        def dfs(node: str) -> bool:
            color[node] = GRAY
            path.append(node)

            for dep in self.steps[node].depends_on:
                if color[dep] == GRAY:
                    # 找到环
                    cycle_start = path.index(dep)
                    raise CyclicDependencyError(path[cycle_start:] + [dep])
                if color[dep] == WHITE and dfs(dep):
                    return True

            color[node] = BLACK
            path.pop()
            return False

        for node in self.steps:
            if color[node] == WHITE:
                dfs(node)

    def _get_execution_layers(self) -> list[list[str]]:
        """
        按依赖分层，同层可并行执行

        Returns:
            分层的步骤名称列表，每层内可并行
        """
        if self._execution_layers is not None:
            return self._execution_layers

        in_degree: dict[str, int] = defaultdict(int)
        dependents: dict[str, list[str]] = defaultdict(list)

        # 构建依赖图
        for name, step in self.steps.items():
            for dep in step.depends_on:
                dependents[dep].append(name)
                in_degree[name] += 1

        # Kahn's algorithm 拓扑排序
        layers: list[list[str]] = []
        queue = [n for n in self.steps if in_degree[n] == 0]

        while queue:
            layers.append(queue)
            next_queue = []
            for node in queue:
                for neighbor in dependents[node]:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        next_queue.append(neighbor)
            queue = next_queue

        self._execution_layers = layers
        return layers

    async def execute(self, ctx: WorkflowContext) -> ExecutionResult:
        """
        执行编排流程

        Args:
            ctx: 工作流上下文

        Returns:
            ExecutionResult: 执行结果
        """
        result = ExecutionResult(ctx=ctx)
        layers = self._get_execution_layers()

        logger.info(
            f"Starting orchestration trace_id={ctx.trace_id} "
            f"channel={ctx.channel.value} layers={len(layers)}"
        )

        try:
            for layer_idx, layer in enumerate(layers):
                logger.debug(
                    f"Executing layer {layer_idx + 1}/{len(layers)}: {layer}"
                )

                # 过滤需要跳过的步骤
                executable = []
                for step_name in layer:
                    step = self.steps[step_name]
                    if step.should_skip(ctx):
                        logger.debug(f"Skipping step: {step_name}")
                        await step.on_skip(ctx)
                        result.step_results[step_name] = StepResult(
                            status=StepStatus.SKIPPED
                        )
                    else:
                        executable.append(step_name)

                if not executable:
                    continue

                if ctx.db_session is None and len(executable) > 1:
                    # 并行执行同层步骤（无共享 DB Session 时）
                    tasks = [
                        self._execute_step(self.steps[name], ctx, result)
                        for name in executable
                    ]
                    await asyncio.gather(*tasks)
                else:
                    # 共享 AsyncSession 时串行，避免并发访问同一 Session
                    for name in executable:
                        await self._execute_step(self.steps[name], ctx, result)

                # 检查是否有步骤失败导致中止
                for step_name in executable:
                    step_result = result.step_results.get(step_name)
                    if step_result and step_result.status == StepStatus.FAILED:
                        if not ctx.error_code:
                            ctx.mark_error(
                                ErrorSource.GATEWAY,
                                f"{step_name.upper()}_FAILED",
                                step_result.message or "Step failed",
                            )
                        result.success = False
                        result.failed_step = step_name
                        ctx.failed_step = step_name
                        logger.error(
                            f"Orchestration aborted at step={step_name} "
                            f"trace_id={ctx.trace_id}"
                        )
                        return result

        except Exception as e:
            result.success = False
            result.error = e
            if not ctx.error_code:
                ctx.mark_error(ErrorSource.GATEWAY, "ORCHESTRATION_ERROR", str(e))
            logger.exception(f"Orchestration failed trace_id={ctx.trace_id}")

        logger.info(
            f"Orchestration completed trace_id={ctx.trace_id} "
            f"success={result.success} "
            f"total_ms={sum(ctx.step_timings.values()):.2f}"
        )

        return result

    async def _execute_step(
        self,
        step: BaseStep,
        ctx: WorkflowContext,
        result: ExecutionResult,
    ) -> None:
        """
        执行单个步骤（带重试/超时/降级）

        Args:
            step: 步骤实例
            ctx: 工作流上下文
            result: 执行结果收集器
        """
        attempt = 0
        max_attempts = step.config.max_retries + 1
        last_error: Exception | None = None

        while attempt < max_attempts:
            attempt += 1
            start_time = time.perf_counter()

            try:
                stage = STEP_STATUS_STAGE_MAP.get(step.name)
                if stage:
                    ctx.emit_status(stage=stage, step=step.name, state="running")

                # 带超时执行
                step_result = await asyncio.wait_for(
                    step.execute(ctx),
                    timeout=step.config.timeout,
                )

                duration_ms = (time.perf_counter() - start_time) * 1000
                step_result.duration_ms = duration_ms
                ctx.mark_step_executed(step.name, duration_ms)
                result.step_results[step.name] = step_result

                logger.debug(
                    f"Step {step.name} completed "
                    f"status={step_result.status.value} "
                    f"duration_ms={duration_ms:.2f}"
                )
                return

            except TimeoutError as e:
                last_error = e
                logger.warning(
                    f"Step {step.name} timed out "
                    f"attempt={attempt}/{max_attempts} "
                    f"timeout={step.config.timeout}s"
                )

            except Exception as e:
                last_error = e
                logger.warning(
                    f"Step {step.name} failed "
                    f"attempt={attempt}/{max_attempts} "
                    f"error={e}"
                )

            # 决定后续动作
            action = step.on_failure(ctx, last_error, attempt)
            if inspect.isawaitable(action):
                action = await action

            if action == FailureAction.RETRY and attempt < max_attempts:
                # 计算退避延迟
                delay = step.config.retry_delay * (
                    step.config.retry_backoff ** (attempt - 1)
                )
                logger.debug(f"Retrying step {step.name} after {delay}s")
                await asyncio.sleep(delay)
                continue

            elif action == FailureAction.SKIP:
                logger.info(f"Skipping failed step {step.name}")
                result.step_results[step.name] = StepResult(
                    status=StepStatus.SKIPPED,
                    message=str(last_error),
                )
                return

            elif action == FailureAction.DEGRADE:
                logger.info(f"Degrading step {step.name}")
                degrade_result = await step.on_degrade(ctx, last_error)
                result.step_results[step.name] = degrade_result
                ctx.mark_step_executed(
                    step.name,
                    (time.perf_counter() - start_time) * 1000,
                )
                return

            else:  # ABORT
                break

        # 所有重试耗尽，标记失败
        duration_ms = (time.perf_counter() - start_time) * 1000
        result.step_results[step.name] = StepResult(
            status=StepStatus.FAILED,
            message=str(last_error),
            duration_ms=duration_ms,
        )
        ctx.mark_step_executed(step.name, duration_ms)
        ctx.mark_error(
            ErrorSource.GATEWAY,
            f"{step.name.upper()}_FAILED",
            str(last_error),
        )

        raise StepExecutionError(step.name, last_error, attempt)
