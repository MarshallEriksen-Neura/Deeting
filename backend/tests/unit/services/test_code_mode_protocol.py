import json

from app.services.code_mode import protocol as code_mode_protocol


def test_extract_runtime_tool_request_from_result():
    marker = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER + json.dumps(
        {"index": 0, "tool_name": "search_web", "arguments": {"q": "abc"}},
        ensure_ascii=False,
    )
    payload = code_mode_protocol.extract_runtime_tool_request(
        {
            "stdout": ["line-1", marker],
            "stderr": [],
            "result": [],
        }
    )

    assert payload is not None
    assert payload["tool_name"] == "search_web"
    assert payload["arguments"]["q"] == "abc"


def test_extract_runtime_tool_request_returns_empty_dict_on_invalid_json():
    text = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER + "{bad-json"
    payload = code_mode_protocol.extract_runtime_tool_request_from_text(text)
    assert payload == {}


def test_extract_runtime_render_payloads_from_text():
    render_marker = code_mode_protocol.RUNTIME_RENDER_BLOCK_MARKER + json.dumps(
        {"view_type": "table.simple", "payload": {"rows": [{"name": "alice"}]}},
        ensure_ascii=False,
    )
    payloads = code_mode_protocol.extract_runtime_render_payloads(
        {"stdout": [render_marker], "stderr": [], "result": []}
    )

    assert len(payloads) == 1
    assert payloads[0]["view_type"] == "table.simple"
    assert payloads[0]["payload"]["rows"][0]["name"] == "alice"


def test_strip_runtime_signal_lines():
    tool_marker = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER + "{}"
    render_marker = code_mode_protocol.RUNTIME_RENDER_BLOCK_MARKER + "{}"
    text = "\n".join(["hello", tool_marker, "world", render_marker, "done"])

    stripped = code_mode_protocol.strip_runtime_signal_lines(text)

    assert stripped == "\n".join(["hello", "world", "done"])
