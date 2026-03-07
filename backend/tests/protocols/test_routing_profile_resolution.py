from app.protocols.runtime.profile_resolver import build_protocol_profile, infer_protocol_family


def test_infer_protocol_family_prefers_anthropic_and_responses_path():
    assert infer_protocol_family(protocol="anthropic", upstream_path="messages") == "anthropic_messages"
    assert infer_protocol_family(protocol="openai", upstream_path="responses") == "openai_responses"
    assert infer_protocol_family(protocol="openai", upstream_path="chat/completions") == "openai_chat"


def test_build_protocol_profile_projects_runtime_shape():
    profile = build_protocol_profile(
        provider="custom",
        capability="chat",
        protocol="openai",
        upstream_path="responses",
        http_method="post",
        template_engine="jinja2",
        request_template={"model": "{{ request.model }}", "input": "{{ request.input_items }}"},
        response_transform={"stream_transform": {"type": "responses"}},
        request_builder={"name": "inject_literal_fields", "config": {"fields": {"store": False}}},
        default_headers={"X-Test": "1"},
        default_params={"temperature": 0.1},
    )

    assert profile.protocol_family == "openai_responses"
    assert profile.transport.path == "responses"
    assert profile.request.template_engine == "jinja2"
    assert profile.request.request_builder.name == "inject_literal_fields"
    assert profile.response.response_template["stream_transform"]["type"] == "responses"
    assert profile.defaults.headers["X-Test"] == "1"
    assert profile.defaults.body["temperature"] == 0.1
