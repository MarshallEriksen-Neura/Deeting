from __future__ import annotations

from typing import Any

from app.core.logging import logger

_SENSITIVE_KEYWORDS = {
    "authorization",
    "cookie",
    "key",
    "password",
    "secret",
    "token",
}
_MAX_STRING_LEN = 160
_MAX_DEPTH = 6
_MAX_COLLECTION_ITEMS = 30


def _should_mask_key(key: str) -> bool:
    lowered = key.lower()
    return any(word in lowered for word in _SENSITIVE_KEYWORDS)


class CodeModeAuditService:
    def sanitize_arguments(self, value: Any, *, depth: int = 0) -> Any:
        if depth >= _MAX_DEPTH:
            return "[TRUNCATED]"

        if isinstance(value, dict):
            output: dict[str, Any] = {}
            items = list(value.items())[:_MAX_COLLECTION_ITEMS]
            for key, item in items:
                key_text = str(key)
                if _should_mask_key(key_text):
                    output[key_text] = "***"
                else:
                    output[key_text] = self.sanitize_arguments(item, depth=depth + 1)
            return output

        if isinstance(value, list):
            return [
                self.sanitize_arguments(item, depth=depth + 1)
                for item in value[:_MAX_COLLECTION_ITEMS]
            ]

        if isinstance(value, tuple):
            return [
                self.sanitize_arguments(item, depth=depth + 1)
                for item in list(value)[:_MAX_COLLECTION_ITEMS]
            ]

        if isinstance(value, str):
            if len(value) > _MAX_STRING_LEN:
                return value[:_MAX_STRING_LEN] + "... (truncated)"
            return value

        return value

    def record_bridge_call(
        self,
        *,
        tool_name: str,
        arguments: dict[str, Any] | None,
        status: str,
        duration_ms: float,
        trace_id: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        call_index: int | None = None,
        max_calls: int | None = None,
        error_code: str | None = None,
        error: str | None = None,
        http_status: int | None = None,
        client_ip: str | None = None,
    ) -> None:
        safe_args = self.sanitize_arguments(arguments or {})
        logger.info(
            "code_mode_bridge_audit",
            extra={
                "tool_name": tool_name,
                "arguments": safe_args,
                "status": status,
                "duration_ms": round(float(duration_ms), 2),
                "trace_id": trace_id,
                "session_id": session_id,
                "user_id": user_id,
                "call_index": call_index,
                "max_calls": max_calls,
                "error_code": error_code,
                "error": (
                    (str(error)[:_MAX_STRING_LEN] + "... (truncated)")
                    if isinstance(error, str) and len(error) > _MAX_STRING_LEN
                    else error
                ),
                "http_status": http_status,
                "client_ip": client_ip,
            },
        )


code_mode_audit_service = CodeModeAuditService()


__all__ = ["CodeModeAuditService", "code_mode_audit_service"]
