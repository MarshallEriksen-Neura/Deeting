import httpx
import pytest

from app.core import config
from app.services.workflow.steps.upstream_call import UpstreamCallStep, UpstreamSecurityError
from app.utils.security import is_safe_upstream_url


def test_is_safe_upstream_url_allows_whitelist_even_when_custom_disabled(monkeypatch):
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["api.allowed.com"])
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", False)
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)

    assert is_safe_upstream_url("https://api.allowed.com/v1") is True


def test_is_safe_upstream_url_blocks_internal_ip(monkeypatch):
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", [])
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", True)
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["127.0.0.0/8"])

    assert is_safe_upstream_url("http://127.0.0.1:8000/test") is False


def test_is_safe_upstream_url_allows_public_ip(monkeypatch):
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", [])
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", True)
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["10.0.0.0/8"])

    assert is_safe_upstream_url("http://1.1.1.1") is True


@pytest.mark.asyncio
async def test_request_with_redirects_blocks_unsafe_location(monkeypatch):
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "http://127.0.0.1/evil"})

    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["start.example.com"])
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", True)
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)
    monkeypatch.setattr(config.settings, "BLOCKED_SUBNETS", ["127.0.0.0/8"])

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    step = UpstreamCallStep()

    with pytest.raises(UpstreamSecurityError):
        await step._request_with_redirects(
            client=client,
            method="POST",
            url="https://start.example.com/v1",
            body={},
            headers={},
            timeout=5,
        )
    await client.aclose()


@pytest.mark.asyncio
async def test_request_with_redirects_follows_safe_location(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "start.example.com":
            return httpx.Response(302, headers={"Location": "https://api.allowed.com/v1"})
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(
        config.settings,
        "OUTBOUND_WHITELIST",
        ["start.example.com", "api.allowed.com"],
    )
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", True)
    monkeypatch.setattr(config.settings, "ALLOW_INTERNAL_NETWORKS", False)

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    step = UpstreamCallStep()

    response = await step._request_with_redirects(
        client=client,
        method="POST",
        url="https://start.example.com/v1",
        body={"ping": "pong"},
        headers={},
        timeout=5,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    await response.aclose()
    await client.aclose()
