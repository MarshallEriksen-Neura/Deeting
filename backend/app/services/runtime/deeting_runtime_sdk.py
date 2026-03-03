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
                self.version = "1.2.0"
                self._inline_context = context or {}
                self._full_context = None
                self._tool_results = list(tool_results or [])
                self._call_index = 0
                self._max_tool_calls = int(max_tool_calls or 0)

            @property
            def context(self):
                if self._full_context is not None:
                    return self._full_context
                bridge = self._inline_context.get("bridge") if isinstance(self._inline_context, dict) else {}
                endpoint = str((bridge or {}).get("endpoint") or "").strip()
                execution_token = str((bridge or {}).get("execution_token") or "").strip()
                if endpoint and execution_token:
                    fetched = self._fetch_context_from_bridge(endpoint, execution_token, bridge)
                    if fetched is not None:
                        fetched["bridge"] = bridge
                        self._full_context = fetched
                        return self._full_context
                self._full_context = self._inline_context
                return self._full_context

            def _fetch_context_from_bridge(self, endpoint, execution_token, bridge):
                timeout_seconds = float((bridge or {}).get("timeout_seconds") or 120)
                context_endpoint = endpoint.replace("/call", "/context")
                try:
                    import urllib.request
                    req = urllib.request.Request(
                        context_endpoint,
                        data=json.dumps({"execution_token": execution_token}, ensure_ascii=False).encode("utf-8"),
                        headers={
                            "Content-Type": "application/json",
                            "__BRIDGE_EXECUTION_TOKEN_HEADER__": execution_token,
                        },
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                        body = response.read().decode("utf-8")
                    parsed = json.loads(body) if body else {}
                    if isinstance(parsed, dict) and parsed.get("ok") and isinstance(parsed.get("context"), dict):
                        return parsed["context"]
                except Exception:
                    pass
                return None

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

            def call_tool(self, tool_name, *args, **arguments):
                if args:
                    if len(args) == 1 and isinstance(args[0], dict):
                        merged = dict(args[0])
                        merged.update(arguments or {})
                        arguments = merged
                    else:
                        raise TypeError("deeting.call_tool expects keyword args")
                
                idx = self._call_index
                self._call_index += 1

                # 1. Return cached result if available (for re-execution mode)
                if idx < len(self._tool_results):
                    return self._tool_results[idx]

                if idx >= self._max_tool_calls:
                    raise RuntimeError("runtime tool call limit exceeded")

                # 2. Try HTTP Bridge if available
                bridge = self._inline_context.get("bridge") if isinstance(self._inline_context, dict) else {}
                endpoint = str((bridge or {}).get("endpoint") or "").strip()
                execution_token = str((bridge or {}).get("execution_token") or "").strip()
                
                if endpoint and execution_token:
                    try:
                        import urllib.request
                        import time
                        
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
                        with urllib.request.urlopen(req, timeout=120) as response:
                            body = response.read().decode("utf-8")
                        parsed = json.loads(body) if body else {}
                        if isinstance(parsed, dict) and parsed.get("ok"):
                            return parsed.get("result")
                        # If HTTP returns error, we don't return it yet, try marker fallback
                    except Exception as exc:
                        # Log error to stderr so user can see why bridge failed
                        import sys
                        print(f"[deeting.bridge] Warning: HTTP bridge failed: {exc}", file=sys.stderr)

                # 3. ELEGANT FALLBACK: Marker Mode
                # This works by printing a special token that the host intercepts.
                payload = {
                    "index": idx,
                    "tool_name": str(tool_name or "").strip(),
                    "arguments": arguments or {},
                }
                # Use a clean, simple print to avoid escaping nightmares
                print(f"\\n__RUNTIME_TOOL_CALL_MARKER__{json.dumps(payload, ensure_ascii=False)}")
                
                # In marker mode, we MUST stop execution because the host will re-run us with the result.
                raise _DeetingHostToolCallSignal(f"pending tool call: {tool_name}")

            def _bridge_info(self):
                bridge = self._inline_context.get("bridge") if isinstance(self._inline_context, dict) else {}
                endpoint = str((bridge or {}).get("endpoint") or "").strip()
                execution_token = str((bridge or {}).get("execution_token") or "").strip()
                timeout_seconds = float((bridge or {}).get("timeout_seconds") or 120)
                return endpoint, execution_token, timeout_seconds

            def write_file(self, name, data, content_type="application/octet-stream"):
                import base64
                import urllib.request

                endpoint, execution_token, timeout_seconds = self._bridge_info()
                if not endpoint or not execution_token:
                    raise RuntimeError("bridge not available for file operations")

                file_endpoint = endpoint.replace("/call", "/file/write")
                if isinstance(data, str):
                    data = data.encode("utf-8")
                encoded = base64.b64encode(data).decode("ascii")

                req_payload = {
                    "name": str(name or "file"),
                    "content_base64": encoded,
                    "content_type": content_type,
                    "execution_token": execution_token,
                }
                req = urllib.request.Request(
                    file_endpoint,
                    data=json.dumps(req_payload, ensure_ascii=False).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "__BRIDGE_EXECUTION_TOKEN_HEADER__": execution_token,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                    body = response.read().decode("utf-8")
                parsed = json.loads(body) if body else {}
                if isinstance(parsed, dict) and parsed.get("ok") and isinstance(parsed.get("file_ref"), dict):
                    return parsed["file_ref"]
                raise RuntimeError(str(parsed.get("error") or "file write failed"))

            def read_file(self, file_ref):
                import base64
                import urllib.request

                endpoint, execution_token, timeout_seconds = self._bridge_info()
                if not endpoint or not execution_token:
                    raise RuntimeError("bridge not available for file operations")

                ref_id = file_ref.get("id") if isinstance(file_ref, dict) else str(file_ref)
                file_endpoint = endpoint.replace("/call", "/file/read")

                req_payload = {
                    "ref_id": ref_id,
                    "execution_token": execution_token,
                }
                req = urllib.request.Request(
                    file_endpoint,
                    data=json.dumps(req_payload, ensure_ascii=False).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "__BRIDGE_EXECUTION_TOKEN_HEADER__": execution_token,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                    body = response.read().decode("utf-8")
                parsed = json.loads(body) if body else {}
                if isinstance(parsed, dict) and parsed.get("ok") and parsed.get("content_base64"):
                    return base64.b64decode(parsed["content_base64"])
                raise RuntimeError(str(parsed.get("error") or "file read failed"))
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
