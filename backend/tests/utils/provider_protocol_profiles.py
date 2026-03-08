from __future__ import annotations

from typing import Any


def build_protocol_profiles(
    *,
    provider: str,
    profile_configs: dict[str, Any],
    default_headers: dict[str, Any] | None = None,
    default_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profiles: dict[str, Any] = {}
    for capability, config in (profile_configs or {}).items():
        if not isinstance(config, dict):
            continue
        request_template = (
            config.get("request_template")
            or config.get("body_template")
            or {}
        )
        family = _infer_protocol_family(provider, capability, request_template)
        profiles[str(capability)] = {
            "runtime_version": "v2",
            "schema_version": "2026-03-07",
            "profile_id": f"{provider}:{capability}:{family}",
            "provider": provider,
            "protocol_family": family,
            "capability": capability,
            "transport": {
                "method": config.get("http_method") or config.get("method") or "POST",
                "path": _default_transport_path(capability, family),
                "query_template": {},
                "header_template": {
                    **(default_headers or {}),
                    **(
                        (config.get("default_headers") or config.get("headers") or {})
                        if isinstance(
                            config.get("default_headers") or config.get("headers") or {},
                            dict,
                        )
                        else {}
                    ),
                },
            },
            "request": {
                "template_engine": config.get("template_engine") or "openai_compat",
                "request_template": request_template,
                "request_builder": config.get("request_builder")
                if isinstance(config.get("request_builder"), dict)
                else None,
            },
            "response": {
                "decoder": {"name": _default_decoder(family), "config": {}},
                "response_template": (
                    config.get("response_transform")
                    if isinstance(config.get("response_transform"), dict)
                    else {}
                ),
                "output_mapping": (
                    config.get("output_mapping")
                    if isinstance(config.get("output_mapping"), dict)
                    else {}
                ),
            },
            "stream": {
                "stream_decoder": {
                    "name": _default_stream_decoder(family),
                    "config": {},
                }
            },
            "auth": {"auth_policy": "inherit", "config": {}},
            "features": {
                "supports_messages": family != "openai_responses",
                "supports_input_items": family == "openai_responses",
                "supports_tools": True,
                "supports_reasoning": family in {"openai_responses", "anthropic_messages"},
                "supports_json_mode": family != "anthropic_messages",
            },
            "defaults": {
                "headers": {
                    **(default_headers or {}),
                },
                "query": {},
                "body": {
                    **(default_params or {}),
                    **(
                        (config.get("default_params") or config.get("params") or {})
                        if isinstance(
                            config.get("default_params") or config.get("params") or {},
                            dict,
                        )
                        else {}
                    ),
                },
            },
            "metadata": {
                "async_config": config.get("async_config")
                or config.get("async_flow")
                or {},
            },
        }
    return profiles


def _infer_protocol_family(
    provider: str, capability: str, request_template: dict[str, Any]
) -> str:
    provider_lower = (provider or "").strip().lower()
    if "anthropic" in provider_lower or "claude" in provider_lower:
        return "anthropic_messages"
    if capability == "chat" and isinstance(request_template, dict):
        if "input" in request_template and "messages" not in request_template:
            return "openai_responses"
    return "openai_chat"


def _default_transport_path(capability: str, family: str) -> str:
    if capability == "embedding":
        return "embeddings"
    if capability == "image_generation":
        return "images/generations"
    if capability == "text_to_speech":
        return "audio/speech"
    if capability == "speech_to_text":
        return "audio/transcriptions"
    if capability == "video_generation":
        return "videos/generations"
    if family == "openai_responses":
        return "responses"
    if family == "anthropic_messages":
        return "v1/messages"
    return "chat/completions"


def _default_decoder(family: str) -> str:
    if family == "openai_responses":
        return "openai_responses"
    if family == "anthropic_messages":
        return "anthropic_messages"
    return "openai_chat"


def _default_stream_decoder(family: str) -> str:
    if family == "openai_responses":
        return "openai_responses_stream"
    if family == "anthropic_messages":
        return "anthropic_messages_stream"
    return "openai_chat_stream"
