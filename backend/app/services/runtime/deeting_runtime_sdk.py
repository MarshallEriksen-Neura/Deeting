from __future__ import annotations

import textwrap

from app.services.code_mode import protocol as code_mode_protocol

DEFAULT_BRIDGE_EXECUTION_TOKEN_HEADER = "X-Code-Mode-Execution-Token"


def build_runtime_preamble(
    *,
    max_tool_calls: int,
    bridge_execution_token_header: str = DEFAULT_BRIDGE_EXECUTION_TOKEN_HEADER,
) -> str:
    raw = textwrap.dedent(
        """
        class _DeetingHostToolCallSignal(BaseException):
            pass

        class DeetingRuntime:
            def __init__(self, context=None, tool_results=None, max_tool_calls=__MAX_RUNTIME_TOOL_CALLS__):
                self.version = "1.1.0"
                self.context = context or {}
                self._tool_results = list(tool_results or [])
                self._call_index = 0
                self._max_tool_calls = int(max_tool_calls or 0)

            def log(self, *args):
                print("[deeting.log]", *args)

            def section(self, title):
                print(f"\\n[deeting.section] {title}")

            def get_context(self):
                return self.context

            def render(self, view_type, payload=None, title=None, metadata=None):
                vt = str(view_type or "").strip()
                if not vt:
                    raise ValueError("view_type is required")

                block = {
                    "view_type": vt,
                    "payload": payload if payload is not None else {},
                }
                if title is not None:
                    block["title"] = title
                if metadata is not None:
                    block["metadata"] = metadata
                print("__RUNTIME_RENDER_BLOCK_MARKER__" + json.dumps(block, ensure_ascii=False, default=str))
                return block

            def call_tool(self, tool_name, **arguments):
                idx = self._call_index
                self._call_index += 1

                if idx < len(self._tool_results):
                    return self._tool_results[idx]

                if idx >= self._max_tool_calls:
                    raise RuntimeError("runtime tool call limit exceeded")

                bridge = self.context.get("bridge") if isinstance(self.context, dict) else {}
                endpoint = str((bridge or {}).get("endpoint") or "").strip()
                execution_token = str((bridge or {}).get("execution_token") or "").strip()
                timeout_seconds = float((bridge or {}).get("timeout_seconds") or 15)
                if endpoint and execution_token:
                    try:
                        import urllib.request

                        request_payload = {
                            "tool_name": str(tool_name or "").strip(),
                            "arguments": arguments or {},
                            "execution_token": execution_token,
                        }
                        req = urllib.request.Request(
                            endpoint,
                            data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
                            headers={
                                "Content-Type": "application/json",
                                "__BRIDGE_EXECUTION_TOKEN_HEADER__": execution_token,
                            },
                            method="POST",
                        )
                        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                            body = response.read().decode("utf-8")
                        parsed = json.loads(body) if body else {}
                        if isinstance(parsed, dict):
                            if parsed.get("ok") is False:
                                return {
                                    "error": str(parsed.get("error") or "bridge call failed"),
                                    "error_code": parsed.get("error_code"),
                                }
                            if "result" in parsed:
                                return parsed.get("result")
                            return parsed
                    except Exception as exc:
                        self.log("bridge call failed, fallback marker mode:", exc)

                payload = {
                    "index": idx,
                    "tool_name": str(tool_name or "").strip(),
                    "arguments": arguments or {},
                }
                print("__RUNTIME_TOOL_CALL_MARKER__" + json.dumps(payload, ensure_ascii=False))
                raise _DeetingHostToolCallSignal(f"pending runtime tool call #{idx}")
        """
    )
    return (
        raw.replace("__MAX_RUNTIME_TOOL_CALLS__", str(int(max_tool_calls or 0)))
        .replace(
            "__RUNTIME_TOOL_CALL_MARKER__", code_mode_protocol.RUNTIME_TOOL_CALL_MARKER
        )
        .replace(
            "__RUNTIME_RENDER_BLOCK_MARKER__",
            code_mode_protocol.RUNTIME_RENDER_BLOCK_MARKER,
        )
        .replace("__BRIDGE_EXECUTION_TOKEN_HEADER__", bridge_execution_token_header)
    )
