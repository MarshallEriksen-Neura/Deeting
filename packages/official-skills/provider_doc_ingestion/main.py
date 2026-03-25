import json
import sys
import asyncio
from pathlib import Path
from typing import Any

try:
    from deeting import deeting
except ImportError:
    deeting = None


PACKAGE_DIR = Path(__file__).resolve().parent


def _slugify(value: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "").strip())
    parts = [part for part in normalized.split("-") if part]
    return "-".join(parts)


def _load_json_asset(name: str) -> dict[str, Any]:
    path = PACKAGE_DIR / name
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_text_asset(name: str) -> str:
    path = PACKAGE_DIR / name
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _canonical_request_template(protocol_family: str, capability: str) -> dict[str, Any]:
    family = str(protocol_family or "openai_chat").strip().lower() or "openai_chat"
    normalized_capability = str(capability or "chat").strip().lower() or "chat"
    if normalized_capability == "embedding":
        return {"model": None, "input": None}
    if normalized_capability == "image_generation":
        return {"model": None, "prompt": None, "n": None}
    if family == "openai_responses":
        return {
            "model": None,
            "input": None,
            "stream": None,
            "temperature": None,
            "max_output_tokens": None,
        }
    if family == "anthropic_messages":
        return {
            "model": None,
            "messages": None,
            "stream": None,
            "temperature": None,
            "max_tokens": None,
        }
    return {
        "model": None,
        "messages": None,
        "stream": None,
        "temperature": None,
        "max_tokens": None,
    }


def _default_decoder(protocol_family: str) -> str:
    family = str(protocol_family or "openai_chat").strip().lower()
    if family == "openai_responses":
        return "openai_responses"
    if family == "anthropic_messages":
        return "anthropic_messages"
    return "openai_chat"


def _default_stream_decoder(protocol_family: str) -> str:
    family = str(protocol_family or "openai_chat").strip().lower()
    if family == "openai_responses":
        return "openai_responses_stream"
    if family == "anthropic_messages":
        return "anthropic_messages_stream"
    return "openai_chat_stream"


def _default_test_payload(protocol_family: str, capability: str) -> dict[str, Any]:
    family = str(protocol_family or "openai_chat").strip().lower() or "openai_chat"
    normalized_capability = str(capability or "chat").strip().lower() or "chat"
    if normalized_capability == "embedding":
        return {"model": "text-embedding-3-small", "input": "ping"}
    if family == "openai_responses":
        return {"model": "gpt-4o-mini", "input": "ping", "stream": False}
    return {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": False,
    }


def _build_protocol_profile(
    *,
    provider: str,
    capability: str,
    protocol_family: str,
    base_url: str,
    chat_config: dict[str, Any],
) -> dict[str, Any]:
    transport = chat_config.get("transport") or {}
    request_fields = chat_config.get("request_fields") or {}
    request_template = chat_config.get("request_template")
    if not isinstance(request_template, dict):
        request_template = _canonical_request_template(protocol_family, capability)
    header_template = chat_config.get("header_template")
    if not isinstance(header_template, dict):
        header_template = {}
    default_headers = chat_config.get("default_headers")
    if not isinstance(default_headers, dict):
        default_headers = {}
    default_params = chat_config.get("default_params")
    if not isinstance(default_params, dict):
        default_params = {}
    response_template = chat_config.get("response_template")
    if not isinstance(response_template, dict):
        response_template = {}
    output_mapping = chat_config.get("output_mapping")
    if not isinstance(output_mapping, dict):
        output_mapping = {}
    request_builder = chat_config.get("request_builder")
    if not isinstance(request_builder, dict) or not request_builder.get("name"):
        request_builder = None
    async_config = chat_config.get("async_config")
    if not isinstance(async_config, dict):
        async_config = {}
    path = str(transport.get("path") or "").strip().lstrip("/")
    method = str(transport.get("method") or "POST").strip().upper() or "POST"
    content_type = str(transport.get("content_type") or "application/json").strip() or "application/json"

    return {
        "runtime_version": "v2",
        "schema_version": "2026-03-07",
        "profile_id": f"{provider}:{capability}:{protocol_family}",
        "provider": provider,
        "protocol_family": protocol_family,
        "capability": capability,
        "transport": {
            "method": method,
            "path": path,
            "query_template": {},
            "header_template": {
                **header_template,
            },
            "content_type": content_type,
        },
        "request": {
            "template_engine": str(chat_config.get("template_engine") or "openai_compat"),
            "request_template": request_template,
            "request_builder": request_builder,
        },
        "response": {
            "decoder": {"name": _default_decoder(protocol_family), "config": {}},
            "response_template": response_template,
            "output_mapping": output_mapping,
        },
        "stream": {
            "stream_decoder": {
                "name": _default_stream_decoder(protocol_family),
                "config": {},
            }
        },
        "auth": {"auth_policy": "inherit", "config": {}},
        "features": {
            "supports_messages": protocol_family != "openai_responses",
            "supports_input_items": protocol_family == "openai_responses",
            "supports_tools": True,
            "supports_reasoning": protocol_family in {"openai_responses", "anthropic_messages"},
            "supports_json_mode": protocol_family != "anthropic_messages",
        },
        "defaults": {
            "headers": {
                **default_headers,
            },
            "query": {},
            "body": {
                **default_params,
            },
        },
        "metadata": {
            "doc_ingestion_source_base_url": base_url,
            "request_fields": {
                "required": list(request_fields.get("required") or []),
                "optional": list(request_fields.get("optional") or []),
            },
            "async_config": async_config,
        },
    }


def _build_provider_registry_handoff(
    *,
    candidate: dict[str, Any],
    protocol_profile: dict[str, Any],
) -> dict[str, Any]:
    chat_profile = protocol_profile
    capability = str(chat_profile.get("capability") or "chat").strip().lower() or "chat"
    request = chat_profile.get("request") or {}
    transport = chat_profile.get("transport") or {}
    response = chat_profile.get("response") or {}
    defaults = chat_profile.get("defaults") or {}
    return {
        "get_unified_schema": {
            "capability": capability,
        },
        "verify_provider_template": {
            "capability": capability,
            "base_url": candidate.get("base_url"),
            "protocol_family": chat_profile.get("protocol_family"),
            "upstream_path": transport.get("path"),
            "template_engine": request.get("template_engine") or "openai_compat",
            "request_template": request.get("request_template") or {},
            "header_template": transport.get("header_template") or {},
            "default_headers": defaults.get("headers") or {},
            "default_params": defaults.get("body") or {},
            "response_template": response.get("response_template") or {},
            "output_mapping": response.get("output_mapping") or {},
            "request_builder": request.get("request_builder"),
            "test_payload": _default_test_payload(
                str(chat_profile.get("protocol_family") or "openai_chat"),
                capability,
            ),
        },
        "save_provider_to_marketplace": {
            "slug": candidate.get("slug"),
            "name": candidate.get("name"),
            "provider": candidate.get("provider"),
            "base_url": candidate.get("base_url"),
            "auth_type": candidate.get("auth_type"),
            "protocol_schema_version": chat_profile.get("schema_version") or "2026-03-07",
            "protocol_profiles": {
                capability: chat_profile,
            },
        },
    }


async def collect_provider_doc_evidence(
    urls: list[str],
    js_mode: bool = True,
) -> dict[str, Any]:
    documents: list[dict[str, Any]] = []
    fetch_errors: list[dict[str, Any]] = []

    if not isinstance(urls, list) or not urls:
        return {
            "status": "error",
            "message": "urls are required",
            "documents": [],
            "fetch_errors": [],
            "extraction_schema": _load_json_asset("extraction_schema.json"),
            "prompt_template": _load_text_asset("prompt_template.md"),
            "protocol_profile_template": _load_json_asset("protocol_profile_template.json"),
            "provider_registry_handoff_template": _load_json_asset("provider_registry_handoff_template.json"),
        }

    if not deeting:
        return {
            "status": "error",
            "message": "SDK not found",
            "documents": [],
            "fetch_errors": [],
            "extraction_schema": _load_json_asset("extraction_schema.json"),
            "prompt_template": _load_text_asset("prompt_template.md"),
            "protocol_profile_template": _load_json_asset("protocol_profile_template.json"),
            "provider_registry_handoff_template": _load_json_asset("provider_registry_handoff_template.json"),
        }

    for raw_url in urls:
        url = str(raw_url or "").strip()
        if not url:
            fetch_errors.append(
                {
                    "source_url": url,
                    "error": "empty_url",
                }
            )
            continue

        try:
            fetched = deeting.call_tool("web.fetch", url=url, js_mode=js_mode)
            if not isinstance(fetched, dict):
                fetched = {"status": "error", "message": "unexpected fetch response"}
            documents.append(
                {
                    "source_url": url,
                    "title": fetched.get("title"),
                    "content": fetched.get("content") or fetched.get("markdown") or "",
                    "raw_response": fetched,
                }
            )
        except Exception as exc:
            fetch_errors.append(
                {
                    "source_url": url,
                    "error": str(exc),
                }
            )

    status = "success"
    if fetch_errors and documents:
        status = "partial"
    elif fetch_errors and not documents:
        status = "error"

    return {
        "status": status,
        "documents": documents,
        "fetch_errors": fetch_errors,
        "extraction_schema": _load_json_asset("extraction_schema.json"),
        "prompt_template": _load_text_asset("prompt_template.md"),
        "protocol_profile_template": _load_json_asset("protocol_profile_template.json"),
        "provider_registry_handoff_template": _load_json_asset("provider_registry_handoff_template.json"),
    }


def _build_chat_candidate(
    provider: str,
    display_name: str,
    auth: dict[str, Any],
    chat_config: dict[str, Any],
    gaps: list[str],
) -> dict[str, Any]:
    protocol_family = str(chat_config.get("protocol_family") or "openai_chat").strip() or "openai_chat"
    slug = f"{_slugify(provider)}-chat" if provider else "provider-chat"
    verification_gaps = [str(item).strip() for item in gaps if str(item).strip()]
    base_url = str(chat_config.get("base_url") or "").strip()
    protocol_profile = _build_protocol_profile(
        provider=provider,
        capability="chat",
        protocol_family=protocol_family,
        base_url=base_url,
        chat_config=chat_config,
    )
    request_fields = (
        protocol_profile.get("metadata", {}).get("request_fields", {})
        if isinstance(protocol_profile.get("metadata"), dict)
        else {}
    )
    return {
        "slug": slug,
        "name": f"{display_name} Chat".strip(),
        "provider": provider,
        "base_url": base_url,
        "auth_type": auth.get("auth_type"),
        "auth_header": {
            "name": auth.get("header_name"),
            "scheme": auth.get("header_scheme"),
            "env_key_hint": auth.get("env_key_hint"),
        },
        "protocol_profiles": {
            "chat": protocol_profile,
        },
        "request_fields": {
            "required": list(request_fields.get("required") or []),
            "optional": list(request_fields.get("optional") or []),
        },
        "verification_gaps": verification_gaps,
        "verification_ready": not verification_gaps,
        "provider_registry_handoff": {},
    }


async def draft_provider_candidate(extraction_report: dict[str, Any]) -> dict[str, Any]:
    report = extraction_report if isinstance(extraction_report, dict) else {}
    identity = report.get("provider_identity") or {}
    provider = str(identity.get("provider") or "").strip()
    display_name = str(identity.get("product_name") or provider or "Provider").strip()
    auth = report.get("auth") or {}
    capabilities = report.get("capabilities") or {}
    gaps = report.get("gaps") or []

    chat_config = capabilities.get("chat") if isinstance(capabilities, dict) else None
    if not isinstance(chat_config, dict):
        return {
            "status": "error",
            "message": "chat capability is required for the current candidate builder",
        }

    candidate = _build_chat_candidate(provider, display_name, auth, chat_config, gaps)
    chat_profile = candidate["protocol_profiles"]["chat"]
    candidate["provider_registry_handoff"] = _build_provider_registry_handoff(
        candidate=candidate,
        protocol_profile=chat_profile,
    )
    candidate["status"] = "success"
    return candidate


async def score_provider_candidate_readiness(candidate: dict[str, Any]) -> dict[str, Any]:
    current = candidate if isinstance(candidate, dict) else {}
    missing_fields: list[str] = []
    for field in ["slug", "name", "provider", "base_url", "auth_type", "protocol_profiles"]:
        value = current.get(field)
        if value in (None, "", {}):
            missing_fields.append(field)

    verification_gaps = [str(item).strip() for item in current.get("verification_gaps") or [] if str(item).strip()]
    missing_fields.extend(item for item in verification_gaps if item not in missing_fields)

    candidate_ready = not any(
        field in {"slug", "name", "provider", "base_url", "auth_type", "protocol_profiles"}
        for field in missing_fields
    )

    return {
        "status": "success",
        "evidence_ready": candidate_ready,
        "candidate_ready": candidate_ready,
        "verify_ready": candidate_ready and not verification_gaps and bool(current.get("verification_ready")),
        "missing_fields": missing_fields,
    }


async def build_provider_registry_handoff(candidate: dict[str, Any]) -> dict[str, Any]:
    current = candidate if isinstance(candidate, dict) else {}
    protocol_profiles = current.get("protocol_profiles")
    if not isinstance(protocol_profiles, dict) or not protocol_profiles:
        return {
            "status": "error",
            "message": "candidate.protocol_profiles is required",
        }

    chat_profile = protocol_profiles.get("chat")
    if not isinstance(chat_profile, dict):
        return {
            "status": "error",
            "message": "candidate.protocol_profiles.chat is required",
        }

    handoff = _build_provider_registry_handoff(
        candidate=current,
        protocol_profile=chat_profile,
    )
    return {
        "status": "success",
        "handoff": handoff,
    }


async def dispatch(raw_input: str) -> dict[str, Any]:
    data = json.loads(raw_input)
    method = data.get("method") or data.get("tool")
    args = data.get("arguments") or data.get("params") or {}

    if method == "collect_provider_doc_evidence":
        return await collect_provider_doc_evidence(**args)
    if method == "draft_provider_candidate":
        return await draft_provider_candidate(**args)
    if method == "score_provider_candidate_readiness":
        return await score_provider_candidate_readiness(**args)
    if method == "build_provider_registry_handoff":
        return await build_provider_registry_handoff(**args)
    return {"error": f"Unknown method: {method}"}


async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            return
        result = await dispatch(raw_input)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(handle_input())
