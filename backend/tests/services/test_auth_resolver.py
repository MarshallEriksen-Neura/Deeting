from app.services.providers.auth_resolver import resolve_auth_for_protocol


def test_resolve_auth_for_custom_openai_protocol():
    auth_type, auth_config, headers = resolve_auth_for_protocol(
        protocol="openai",
        provider="custom",
        auth_type="none",
        auth_config={},
        default_headers={"Content-Type": "application/json"},
    )

    assert auth_type == "bearer"
    assert auth_config == {}
    assert headers["Content-Type"] == "application/json"
    assert "anthropic-version" not in headers


def test_resolve_auth_for_custom_anthropic_protocol():
    auth_type, auth_config, headers = resolve_auth_for_protocol(
        protocol="anthropic",
        provider="custom",
        auth_type="none",
        auth_config={},
        default_headers={"Content-Type": "application/json"},
    )

    assert auth_type == "api_key"
    assert auth_config["header"] == "x-api-key"
    assert headers["Content-Type"] == "application/json"
    assert headers["anthropic-version"] == "2023-06-01"


def test_resolve_auth_does_not_override_non_custom_provider():
    auth_type, auth_config, headers = resolve_auth_for_protocol(
        protocol="anthropic",
        provider="anthropic",
        auth_type="api_key",
        auth_config={"header": "x-api-key"},
        default_headers={"anthropic-version": "2023-06-01"},
    )

    assert auth_type == "api_key"
    assert auth_config["header"] == "x-api-key"
    assert headers["anthropic-version"] == "2023-06-01"
