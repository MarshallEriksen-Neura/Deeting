"""
RoutingStep: 路由决策步骤

职责：
- 按 capability + model 选择 provider preset item
- 按 priority/weight 排序
- 支持 Bandit 算法选择最优上游
"""

import logging
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestrator.registry import step_registry
from app.services.workflow.steps.base import (
    BaseStep,
    FailureAction,
    StepResult,
    StepStatus,
)

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


def _extract_provider_filters(scopes: list[str] | None) -> tuple[set[str], set[str], set[str]]:
    """
    从 scopes（形如 'provider:openai'）解析出 provider/preset/preset_item 限制。
    """
    providers: set[str] = set()
    presets: set[str] = set()
    preset_items: set[str] = set()

    if not scopes:
        return providers, presets, preset_items

    for scope in scopes:
        if not scope or ":" not in scope:
            continue
        scope_type, scope_value = scope.split(":", 1)
        match scope_type:
            case "provider":
                providers.add(scope_value)
            case "preset":
                presets.add(scope_value)
            case "preset_item":
                preset_items.add(scope_value)
    return providers, presets, preset_items


class NoAvailableUpstreamError(Exception):
    """无可用上游异常"""

    pass


@step_registry.register
class RoutingStep(BaseStep):
    """
    路由决策步骤

    从上下文读取:
        - validation.model: 请求的模型名称

    写入上下文:
        - routing.preset_id: 选中的 preset ID
        - routing.preset_item_id: 选中的 preset item ID
        - routing.upstream_url: 上游 URL
        - routing.provider: 提供商名称

    同时更新 ctx 顶层字段:
        - selected_preset_id
        - selected_preset_item_id
        - selected_upstream
    """

    name = "routing"
    depends_on = ["validation"]

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行路由决策"""
        model = ctx.requested_model or ctx.get("validation", "model")
        capability = ctx.capability or "chat"

        if not model:
            return StepResult(
                status=StepStatus.FAILED,
                message="Model not specified",
            )

        if ctx.db_session is None or not isinstance(ctx.db_session, AsyncSession):
            return StepResult(
                status=StepStatus.FAILED,
                message="Database session missing in context",
            )

        allowed_providers, allowed_presets, allowed_preset_items = _extract_provider_filters(
            ctx.get("auth", "scopes")
        )

        try:
            routing_result, backups = await self._select_upstream(
                session=ctx.db_session,
                capability=capability,
                model=model,
                channel=ctx.channel.value,
                allowed_providers=allowed_providers,
                allowed_presets=allowed_presets,
                allowed_preset_items=allowed_preset_items,
            )

            # 写入上下文
            ctx.set("routing", "preset_id", routing_result["preset_id"])
            ctx.set("routing", "preset_item_id", routing_result["preset_item_id"])
            ctx.set("routing", "upstream_url", routing_result["upstream_url"])
            ctx.set("routing", "provider", routing_result["provider"])
            ctx.set("routing", "template_engine", routing_result["template_engine"])
            ctx.set("routing", "request_template", routing_result["request_template"])
            ctx.set("routing", "response_transform", routing_result["response_transform"])
            ctx.set("routing", "routing_config", routing_result["routing_config"])
            ctx.set("routing", "limit_config", routing_result["limit_config"])
            ctx.set("routing", "pricing_config", routing_result["pricing_config"])
            ctx.set("routing", "auth_type", routing_result["auth_type"])
            ctx.set("routing", "auth_config", routing_result["auth_config"])
            ctx.set("routing", "default_headers", routing_result["default_headers"])
            ctx.set("routing", "default_params", routing_result["default_params"])
            ctx.set("routing", "candidates", [routing_result, *backups])
            ctx.set("routing", "candidate_index", 0)

            # 更新顶层字段
            ctx.selected_preset_id = routing_result["preset_id"]
            ctx.selected_preset_item_id = routing_result["preset_item_id"]
            ctx.selected_upstream = routing_result["upstream_url"]
            ctx.routing_weight = routing_result.get("weight")

            logger.info(
                f"Routing decided trace_id={ctx.trace_id} "
                f"model={model} provider={routing_result['provider']} "
                f"upstream={routing_result['upstream_url']}"
            )

            return StepResult(
                status=StepStatus.SUCCESS,
                data=routing_result,
            )

        except NoAvailableUpstreamError as e:
            logger.error(f"No available upstream: {e}")
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )

    async def _select_upstream(
        self,
        session: AsyncSession,
        capability: str,
        model: str,
        channel: str,
        allowed_providers: set[str] | None = None,
        allowed_presets: set[str] | None = None,
        allowed_preset_items: set[str] | None = None,
    ) -> tuple[dict, list[dict]]:
        """
        选择上游
        """
        from app.services.providers.routing_selector import RoutingSelector

        selector = RoutingSelector(session)
        candidates = await selector.load_candidates(
            capability=capability,
            model=model,
            channel=channel,
            allowed_providers=allowed_providers,
            allowed_presets=allowed_presets,
            allowed_preset_items=allowed_preset_items,
        )

        if not candidates:
            raise NoAvailableUpstreamError(
                f"No upstream available for {capability}/{model}/{channel}"
            )

        primary, backups = selector.choose(candidates)

        def to_dict(c):
            return {
                "preset_id": c.preset_id,
                "preset_item_id": c.preset_item_id,
                "upstream_url": c.upstream_url,
                "provider": c.provider,
                "template_engine": c.template_engine,
                "request_template": c.request_template,
                "response_transform": c.response_transform,
                "pricing_config": c.pricing_config,
                "limit_config": c.limit_config,
                "auth_type": c.auth_type,
                "auth_config": c.auth_config,
                "default_headers": c.default_headers,
                "default_params": c.default_params,
                "routing_config": c.routing_config,
                "weight": c.weight,
                "priority": c.priority,
            }

        return to_dict(primary), [to_dict(b) for b in backups]

    async def on_failure(
        self,
        ctx: "WorkflowContext",
        error: Exception,
        attempt: int,
    ) -> FailureAction:
        """路由失败：重试一次后中止"""
        if attempt <= 1:
            return FailureAction.RETRY
        return FailureAction.ABORT
