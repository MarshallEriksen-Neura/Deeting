import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None


def _canonical_family_schema(protocol_family: str) -> Dict[str, Any]:
    family = (protocol_family or "openai_chat").strip().lower()
    defaults = {
        "openai_responses": {
            "template_engine": "openai_compat",
            "request_builder": "responses_input_from_messages_or_items",
            "response_decoder": "openai_responses",
            "request_template": {
                "model": None,
                "input": None,
                "stream": None,
                "temperature": None,
                "max_output_tokens": None,
            },
        },
        "anthropic_messages": {
            "template_engine": "anthropic_messages",
            "request_builder": "anthropic_messages_from_canonical",
            "response_decoder": "anthropic_messages",
            "request_template": {
                "model": None,
                "messages": None,
                "stream": None,
                "temperature": None,
                "max_tokens": None,
            },
        },
        "google_gemini": {
            "template_engine": "google_gemini",
            "request_builder": "google_gemini_contents_from_canonical",
            "response_decoder": "openai_chat",
            "request_template": {
                "model": None,
                "contents": None,
            },
        },
    }
    return defaults.get(
        family,
        {
            "template_engine": "openai_compat",
            "request_builder": "openai_chat_messages_from_canonical",
            "response_decoder": "openai_chat",
            "request_template": {
                "model": None,
                "messages": None,
                "stream": None,
                "temperature": None,
                "max_tokens": None,
            },
        },
    )


def _unified_schema_for_capability(capability: str) -> Dict[str, Any]:
    normalized = (capability or "chat").strip().lower() or "chat"
    families = ["openai_chat", "openai_responses", "anthropic_messages", "google_gemini"]
    request_shapes = {
        "embedding": {"model": None, "input": None},
        "image_generation": {"model": None, "prompt": None, "n": None},
        "video_generation": {"model": None, "prompt": None},
        "text_to_speech": {"model": None, "input": None, "voice": None},
        "speech_to_text": {"model": None, "audio_data": None, "response_format": None},
    }
    return {
        "capability": normalized,
        "runtime": "desktop_local",
        "supported_protocol_families": families,
        "canonical_request_shapes": {
            family: (
                request_shapes.get(normalized)
                or _canonical_family_schema(family)["request_template"]
            )
            for family in families
        },
        "protocol_defaults": {
            family: _canonical_family_schema(family)
            for family in families
        },
        "notes": [
            "Desktop chat/provider routing is now owned by the local runtime.",
            "save_provider_to_marketplace persists to the desktop-local provider preset registry.",
        ],
    }


async def get_unified_schema(capability: str) -> Dict[str, Any]:
    return _unified_schema_for_capability(capability)

async def verify_provider_template(**kwargs) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("provider.template.verify", **kwargs)
    return {"status": "error", "message": "SDK not found"}

async def save_provider_to_marketplace(**kwargs) -> Dict[str, Any]:
    if deeting:
        preset = {
            "slug": kwargs.get("slug"),
            "name": kwargs.get("name"),
            "provider": kwargs.get("provider"),
            "base_url": kwargs.get("base_url"),
            "category": kwargs.get("category"),
            "url_template": kwargs.get("url_template"),
            "theme_color": kwargs.get("theme_color"),
            "icon": kwargs.get("icon"),
            "auth_type": kwargs.get("auth_type") or "api_key",
            "auth_config": kwargs.get("auth_config") or {},
            "protocol_schema_version": kwargs.get("protocol_schema_version"),
            "protocol_profiles": kwargs.get("protocol_profiles") or {},
            "version": kwargs.get("version", 1),
            "is_active": kwargs.get("is_active", True),
        }
        return deeting.call_tool("provider_preset.upsert", preset=preset)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "get_unified_schema":
            result = await get_unified_schema(**args)
        elif method == "verify_provider_template":
            result = await verify_provider_template(**args)
        elif method == "save_provider_to_marketplace":
            result = await save_provider_to_marketplace(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
