from app.protocols.canonical import CanonicalRequest
from app.protocols.contracts import ProtocolProfile, RuntimeHook
from app.protocols.runtime import protocol_runtime_service


def test_runtime_service_builds_upstream_request_from_profile():
    profile = ProtocolProfile(
        profile_id="openai-chat",
        provider="openai",
        protocol_family="openai_chat",
        capability="chat",
        transport={
            "path": "chat/completions",
            "header_template": {"X-Request-Id": None},
            "query_template": {"trace_id": None},
        },
        request={"request_template": {"model": None, "stream": None, "messages": None}},
        response={"decoder": RuntimeHook(name="openai_chat")},
    )
    request = CanonicalRequest(
        model="gpt-5.3-codex",
        messages=[{"role": "user", "content": "hello"}],
        stream=True,
        client_context={"request_id": "req-1", "trace_id": "trace-1"},
    )

    upstream = protocol_runtime_service.build_upstream_request(
        request,
        profile,
        base_url="https://api.openai.com/v1",
    )

    assert upstream.method == "POST"
    assert upstream.url == "https://api.openai.com/v1/chat/completions"
    assert upstream.body["model"] == "gpt-5.3-codex"
    assert upstream.body["stream"] is True
    assert upstream.headers["X-Request-Id"] == "req-1"
    assert upstream.query["trace_id"] == "trace-1"


def test_runtime_service_supports_jinja_rendering_for_transport_and_body():
    profile = ProtocolProfile(
        profile_id="openai-responses",
        provider="openai",
        protocol_family="openai_responses",
        capability="chat",
        transport={
            "path": "responses",
            "header_template": {"X-Trace-Id": "{{ client_context.trace_id }}"},
            "query_template": {"api-version": "{{ metadata.api_version }}"},
        },
        request={
            "template_engine": "jinja2",
            "request_template": {
                "model": "{{ request.model }}",
                "input": "{{ input.input_items[0].text }}",
            },
        },
        response={"decoder": RuntimeHook(name="openai_responses")},
    )
    request = CanonicalRequest(
        model="gpt-5.3-codex",
        input_items=[{"type": "input_text", "text": "hello"}],
        metadata={"api_version": "2026-03-01"},
        client_context={"trace_id": "trace-1"},
    )

    upstream = protocol_runtime_service.build_upstream_request(
        request,
        profile,
        base_url="https://api.openai.com/v1",
    )

    assert upstream.body == {"model": "gpt-5.3-codex", "input": "hello"}
    assert upstream.headers["X-Trace-Id"] == "trace-1"
    assert upstream.query["api-version"] == "2026-03-01"


def test_runtime_service_runs_request_builder_after_render():
    profile = ProtocolProfile(
        profile_id="custom-openai-chat",
        provider="custom",
        protocol_family="openai_chat",
        capability="chat",
        transport={"path": "v1/chat/completions"},
        request={
            "request_template": {"model": None, "messages": None},
            "request_builder": RuntimeHook(
                name="inject_literal_fields",
                config={"fields": {"store": False}},
            ),
        },
        response={"decoder": RuntimeHook(name="openai_chat")},
    )
    request = CanonicalRequest(
        model="gpt-5.3-codex",
        messages=[{"role": "user", "content": "hello"}],
    )

    upstream = protocol_runtime_service.build_upstream_request(
        request,
        profile,
        base_url="https://example.com",
    )

    assert upstream.body["store"] is False
    assert upstream.body["messages"][0]["content"] == "hello"
