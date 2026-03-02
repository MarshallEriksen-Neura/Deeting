import json
import urllib.request

import pytest

from app.services.runtime.deeting_runtime_sdk import build_runtime_preamble


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return json.dumps(self._payload, ensure_ascii=False).encode("utf-8")


def _build_runtime_class():
    namespace = {"json": json}
    exec(build_runtime_preamble(max_tool_calls=8), namespace, namespace)
    return namespace["DeetingRuntime"]


def test_runtime_call_tool_extracts_nested_bridge_error(monkeypatch):
    def _fake_urlopen(_req, timeout=0):
        assert timeout == 3
        return _FakeResponse(
            {
                "ok": False,
                "result": {
                    "error": "Remote MCP tool 'tavily-search' failed: httpx.ConnectError",
                    "error_code": "MCP_CONNECT_ERROR",
                },
                "meta": {"trace_id": "trace-1"},
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    runtime_cls = _build_runtime_class()
    runtime = runtime_cls(
        context={
            "bridge": {
                "endpoint": "http://bridge.local/api/v1/internal/bridge/call",
                "execution_token": "token-1",
                "timeout_seconds": 3,
            }
        }
    )

    result = runtime.call_tool("tavily-search", query="test")

    assert result["error"].startswith("Remote MCP tool 'tavily-search' failed")
    assert result["error_code"] == "MCP_CONNECT_ERROR"
    assert result["bridge_meta"]["trace_id"] == "trace-1"


def test_runtime_call_tool_compatible_with_top_level_bridge_error(monkeypatch):
    def _fake_urlopen(_req, timeout=0):
        assert timeout == 2
        return _FakeResponse(
            {
                "ok": False,
                "error": "bridge dispatch failed",
                "error_code": "CODE_MODE_BRIDGE_DISPATCH_FAILED",
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    runtime_cls = _build_runtime_class()
    runtime = runtime_cls(
        context={
            "bridge": {
                "endpoint": "http://bridge.local/api/v1/internal/bridge/call",
                "execution_token": "token-2",
                "timeout_seconds": 2,
            }
        }
    )

    result = runtime.call_tool("fetch_web_content", url="https://example.com")

    assert result == {
        "error": "bridge dispatch failed",
        "error_code": "CODE_MODE_BRIDGE_DISPATCH_FAILED",
    }


def test_runtime_call_tool_extracts_message_when_error_missing(monkeypatch):
    def _fake_urlopen(_req, timeout=0):
        assert timeout == 4
        return _FakeResponse(
            {
                "ok": False,
                "result": {
                    "status": "error",
                    "message": "No assistant candidates extracted from artifact",
                },
                "meta": {"trace_id": "trace-2"},
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)

    runtime_cls = _build_runtime_class()
    runtime = runtime_cls(
        context={
            "bridge": {
                "endpoint": "http://bridge.local/api/v1/internal/bridge/call",
                "execution_token": "token-3",
                "timeout_seconds": 4,
            }
        }
    )

    result = runtime.call_tool("batch_convert_artifact_to_assistants", artifact_id="x")

    assert result["error"] == "No assistant candidates extracted from artifact"
    assert result["error_code"] is None
    assert result["bridge_meta"]["trace_id"] == "trace-2"


def test_runtime_call_tool_logs_bridge_timeout_details(monkeypatch):
    def _fake_urlopen(_req, timeout=0):
        raise TimeoutError("timed out")

    captured_logs: list[str] = []

    def _fake_print(*args, **kwargs):
        captured_logs.append(" ".join(str(item) for item in args))

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen)
    monkeypatch.setattr("builtins.print", _fake_print)

    runtime_cls = _build_runtime_class()
    runtime = runtime_cls(
        context={
            "bridge": {
                "endpoint": "http://bridge.local/api/v1/internal/bridge/call",
                "execution_token": "token-timeout",
                "timeout_seconds": 2,
            }
        }
    )

    with pytest.raises(BaseException):
        runtime.call_tool("tavily-search", query="天津天气")

    text = "\n".join(captured_logs)
    assert "bridge call failed, fallback marker mode:" in text
    assert "tool=tavily-search" in text
    assert "timeout_seconds=2.0" in text
    assert "elapsed_ms=" in text
