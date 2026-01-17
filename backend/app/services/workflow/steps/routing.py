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
        raw_request = ctx.get("validation", "request")
        provider_model_id = self._extract_provider_model_id(raw_request)

        if not model:
            return StepResult(
                status=StepStatus.FAILED,
                message="Model not specified",
            )

        allow_fallback = ctx.get("routing", "allow_fallback", False)

        if ctx.db_session is None:
            if allow_fallback:
                return self._fallback(ctx)
            return StepResult(
                status=StepStatus.FAILED,
                message="Database session missing in context",
            )

        allowed_providers, allowed_presets, allowed_preset_items = _extract_provider_filters(
            ctx.get("auth", "scopes")
        )

        try:
            if provider_model_id:
                routing_result, backups, affinity_hit = await self._select_by_provider_model_id(
                    session=ctx.db_session,
                    provider_model_id=provider_model_id,
                    channel=ctx.channel.value,
                    ctx=ctx,
                    allowed_providers=allowed_providers,
                )
            else:
                routing_result, backups, affinity_hit = await self._select_upstream(
                    session=ctx.db_session,
                    capability=capability,
                    model=model,
                    channel=ctx.channel.value,
                    ctx=ctx,
                    allowed_providers=allowed_providers,
                    allowed_presets=allowed_presets,
                    allowed_preset_items=allowed_preset_items,
                )

            # 写入上下文
            ctx.set("routing", "preset_id", routing_result["preset_id"])
            ctx.set("routing", "preset_item_id", routing_result["preset_item_id"])
            ctx.set("routing", "instance_id", routing_result.get("instance_id"))
            ctx.set("routing", "provider_model_id", routing_result.get("provider_model_id"))
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
            ctx.set("routing", "affinity_hit", affinity_hit)
            ctx.set("routing", "affinity_provider_model_id", routing_result.get("provider_model_id"))

            # 更新顶层字段
            ctx.selected_preset_id = routing_result["preset_id"]
            ctx.selected_preset_item_id = routing_result["preset_item_id"]
            ctx.selected_instance_id = routing_result.get("instance_id")
            ctx.selected_provider_model_id = routing_result.get("provider_model_id")
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
            if allow_fallback:
                return self._fallback(ctx)
            return StepResult(
                status=StepStatus.FAILED,
                message=str(e),
            )
        except Exception as exc:
            logger.warning(f"routing_failed trace_id={ctx.trace_id} err={exc}")
            if ctx.get("routing", "allow_fallback", False):
                return self._fallback(ctx)
            return StepResult(
                status=StepStatus.FAILED,
                message=str(exc),
            )

    def _fallback(self, ctx: "WorkflowContext") -> StepResult:
        """测试/开发环境的兜底路由，避免阻塞编排。"""
        fallback = {
            "preset_id": None,
            "preset_item_id": None,
            "instance_id": None,
            "provider_model_id": None,
            "upstream_url": "http://mock-upstream",
            "provider": "mock",
            "template_engine": "simple_replace",
            "request_template": "{}",
            "response_transform": {},
            "pricing_config": {},
            "limit_config": {},
            "auth_type": "none",
            "auth_config": {},
            "default_headers": {},
            "default_params": {},
            "routing_config": {},
            "weight": 1,
            "priority": 1,
        }
        ctx.set("routing", "candidates", [fallback])
        ctx.set("routing", "preset_id", None)
        ctx.selected_upstream = fallback["upstream_url"]
        ctx.selected_provider_model_id = None
        ctx.routing_weight = fallback["weight"]
        return StepResult(status=StepStatus.SUCCESS, data=fallback)

    def _extract_provider_model_id(self, raw_request) -> str | None:
        if raw_request is None:
            return None
        if isinstance(raw_request, dict):
            return raw_request.get("provider_model_id")
        return getattr(raw_request, "provider_model_id", None)

    async def _select_by_provider_model_id(
        self,
        session: AsyncSession,
        provider_model_id: str,
        channel: str,
        ctx: "WorkflowContext",
        allowed_providers: set[str] | None = None,
    ) -> tuple[dict, list[dict], bool]:
        from app.services.providers.routing_selector import RoutingSelector

        selector = RoutingSelector(session)
        include_public = ctx.get("routing", "include_public", True)
        candidates = await selector.load_candidates_by_provider_model_id(
            provider_model_id=provider_model_id,
            capability=ctx.capability or "chat",
            channel=channel,
            user_id=str(ctx.user_id) if hasattr(ctx, "user_id") else None,
            include_public=include_public,
            allowed_providers=allowed_providers,
        )

        if not candidates:
            raise NoAvailableUpstreamError(
                f"No upstream available for provider_model_id={provider_model_id}"
            )

        if ctx.is_internal and ctx.get("routing", "require_provider_model_id", False):
            primary = max(
                candidates,
                key=lambda c: (
                    c.priority,
                    c.weight,
                    c.credential_alias or "",
                    c.credential_id or "",
                    c.model_id,
                ),
            )
            backups = []
        else:
            messages = ctx.get("conversation", "merged_messages") or ctx.get("validation", "validated", {}).get(
                "messages"
            )
            primary, backups, _ = await selector.choose(candidates, messages=messages)

        def to_dict(c):
            return {
                "preset_id": c.preset_id,
                "preset_item_id": c.preset_item_id,
                "instance_id": c.instance_id,
                "provider_model_id": c.model_id,
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
                "credential_id": c.credential_id,
                "credential_alias": c.credential_alias,
            }

        return to_dict(primary), [to_dict(b) for b in backups], False

    async def _select_upstream(
        self,
        session: AsyncSession,
        capability: str,
        model: str,
        channel: str,
        ctx: "WorkflowContext",
        allowed_providers: set[str] | None = None,
        allowed_presets: set[str] | None = None,
        allowed_preset_items: set[str] | None = None,
    ) -> tuple[dict, list[dict], bool]:
        """
        选择上游（P1-5 集成路由亲和）
        
        流程：
        1. 检查是否有会话 ID 和路由亲和状态
        2. 如果亲和锁定，优先使用锁定的上游
        3. 否则正常路由选择
        4. 记录路由结果到亲和状态机
        """
        from app.services.providers.routing_selector import RoutingSelector
        from app.services.routing.affinity import RoutingAffinityStateMachine

        # 检查是否启用路由亲和
        session_id = ctx.get("conversation", "session_id") or (
            (ctx.get("validation", "validated") or {}).get("session_id")
        )
        
        affinity_hit = False
        affinity_machine = None
        
        if session_id:
            # 创建亲和状态机
            affinity_machine = RoutingAffinityStateMachine(
                session_id=session_id,
                model=model,
                explore_threshold=3,  # 探索 3 次后锁定
                lock_duration=3600,  # 锁定 1 小时
                failure_threshold=3,  # 连续失败 3 次后重新探索
            )
            
            # 检查是否应该使用亲和路由
            should_use, locked_provider, locked_item_id = await affinity_machine.should_use_affinity()
            
            if should_use and locked_item_id:
                # 尝试使用锁定的上游
                logger.debug(
                    "routing_affinity_locked session=%s model=%s item=%s",
                    session_id,
                    model,
                    locked_item_id,
                )
                affinity_hit = True

        selector = RoutingSelector(session)
        include_public = ctx.get("routing", "include_public", True)
        candidates = await selector.load_candidates(
            capability=capability,
            model=model,
            channel=channel,
            user_id=str(ctx.user_id) if hasattr(ctx, "user_id") else None,
            include_public=include_public,
            allowed_providers=allowed_providers,
        )

        if not candidates:
            raise NoAvailableUpstreamError(
                f"No upstream available for {capability}/{model}/{channel}"
            )

        # 如果亲和命中，尝试从候选中找到锁定的上游
        if affinity_hit and locked_item_id:
            for candidate in candidates:
                if str(candidate.preset_item_id) == locked_item_id:
                    # 找到锁定的上游，直接使用
                    primary = candidate
                    backups = [c for c in candidates if c != primary]
                    
                    def to_dict(c):
                        return {
                            "preset_id": c.preset_id,
                            "preset_item_id": c.preset_item_id,
                            "instance_id": c.instance_id,
                            "provider_model_id": c.model_id,
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
                            "credential_id": c.credential_id,
                            "credential_alias": c.credential_alias,
                        }
                    
                    logger.info(
                        "routing_affinity_used session=%s model=%s provider=%s",
                        session_id,
                        model,
                        primary.provider,
                    )
                    return to_dict(primary), [to_dict(b) for b in backups], True
            
            # 锁定的上游不在候选中（可能已下线），重新探索
            logger.warning(
                "routing_affinity_locked_unavailable session=%s model=%s item=%s",
                session_id,
                model,
                locked_item_id,
            )
            affinity_hit = False

        # 正常路由选择
        messages = ctx.get("conversation", "merged_messages") or ctx.get("validation", "validated", {}).get("messages")
        primary, backups, _ = await selector.choose(candidates, messages=messages)

        def to_dict(c):
            return {
                "preset_id": c.preset_id,
                "preset_item_id": c.preset_item_id,
                "instance_id": c.instance_id,
                "provider_model_id": c.model_id,
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
                "credential_id": c.credential_id,
                "credential_alias": c.credential_alias,
            }

        # 记录路由结果到亲和状态机（异步，不阻塞）
        if affinity_machine:
            try:
                # 这里只记录选择，成功/失败在 upstream_call 步骤记录
                ctx.set("routing", "affinity_machine", affinity_machine)
                ctx.set("routing", "affinity_provider", primary.provider)
                ctx.set("routing", "affinity_item_id", str(primary.preset_item_id))
            except Exception as exc:
                logger.warning("routing_affinity_record_failed err=%s", exc)

        return to_dict(primary), [to_dict(b) for b in backups], affinity_hit

    def on_failure(
        self,
        ctx: "WorkflowContext",
        error: Exception,
        attempt: int,
    ) -> FailureAction:
        """路由失败：重试一次后中止"""
        if attempt <= 1:
            return FailureAction.RETRY
        return FailureAction.ABORT
