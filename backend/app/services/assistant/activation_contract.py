from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

ASSISTANT_ACTIVATION_FORMAT_VERSION = "assistant_activation.v1"
ASSISTANT_ACTIVATION_SCOPE = "request"
ASSISTANT_ACTIVATION_MODE = "replace"


def build_assistant_consult_payload(
    *,
    candidates: list[dict[str, Any]],
    reason: str | None = None,
) -> dict[str, Any]:
    normalized = [candidate for candidate in candidates if isinstance(candidate, dict)]
    recommended_assistant_id = None
    if normalized:
        recommended_assistant_id = (
            str(normalized[0].get("assistant_id") or "").strip() or None
        )
    return {
        "action": "consulted",
        "scope": ASSISTANT_ACTIVATION_SCOPE,
        "format_version": ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "candidates": normalized,
        "recommended_assistant_id": recommended_assistant_id,
        "reason": str(reason or "").strip() or None,
    }


def build_assistant_activation_payload(
    *,
    assistant_id: str,
    assistant_name: str,
    system_prompt: str,
    skill_tools: list[dict[str, Any]] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    normalized_assistant_id = str(assistant_id or "").strip()
    normalized_name = str(assistant_name or "").strip() or "Assistant"
    normalized_prompt = str(system_prompt or "").strip()
    normalized_tools = [tool for tool in (skill_tools or []) if isinstance(tool, dict)]
    activated_at = datetime.now(UTC).isoformat()
    return {
        "action": "activated",
        "scope": ASSISTANT_ACTIVATION_SCOPE,
        "format_version": ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "activation_mode": ASSISTANT_ACTIVATION_MODE,
        "assistant_id": normalized_assistant_id,
        "assistant_name": normalized_name,
        "system_prompt": normalized_prompt,
        "skill_tools": normalized_tools,
        "reason": str(reason or "").strip() or None,
        "activated_at": activated_at,
        "assistant_transition": {
            "action": "activated",
            "assistant_id": normalized_assistant_id,
            "assistant_name": normalized_name,
            "reason": str(reason or "").strip() or None,
            "activated_at": activated_at,
        },
    }


def build_assistant_deactivation_payload(
    *,
    assistant_id: str | None,
    assistant_name: str | None,
    reason: str | None = None,
) -> dict[str, Any]:
    normalized_assistant_id = str(assistant_id or "").strip() or None
    normalized_name = str(assistant_name or "").strip() or None
    deactivated_at = datetime.now(UTC).isoformat()
    return {
        "action": "deactivated",
        "scope": ASSISTANT_ACTIVATION_SCOPE,
        "format_version": ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "assistant_id": normalized_assistant_id,
        "assistant_name": normalized_name,
        "reason": str(reason or "").strip() or None,
        "deactivated_at": deactivated_at,
        "assistant_transition": {
            "action": "deactivated",
            "assistant_id": normalized_assistant_id,
            "assistant_name": normalized_name,
            "reason": str(reason or "").strip() or None,
            "deactivated_at": deactivated_at,
        },
    }
