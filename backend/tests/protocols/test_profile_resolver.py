from types import SimpleNamespace

from app.protocols.runtime.profile_resolver import build_protocol_profile_from_preset


def test_build_protocol_profile_from_preset_prefers_stored_protocol_profile():
    preset = SimpleNamespace(
        protocol_profiles={
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "openai:chat:openai_responses",
                "provider": "openai",
                "protocol_family": "openai_responses",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "responses",
                    "query_template": {},
                    "header_template": {},
                },
                "request": {
                    "template_engine": "openai_compat",
                    "request_template": {"model": None, "input": None},
                    "request_builder": {
                        "name": "responses_input_from_items",
                        "config": {},
                    },
                },
                "response": {
                    "decoder": {"name": "openai_responses", "config": {}},
                    "response_template": {},
                },
                "stream": {
                    "stream_decoder": {
                        "name": "openai_responses_stream",
                        "config": {},
                    }
                },
                "auth": {"auth_policy": "inherit", "config": {}},
                "features": {
                    "supports_messages": False,
                    "supports_input_items": True,
                    "supports_tools": True,
                    "supports_reasoning": True,
                    "supports_json_mode": True,
                },
                "defaults": {"headers": {}, "query": {}, "body": {}},
                "metadata": {},
            }
        }
    )

    profile = build_protocol_profile_from_preset(
        preset=preset,
        provider="openai",
        capability="chat",
        protocol="openai",
        upstream_path="responses",
        http_method="POST",
        template_engine="simple_replace",
        request_template={"messages": None},
        response_transform={},
        request_builder={},
        default_headers={"X-Test": "1"},
        default_params={"temperature": 0.2},
    )

    assert profile.protocol_family == "openai_responses"
    assert profile.request.request_template["input"] is None
    assert profile.transport.path == "responses"
    assert profile.defaults.headers["X-Test"] == "1"
    assert profile.defaults.body["temperature"] == 0.2
