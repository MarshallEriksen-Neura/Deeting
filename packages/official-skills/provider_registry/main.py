import json
import sys
import asyncio
import re
from typing import Dict, Any
from urllib.parse import urlsplit, urlunsplit

try:
    from deeting import deeting
except ImportError:
    deeting = None


_VERSION_SEGMENT_RE = re.compile(r"^v\d+(?:\.\d+)?$", re.IGNORECASE)
_OPENAI_LIKE_PROVIDER_SKIP_MARKERS = (
    "anthropic",
    "claude",
    "google",
    "gemini",
    "vertex",
    "azure",
)
_OPENAI_LIKE_CHAT_SUFFIXES = (
    (("chat", "completions"), "chat/completions"),
    (("responses",), "responses"),
)


def _is_version_segment(segment: str) -> bool:
    return bool(_VERSION_SEGMENT_RE.fullmatch((segment or "").strip()))


def _has_versioned_path(raw_url: str) -> bool:
    path = urlsplit(raw_url or "").path or ""
    segments = [segment for segment in path.split("/") if segment]
    for index, segment in enumerate(segments):
        if _is_version_segment(segment):
            return True
        if (
            segment.lower() == "api"
            and index + 1 < len(segments)
            and _is_version_segment(segments[index + 1])
        ):
            return True
    return False


def _looks_openai_compatible_provider(provider: str) -> bool:
    normalized = (provider or "").strip().lower()
    if not normalized:
        return True
    return not any(marker in normalized for marker in _OPENAI_LIKE_PROVIDER_SKIP_MARKERS)


def _extract_openai_like_endpoint(raw_url: str) -> tuple[str, str | None]:
    normalized = (raw_url or "").strip()
    if not normalized:
        return "", None

    parsed = urlsplit(normalized)
    segments = [segment for segment in parsed.path.split("/") if segment]
    lowered = [segment.lower() for segment in segments]

    for suffix_segments, endpoint_path in _OPENAI_LIKE_CHAT_SUFFIXES:
        suffix_length = len(suffix_segments)
        if len(lowered) < suffix_length:
            continue
        if tuple(lowered[-suffix_length:]) != suffix_segments:
            continue
        base_segments = segments[:-suffix_length]
        normalized_path = f"/{'/'.join(base_segments)}" if base_segments else ""
        base_url = urlunsplit(
            (parsed.scheme, parsed.netloc, normalized_path, parsed.query, parsed.fragment)
        ).rstrip("/")
        return base_url, endpoint_path

    return normalized.rstrip("/"), None


def _normalize_protocol_profiles(
    provider: str,
    base_url: str,
    protocol_profiles: Dict[str, Any] | None,
) -> tuple[str, Dict[str, Any]]:
    normalized_base_url = (base_url or "").strip().rstrip("/")
    normalized_profiles = dict(protocol_profiles or {})

    if not _looks_openai_compatible_provider(provider):
        return normalized_base_url, normalized_profiles

    normalized_base_url, inferred_path = _extract_openai_like_endpoint(normalized_base_url)

    chat_profile = normalized_profiles.get("chat")
    if not isinstance(chat_profile, dict):
        chat_profile = {}

    transport = chat_profile.get("transport")
    if not isinstance(transport, dict):
        transport = {}

    existing_path = transport.get("path")
    if isinstance(existing_path, str) and existing_path.strip():
        if inferred_path and existing_path.strip().lower() != inferred_path:
            # Keep the caller's explicit path and avoid rewriting the base URL around it.
            return (base_url or "").strip().rstrip("/"), normalized_profiles
        return normalized_base_url, normalized_profiles

    protocol_family = str(chat_profile.get("protocol_family") or "").strip().lower()
    default_chat_path = (
        inferred_path
        or ("responses" if protocol_family == "openai_responses" else "chat/completions")
    )

    transport["path"] = default_chat_path
    chat_profile["transport"] = transport
    normalized_profiles["chat"] = chat_profile
    return normalized_base_url, normalized_profiles


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
            "save_provider_to_marketplace uploads presets to the cloud provider preset registry.",
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
        normalized_base_url, normalized_protocol_profiles = _normalize_protocol_profiles(
            str(kwargs.get("provider") or ""),
            str(kwargs.get("base_url") or ""),
            kwargs.get("protocol_profiles") or {},
        )
        preset = {
            "slug": kwargs.get("slug"),
            "name": kwargs.get("name"),
            "provider": kwargs.get("provider"),
            "base_url": normalized_base_url,
            "category": kwargs.get("category"),
            "url_template": kwargs.get("url_template"),
            "theme_color": kwargs.get("theme_color"),
            "icon": kwargs.get("icon"),
            "auth_type": kwargs.get("auth_type") or "api_key",
            "auth_config": kwargs.get("auth_config") or {},
            "protocol_schema_version": kwargs.get("protocol_schema_version"),
            "protocol_profiles": normalized_protocol_profiles,
            "version": kwargs.get("version", 1),
            "is_active": kwargs.get("is_active", True),
        }
        return deeting.call_tool("cloud.provider_preset.upsert", preset=preset)
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
