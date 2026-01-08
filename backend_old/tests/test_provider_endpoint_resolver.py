from __future__ import annotations

from app.api.v1.chat.provider_endpoint_resolver import resolve_http_upstream_target
from app.schemas import ProviderConfig


def test_resolver_prefers_messages_path_for_claude_request():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        messages_path="/v1/messages",
        chat_completions_path="/v1/chat/completions",
        supported_api_styles=["claude", "openai"],
    )
    target = resolve_http_upstream_target(
        cfg,
        requested_api_style="claude",
        default_url="https://proxy.example.com/v1/chat/completions",
        default_upstream_style="openai",
    )
    assert target.api_style == "claude"
    assert target.url.startswith("https://proxy.example.com/")
    assert "/v1/messages" in target.url


def test_resolver_applies_messages_path_override():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        messages_path="/v1/messages",
        supported_api_styles=["claude"],
    )
    target = resolve_http_upstream_target(
        cfg,
        requested_api_style="claude",
        default_url="https://proxy.example.com/v1/anything",
        default_upstream_style="claude",
        messages_path_override="/v1/custom-messages",
    )
    assert target.api_style == "claude"
    assert "/v1/custom-messages" in target.url


def test_resolver_falls_back_to_default_when_selection_missing():
    cfg = ProviderConfig(
        id="p1",
        name="P1",
        base_url="https://api.example.com",
        supported_api_styles=[],  # treated as empty declaration
    )
    target = resolve_http_upstream_target(
        cfg,
        requested_api_style="openai",
        default_url="https://proxy.example.com/v1/chat/completions",
        default_upstream_style="openai",
    )
    assert target.api_style == "openai"
    assert target.url == "https://proxy.example.com/v1/chat/completions"


def test_resolver_uses_chat_capability_when_present():
    cfg = ProviderConfig(
        id="cap_p1",
        name="CapP1",
        base_url="https://api.cap.com",
        metadata={
            "capabilities": {
                "chat": {
                    "endpoint": "/v1/cap/chat",
                    "adapter": "openai"
                }
            }
        }
    )
    target = resolve_http_upstream_target(
        cfg,
        requested_api_style="openai",
        default_url="https://default.com/v1/chat",
        default_upstream_style="openai"
    )
    assert target.api_style == "openai"
    assert target.url == "https://api.cap.com/v1/cap/chat"


def test_resolver_uses_chat_capability_claude_adapter():
    cfg = ProviderConfig(
        id="cap_p2",
        name="CapP2",
        base_url="https://api.cap.com",
        metadata={
            "capabilities": {
                "chat": {
                    "endpoint": "/v1/cap/messages",
                    "adapter": "claude_sdk"
                }
            }
        }
    )
    target = resolve_http_upstream_target(
        cfg,
        requested_api_style="openai",
        default_url="https://default.com/v1/chat",
        default_upstream_style="openai"
    )
    assert target.api_style == "claude"
    assert target.url == "https://api.cap.com/v1/cap/messages"

