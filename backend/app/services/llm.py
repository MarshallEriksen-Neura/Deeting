import json
import logging
from typing import Any, List, Optional

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client
from app.models.provider_preset import ProviderPreset, ProviderPresetItem
from app.services.secrets.manager import SecretManager
from app.services.request_renderer import request_renderer
from app.services.response_transformer import response_transformer
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
            preset, item = await self._resolve_provider_config(session, preset_id, model)
            
            # 2. Internal Request
            internal_req = ChatCompletionRequest(
                model=item.model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False
            )

            # 3. Render Body (injecting tools if present)
            request_body = request_renderer.render(
                item_config=item,
                internal_req=internal_req,
                tools=tools
            )

            # 4. Headers & Auth
            url = f"{preset.base_url.rstrip('/')}/{item.upstream_path.lstrip('/')}"
            headers = preset.default_headers.copy() if preset.default_headers else {}
            headers["Content-Type"] = "application/json"
            auth_headers = await self._get_auth_headers(preset)
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
                        item_config=item,
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
        # ... (Same as before) ...
        target_preset_id = preset_id or getattr(settings, "INTERNAL_LLM_PRESET_ID", None)
        
        if not target_preset_id:
            stmt = select(ProviderPreset).where(ProviderPreset.is_active == True)
            result = await session.execute(stmt)
            preset = result.scalars().first()
            if not preset:
                raise RuntimeError("No active LLM provider preset found.")
        else:
            stmt = select(ProviderPreset).where(ProviderPreset.id == target_preset_id)
            result = await session.execute(stmt)
            preset = result.scalars().first()
            if not preset:
                raise RuntimeError(f"Preset {target_preset_id} not found.")

        # Find Item
        stmt = select(ProviderPresetItem).where(
            ProviderPresetItem.preset_id == preset.id,
            ProviderPresetItem.capability == "chat",
            ProviderPresetItem.is_active == True
        )
        if model:
            stmt = stmt.where(ProviderPresetItem.unified_model_id == model)
        
        result = await session.execute(stmt)
        item = result.scalars().first()
        
        if not item:
            stmt = select(ProviderPresetItem).where(
                ProviderPresetItem.preset_id == preset.id,
                ProviderPresetItem.capability == "chat",
                ProviderPresetItem.is_active == True
            )
            result = await session.execute(stmt)
            item = result.scalars().first()

        if not item:
            raise RuntimeError(f"No valid chat model found in preset {preset.id}")
            
        return preset, item

    async def _get_auth_headers(self, preset: ProviderPreset) -> dict:
        # ... (Same as before) ...
        secret_ref = preset.auth_config.get("secret_ref_id")
        if not secret_ref:
             secret = preset.auth_config.get("secret", "")
        else:
             secret = await self.secret_manager.get(preset.provider, secret_ref)
             
        if not secret:
            return {}

        if preset.auth_type == "api_key":
            header_name = preset.auth_config.get("header", "x-api-key")
            return {header_name: secret}
        elif preset.auth_type == "bearer":
            return {"Authorization": f"Bearer {secret}"}
        
        return {}

llm_service = LLMService()