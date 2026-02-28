import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.schemas.gateway import ChatCompletionRequest
from app.schemas.tool import ToolCall, ToolDefinition
from app.services.orchestrator.context import Channel, WorkflowContext

logger = logging.getLogger(__name__)


class LLMService:
    """
    Internal AI Client (Unified).

    A lightweight facade over the GatewayOrchestrator for internal code usage.
    It delegates all routing, provider selection, and execution to the standard workflow.
    """

    def __init__(self):
        pass

    async def _resolve_context_identity_and_model(
        self,
        *,
        session,
        model: str | None,
        user_id: str | None,
        tenant_id: str | None,
        api_key_id: str | None,
    ) -> tuple[str, str | None, str | None, str | None]:
        from app.repositories.secretary_repository import UserSecretaryRepository

        target_model = str(model).strip() if isinstance(model, str) else model
        resolved_user_id = str(user_id) if user_id else None
        resolved_tenant_id = str(tenant_id) if tenant_id else None
        resolved_api_key_id = str(api_key_id) if api_key_id else None

        if not target_model:
            if not resolved_user_id:
                raise RuntimeError(
                    "LLMService failed: user_id is required when model is not specified"
                )

            try:
                user_uuid = UUID(str(resolved_user_id))
            except (ValueError, TypeError) as exc:
                raise RuntimeError("LLMService failed: invalid user_id") from exc

            secretary_repo = UserSecretaryRepository(session)
            secretary = await secretary_repo.get_by_user_id(user_uuid)
            secretary_model = (
                str(secretary.model_name).strip()
                if secretary and secretary.model_name
                else None
            )
            
            if not secretary_model:
                # 规范化方案：从系统设置中获取默认内部模型
                from app.repositories.system_setting_repository import SystemSettingRepository
                setting_repo = SystemSettingRepository(session)
                default_model_setting = await setting_repo.get_by_key("default_internal_model")
                if default_model_setting and isinstance(default_model_setting.value, dict):
                    secretary_model = default_model_setting.value.get("model_id")
                    if secretary_model:
                        logger.info("LLMService: using system default model from settings: %s", secretary_model)

            if not secretary_model:
                raise RuntimeError(
                    f"LLMService failed: secretary model is not configured for user {resolved_user_id} and no system default found"
                )
            target_model = secretary_model
            logger.info(
                "LLMService: resolved model from secretary user_id=%s model=%s",
                resolved_user_id,
                target_model,
            )

        if not target_model:
            raise RuntimeError(
                "LLMService failed: no model specified"
            )

        if resolved_user_id:
            if not resolved_tenant_id:
                resolved_tenant_id = resolved_user_id
            if not resolved_api_key_id:
                resolved_api_key_id = resolved_user_id

        return target_model, resolved_user_id, resolved_tenant_id, resolved_api_key_id

    async def chat_completion(
        self,
        messages: list[dict],
        tools: list[ToolDefinition] | None = None,
        preset_id: str | None = None,  # Unused, kept for compat or future extension
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
        tenant_id: str | None = None,
        user_id: str | None = None,
        api_key_id: str | None = None,
        trace_id: str | None = None,
    ) -> Any:  # Returns str (content) or List[ToolCall]
        """
        Executes a chat completion using the internal orchestrator.
        """
        async with AsyncSessionLocal() as session:
            # 1. Resolve model and runtime identity
            target_model, resolved_user_id, resolved_tenant_id, resolved_api_key_id = (
                await self._resolve_context_identity_and_model(
                    session=session,
                    model=model,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    api_key_id=api_key_id,
                )
            )

            # 2. Build Request Object
            internal_req = ChatCompletionRequest(
                model=target_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )

            # 3. Initialize Context
            # We treat this as an INTERNAL channel request.
            # RoutingStep will handle finding the actual ProviderModel for 'target_model'.
            ctx = WorkflowContext(
                channel=Channel.INTERNAL,
                capability="chat",
                requested_model=target_model,
                db_session=session,
            )
            if trace_id:
                ctx.trace_id = trace_id
            if resolved_tenant_id:
                ctx.tenant_id = str(resolved_tenant_id)
            if resolved_user_id:
                ctx.user_id = str(resolved_user_id)
            if resolved_api_key_id:
                ctx.api_key_id = str(resolved_api_key_id)

            # 4. Configure Context
            ctx.set("validation", "request", internal_req)
            if tools:
                ctx.set("validation", "tools", tools)

            # IMPORTANT: We do NOT set "require_provider_model_id" to True here anymore.
            # We let RoutingStep find the best candidate for the requested model name.
            # If the user passed a specific provider_model_id in 'model' (which is rare),
            # routing would need to support that, but usually 'model' is the public name (e.g. gpt-4o).

            ctx.set(
                "conversation", "skip", True
            )  # Internal tasks usually manage their own context

            # 5. Execute
            from app.services.orchestrator.orchestrator import (
                get_internal_orchestrator,
            )

            orchestrator = get_internal_orchestrator()
            result = await orchestrator.execute(ctx)

            if not result.success or not ctx.is_success:
                logger.error(
                    "LLMService orchestrator failed trace_id=%s error=%s source=%s",
                    ctx.trace_id,
                    ctx.error_message,
                    ctx.error_source,
                )
                raise RuntimeError(
                    f"LLMService failed: {ctx.error_message or 'Unknown error'}"
                )

            # 6. Extract Result
            data = (
                ctx.get("response_transform", "response")
                or ctx.get("upstream_call", "response")
                or {}
            )

            if not data or "choices" not in data:
                raise RuntimeError(f"LLMService invalid response format: {data}")

            choice = data["choices"][0]
            message = choice["message"]

            if message.get("tool_calls"):
                return [
                    ToolCall(
                        id=tc["id"],
                        name=tc["function"]["name"],
                        arguments=json.loads(tc["function"]["arguments"]),
                    )
                    for tc in message["tool_calls"]
                ]

            return message["content"]


llm_service = LLMService()
