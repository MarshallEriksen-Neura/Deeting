"""
DeetingRuntime — the shared SDK for Deeting skills.

Works in three execution contexts:
  1. Cloud sandbox (execute_code_plan) — injected as preamble, uses Bridge or Marker
  2. Cloud builtin subprocess (builtin.py) — imported via PYTHONPATH, uses Marker
  3. Desktop subprocess (execute_local_mcp_tool) — imported via PYTHONPATH, uses Marker

Communication modes for call_tool:
  - Bridge: HTTP POST to a bridge endpoint (fast, synchronous, cloud sandbox only)
  - Marker: Print a sentinel line to stdout and raise a signal; the host process
    intercepts it, executes the tool, and re-runs the subprocess with cached results.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from .protocol import (
    EXECUTION_TOKEN_HEADER,
    RENDER_BLOCK_MARKER,
    TOOL_CALL_MARKER,
    parse_runtime_context,
    render_block_payload,
    tool_call_payload,
)


class _HostToolCallSignal(BaseException):
    """Raised in Marker mode to halt execution so the host can fulfill the tool call."""
    pass


class DeetingRuntime:
    """Deeting skill runtime — provides logging, rendering, and cross-tool calls."""

    def __init__(
        self,
        context: dict[str, Any] | None = None,
        tool_results: list[Any] | None = None,
        max_tool_calls: int = 8,
    ):
        self.version = "2.0.0"
        self._inline_context = context or {}
        self._full_context: dict[str, Any] | None = None
        self._tool_results = list(tool_results or [])
        self._call_index = 0
        self._max_tool_calls = int(max_tool_calls or 0)

    # ------------------------------------------------------------------
    # Context
    # ------------------------------------------------------------------

    @property
    def context(self) -> dict[str, Any]:
        if self._full_context is not None:
            return self._full_context
        bridge = self._bridge_info()
        if bridge["endpoint"] and bridge["token"]:
            fetched = self._fetch_context_from_bridge(bridge)
            if fetched is not None:
                fetched["bridge"] = self._inline_context.get("bridge") if isinstance(self._inline_context, dict) else {}
                self._full_context = fetched
                return self._full_context
        self._full_context = self._inline_context
        return self._full_context

    def get_context(self) -> dict[str, Any]:
        return self.context

    # ------------------------------------------------------------------
    # Logging / Output
    # ------------------------------------------------------------------

    def log(self, *args: Any) -> None:
        print("[deeting.log]", *args)

    def section(self, title: str) -> None:
        print(f"\n[deeting.section] {title}")

    def render(
        self,
        view_type: str,
        payload: dict[str, Any] | None = None,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        block = render_block_payload(
            view_type,
            payload=payload,
            title=title,
            metadata=metadata,
        )
        if not block["view_type"]:
            raise ValueError("view_type is required")
        print(f"{RENDER_BLOCK_MARKER}{json.dumps(block, ensure_ascii=False, default=str)}")
        return block

    # ------------------------------------------------------------------
    # Tool Calling
    # ------------------------------------------------------------------

    def call_tool(self, tool_name: str, *args: Any, **arguments: Any) -> Any:
        if args:
            if len(args) == 1 and isinstance(args[0], dict):
                merged = dict(args[0])
                merged.update(arguments or {})
                arguments = merged
            else:
                raise TypeError("deeting.call_tool expects keyword args")

        idx = self._call_index
        self._call_index += 1

        if idx < len(self._tool_results):
            return self._tool_results[idx]

        if self._max_tool_calls and idx >= self._max_tool_calls:
            raise RuntimeError("runtime tool call limit exceeded")

        bridge = self._bridge_info()
        if bridge["endpoint"] and bridge["token"]:
            result = self._call_via_bridge(tool_name, arguments, bridge)
            if result is not None:
                return result

        payload = tool_call_payload(idx, tool_name, arguments or {})
        print(f"\n{TOOL_CALL_MARKER}{json.dumps(payload, ensure_ascii=False)}")
        raise _HostToolCallSignal(f"pending tool call: {tool_name}")

    # ------------------------------------------------------------------
    # File I/O (Bridge-only)
    # ------------------------------------------------------------------

    def write_file(
        self,
        name: str,
        data: str | bytes,
        content_type: str = "application/octet-stream",
    ) -> dict[str, Any]:
        import base64

        bridge = self._bridge_info()
        if not bridge["endpoint"] or not bridge["token"]:
            raise RuntimeError("bridge not available for file operations")

        file_endpoint = bridge["endpoint"].replace("/call", "/file/write")
        if isinstance(data, str):
            data = data.encode("utf-8")
        encoded = base64.b64encode(data).decode("ascii")

        return self._bridge_post(file_endpoint, bridge["token"], bridge["timeout"], {
            "name": str(name or "file"),
            "content_base64": encoded,
            "content_type": content_type,
            "execution_token": bridge["token"],
        }, result_key="file_ref")

    def read_file(self, file_ref: dict[str, Any] | str) -> bytes:
        import base64

        bridge = self._bridge_info()
        if not bridge["endpoint"] or not bridge["token"]:
            raise RuntimeError("bridge not available for file operations")

        ref_id = file_ref.get("id") if isinstance(file_ref, dict) else str(file_ref)
        file_endpoint = bridge["endpoint"].replace("/call", "/file/read")

        result = self._bridge_post(file_endpoint, bridge["token"], bridge["timeout"], {
            "ref_id": ref_id,
            "execution_token": bridge["token"],
        }, result_key="content_base64")
        return base64.b64decode(result)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _bridge_info(self) -> dict[str, Any]:
        """Resolve bridge config from inline context or environment."""
        bridge_ctx = (
            self._inline_context.get("bridge")
            if isinstance(self._inline_context, dict)
            else {}
        ) or {}
        endpoint = str(bridge_ctx.get("endpoint") or os.environ.get("DEETING_BRIDGE_ENDPOINT") or "").strip()
        token = str(bridge_ctx.get("execution_token") or os.environ.get("DEETING_BRIDGE_TOKEN") or "").strip()
        timeout = float(bridge_ctx.get("timeout_seconds") or os.environ.get("DEETING_BRIDGE_TIMEOUT") or 120)
        return {"endpoint": endpoint, "token": token, "timeout": timeout}

    def _call_via_bridge(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        bridge: dict[str, Any],
    ) -> Any | None:
        try:
            parsed = self._bridge_post(bridge["endpoint"], bridge["token"], bridge["timeout"], {
                "tool_name": str(tool_name or "").strip(),
                "arguments": arguments or {},
                "execution_token": bridge["token"],
            })
            return parsed
        except Exception as exc:
            print(f"[deeting.bridge] Warning: HTTP bridge failed: {exc}", file=sys.stderr)
        return None

    @staticmethod
    def _bridge_post(
        endpoint: str,
        token: str,
        timeout: float,
        payload: dict[str, Any],
        result_key: str | None = None,
    ) -> Any:
        import urllib.request

        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                EXECUTION_TOKEN_HEADER: token,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
        parsed = json.loads(body) if body else {}
        if isinstance(parsed, dict) and parsed.get("ok"):
            if result_key:
                val = parsed.get(result_key)
                if val is not None:
                    return val
                raise RuntimeError(str(parsed.get("error") or f"{result_key} missing"))
            return parsed.get("result")
        raise RuntimeError(str(parsed.get("error") or "bridge call failed"))

    def _fetch_context_from_bridge(self, bridge: dict[str, Any]) -> dict[str, Any] | None:
        context_endpoint = bridge["endpoint"].replace("/call", "/context")
        try:
            parsed = self._bridge_post(context_endpoint, bridge["token"], bridge["timeout"], {
                "execution_token": bridge["token"],
            }, result_key="context")
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Module-level singleton — skills do `from deeting import deeting`
#
# The host can pass context and cached tool results via the env var
# DEETING_RUNTIME_CONTEXT (JSON) so that Marker re-executions work.
# Format: {"context": {...}, "tool_results": [...], "max_tool_calls": 8}
# ---------------------------------------------------------------------------

def _create_singleton() -> DeetingRuntime:
    blob = parse_runtime_context(os.environ.get("DEETING_RUNTIME_CONTEXT", "").strip())
    if blob["context"] or blob["tool_results"] or blob["max_tool_calls"] != 8:
        return DeetingRuntime(
            context=blob["context"],
            tool_results=blob["tool_results"],
            max_tool_calls=blob["max_tool_calls"],
        )
    return DeetingRuntime()


deeting = _create_singleton()
