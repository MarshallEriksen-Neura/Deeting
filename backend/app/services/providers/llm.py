import json
import logging
from typing import Any, List, Optional

from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.services.secrets.manager import SecretManager
from app.services.providers.request_renderer import request_renderer
from app.services.providers.response_transformer import response_transformer
from app.schemas.gateway import ChatCompletionRequest
from app.schemas.tool import ToolDefinition, ToolCall

logger = logging.getLogger(__name__)

class LLMService:
    """
    Unified LLM Service for internal background tasks.
    Supports Chat and Tools (MCP).
    """

    def __init__(self):
        self.secret_manager = SecretManager()

    async def chat_completion(
        self,
        messages: List[dict],
        tools: List[ToolDefinition] | None = None,
        preset_id: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 1024,
    ) -> Any: # Returns str (content) or List[ToolCall]
        """
        Executes a chat completion.
        If the model calls tools, returns a list of ToolCall objects.
        Otherwise returns the content string.
        """
        async with AsyncSessionLocal() as session:
            # 1. Resolve Configuration
            preset, instance, model_obj = await self._resolve_provider_config(session, preset_id, model)
            
            # 2. Internal Request
            internal_req = ChatCompletionRequest(
                model=model_obj.model_id,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False
            )

            # 3. Render Body (injecting tools if present)
            request_body = request_renderer.render(
                item_config=model_obj,
                internal_req=internal_req,
                tools=tools
            )

            # 4. Headers & Auth
            url = f"{(instance.base_url or preset.base_url).rstrip('/')}/{model_obj.upstream_path.lstrip('/')}"
            headers = preset.default_headers.copy() if getattr(preset, "default_headers", None) else {}
            headers["Content-Type"] = "application/json"
            auth_headers = await self._get_auth_headers(session, preset, instance)
            headers.update(auth_headers)

            # 5. Execute
            async with create_async_http_client(timeout=120.0, http2=True) as client:
                try:
                    logger.debug(f"LLMService call: {url} tools={len(tools or [])}")
                    response = await client.post(url, json=request_body, headers=headers)
                    response.raise_for_status()
                    
                    raw_data = response.json()
                    
                    # 6. Transform Response (Ingress Adapter)
                    # Normalize whatever vendor format into OpenAI ChatCompletionResponse structure
                    data = response_transformer.transform(
                        item_config=model_obj,
                        raw_response=raw_data,
                        status_code=response.status_code
                    )
                    
                    choice = data["choices"][0]
                    message = choice["message"]
                    
                    # Check for tool calls
                    if message.get("tool_calls"):
                        return [
                            ToolCall(
                                id=tc["id"],
                                name=tc["function"]["name"],
                                arguments=json.loads(tc["function"]["arguments"])
                            )
                            for tc in message["tool_calls"]
                        ]
                    
                    return message["content"]
                    
                except Exception as e:
                    logger.error(f"LLMService call failed: {e}")
                    raise

    async def _resolve_provider_config(self, session, preset_id, model):
        """
        BYOP 版本：按实例+模型选择。可通过环境变量 INTERNAL_LLM_INSTANCE_ID / INTERNAL_LLM_MODEL_ID 指定默认。
        """
        instance_repo = ProviderInstanceRepository(session)
        model_repo = ProviderModelRepository(session)
        preset_repo = ProviderPresetRepository(session)

        target_instance_id = preset_id or getattr(settings, "INTERNAL_LLM_INSTANCE_ID", None)
        target_model_id = model or getattr(settings, "INTERNAL_LLM_MODEL_ID", None)

        instances = await instance_repo.get_available_instances(user_id=None, include_public=True)
        if not instances:
            raise RuntimeError("No provider instance available for LLMService.")

        instance: ProviderInstance | None = None
        if target_instance_id:
            for inst in instances:
                if str(inst.id) == str(target_instance_id):
                    instance = inst
                    break
        if not instance:
            instance = instances[0]

        all_models = await model_repo.list()
        candidates = [m for m in all_models if m.instance_id == instance.id and m.capability == "chat" and m.is_active]
        if target_model_id:
            candidates = [m for m in candidates if str(m.id) == str(target_model_id) or m.model_id == target_model_id]
        if not candidates:
            raise RuntimeError("No active chat model found for LLMService instance.")
        model_obj = candidates[0]

        preset = await preset_repo.get_by_slug(instance.preset_slug)
        if not preset or not preset.is_active:
            raise RuntimeError(f"Preset slug={instance.preset_slug} not found or inactive.")

        return preset, instance, model_obj

    async def _get_auth_headers(self, session, preset: ProviderPreset, instance: ProviderInstance) -> dict:
        secret_ref = instance.credentials_ref or preset.auth_config.get("secret_ref_id")

        # 如果 secret_ref 是别名，先映射到真实引用
        if secret_ref and not secret_ref.startswith("db:") and instance.credentials:
            for cred in instance.credentials:
                if cred.alias == secret_ref and cred.is_active:
                    secret_ref = cred.secret_ref_id
                    break

        secret = ""
        if secret_ref:
            secret = await self.secret_manager.get(preset.provider, secret_ref, session)

        if not secret:
            return {}

        auth_type = preset.auth_type or "bearer"
        if auth_type == "api_key":
            header_name = preset.auth_config.get("header", "x-api-key")
            return {header_name: secret}
        elif auth_type == "bearer":
            return {"Authorization": f"Bearer {secret}"}

        return {}

llm_service = LLMService()
