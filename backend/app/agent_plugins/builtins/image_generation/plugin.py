from typing import Any, List, Dict, Optional
import logging
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.services.providers.routing_selector import RoutingSelector
from app.core.provider.config_driven_provider import ConfigDrivenProvider
from app.core.http_client import create_async_http_client
from app.services.secrets.manager import SecretManager
import json

logger = logging.getLogger(__name__)

class ImageGenerationPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/image_generation",
            version="1.0.0",
            description="Generate images from text descriptions using configured providers (DALL-E, Midjourney, etc.).",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "generate_image",
                    "description": "Generate an image based on a text prompt.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "prompt": {
                                "type": "string",
                                "description": "The detailed description of the image to generate."
                            },
                            "size": {
                                "type": "string",
                                "description": "Image size (e.g., '1024x1024').",
                                "default": "1024x1024"
                            },
                            "quality": {
                                "type": "string",
                                "enum": ["standard", "hd"],
                                "default": "standard"
                            },
                            "n": {
                                "type": "integer",
                                "default": 1
                            }
                        },
                        "required": ["prompt"]
                    }
                }
            }
        ]

    async def handle_generate_image(self, prompt: str, size: str = "1024x1024", quality: str = "standard", n: int = 1, __context__ = None) -> Any:
        """
        Tool Handler: Generate Image.
        Uses RoutingSelector to find an 'image_generation' provider and executes it.
        """
        if not __context__:
            return "Error: Internal system error (Context missing for image generation)."

        ctx = __context__
        if not ctx.db_session:
             return "Error: Database session unavailable."

        selector = RoutingSelector(ctx.db_session)
        
        # 1. Select Provider
        # We don't have a specific model from the user arguments usually, so we pass None to let selector pick default/priority.
        try:
            candidates = await selector.load_candidates(
                capability="image_generation",
                model=None, # Allow wildcard selection
                channel=ctx.channel.value,
                user_id=ctx.user_id,
                include_public=True
            )
            
            if not candidates:
                return "Error: No image generation providers are configured or available."
            
            # Use the built-in choose logic (prioritizes by weight/priority)
            primary, _, _ = await selector.choose(candidates)
            
        except Exception as e:
            logger.exception("ImageGeneration routing failed")
            return f"Error selecting image provider: {str(e)}"

        # 2. Resolve Secrets
        secret_manager = SecretManager()
        api_key = ""
        credential_id = primary.credential_id
        
        # We need to resolve the secret value. 
        # RoutingSelector returns credential_id/alias, but not the raw secret.
        # We need to fetch it.
        # Actually, RoutingCandidate doesn't carry the raw secret ref id explicitly in a clean way for all cases?
        # Wait, candidate auth_config has 'secret_ref_id'.
        
        secret_ref = primary.auth_config.get("secret_ref_id")
        provider_name = primary.provider
        
        if secret_ref:
            secret = await secret_manager.get(provider_name, secret_ref, ctx.db_session)
            if secret:
                api_key = secret

        # 3. Prepare Config for Provider
        # ConfigDrivenProvider expects a config dict
        provider_config = {
            "upstream_url": primary.upstream_url,
            "request_template": primary.request_template,
            "headers": primary.default_headers,
            "async_config": primary.async_config,
            "http_method": primary.http_method,
        }
        
        extra_context = {
            "credentials": {
                "api_key": api_key,
            },
            # Map tool args to template context
            "input": {
                "prompt": prompt,
                "size": size,
                "quality": quality,
                "n": n,
                "model": primary.model_id # Some templates might need model name
            }
        }

        # 4. Execute
        try:
            provider_instance = ConfigDrivenProvider(config=provider_config)
            # Use a fresh client or reuse? Better to create fresh with timeout
            async with create_async_http_client(timeout=120.0) as client:
                response = await provider_instance.execute(
                    request_payload=extra_context["input"], # This is 'request_payload' in execute signature
                    client=client,
                    extra_context=extra_context
                )
            
            # 5. Format Output
            # Ideally return markdown image: ![Generated Image](url)
            # Response structure depends on provider. ConfigDrivenProvider might return {"data": [{"url": ...}]}
            
            data = response.get("data", [])
            output = []
            if isinstance(data, list):
                for item in data:
                    if "url" in item:
                        output.append(f"![Generated Image]({item['url']})")
                    elif "b64_json" in item:
                        # Base64 is too long for chat context usually, maybe save to temp asset?
                        # For now, just indicate it.
                        output.append("[Image generated (Base64)]")
            
            if output:
                return "\n".join(output)
            
            return f"Image generated successfully: {json.dumps(response)}"

        except Exception as e:
            logger.exception("ImageGeneration execution failed")
            return f"Error generating image: {str(e)}"