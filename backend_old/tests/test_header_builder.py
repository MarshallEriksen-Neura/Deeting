from __future__ import annotations

from app.api.v1.chat.header_builder import build_upstream_headers
from app.schemas import ProviderConfig


def test_build_upstream_headers_openai_non_stream_default_auth():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        custom_headers=None,
    )
    headers = build_upstream_headers("k", cfg, call_style="openai", is_stream=False)
    assert headers["Accept"] == "application/json"
    assert headers["Content-Type"] == "application/json"
    assert headers["Authorization"] == "Bearer k"
    assert "x-api-key" not in {k.lower() for k in headers.keys()}


def test_build_upstream_headers_claude_stream_has_anthropic_version():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        custom_headers=None,
    )
    headers = build_upstream_headers("k", cfg, call_style="claude", is_stream=True)
    assert headers["Accept"] == "text/event-stream"
    assert headers["Anthropic-Version"] == "2023-06-01"
    assert headers["x-api-key"] == "k"


def test_build_upstream_headers_respects_custom_auth_header():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        custom_headers={"api-key": "custom"},
    )
    headers = build_upstream_headers("k", cfg, call_style="openai", is_stream=False)
    # should not inject Authorization when custom auth is present
    lowered = {k.lower(): v for k, v in headers.items()}
    assert "authorization" not in lowered
    assert lowered["api-key"] == "custom"

