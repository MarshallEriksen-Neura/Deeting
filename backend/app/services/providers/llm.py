import json
import logging
from typing import Any, List, Optional

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.schemas.gateway import ChatCompletionRequest
from app.schemas.tool import ToolDefinition, ToolCall
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.orchestrator.orchestrator import get_internal_orchestrator

logger = logging.getLogger(__name__)

class LLMService:
    """
    Internal AI Client (Unified).
    
    A lightweight facade over the GatewayOrchestrator for internal code usage.
    It delegates all routing, provider selection, and execution to the standard workflow.
    """

    def __init__(self):
        pass

    async def chat_completion(
        self,
        messages: List[dict],
        tools: List[ToolDefinition] | None = None,
        preset_id: Optional[str] = None, # Unused, kept for compat or future extension
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
        tenant_id: str | None = None,
        user_id: str | None = None,
        api_key_id: str | None = None,
        trace_id: str | None = None,
    ) -> Any: # Returns str (content) or List[ToolCall]
        """
        Executes a chat completion using the internal orchestrator.
        """
        async with AsyncSessionLocal() as session:
            # 1. Determine Target Model
            target_model = model
            if not target_model:
                # Dynamic default: Find first available chat model for user
                from app.repositories.provider_instance_repository import ProviderModelRepository
                model_repo = ProviderModelRepository(session)
                # We try to get any valid model for this user
                # We can use get_available_models_for_user which returns IDs
                if user_id:
                     user_models = await model_repo.get_available_models_for_user(str(user_id))
                     if user_models:
                         target_model = user_models[0]
                         logger.info(f"LLMService: Auto-selected default model '{target_model}' for user {user_id}")
            
            # Fallback only if still empty (system default or panic)
            if not target_model:
                 target_model = getattr(settings, "INTERNAL_LLM_MODEL_ID", "gpt-4o")
            
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
            if tenant_id:
                ctx.tenant_id = str(tenant_id)
            if user_id:
                ctx.user_id = str(user_id)
            if api_key_id:
                ctx.api_key_id = str(api_key_id)
            elif user_id:
                # 内部调用默认用 user_id 作为 api_key 维度
                ctx.api_key_id = str(user_id)
            
            # 4. Configure Context
            ctx.set("validation", "request", internal_req)
            if tools:
                ctx.set("validation", "tools", tools)
            
            # IMPORTANT: We do NOT set "require_provider_model_id" to True here anymore.
            # We let RoutingStep find the best candidate for the requested model name.
            # If the user passed a specific provider_model_id in 'model' (which is rare), 
            # routing would need to support that, but usually 'model' is the public name (e.g. gpt-4o).
            
            ctx.set("conversation", "skip", True) # Internal tasks usually manage their own context

            # 5. Execute
            orchestrator = get_internal_orchestrator()
            result = await orchestrator.execute(ctx)
            
            if not result.success or not ctx.is_success:
                logger.error(
                    "LLMService orchestrator failed trace_id=%s error=%s source=%s",
                    ctx.trace_id,
                    ctx.error_message,
                    ctx.error_source,
                )
                raise RuntimeError(f"LLMService failed: {ctx.error_message or 'Unknown error'}")

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
