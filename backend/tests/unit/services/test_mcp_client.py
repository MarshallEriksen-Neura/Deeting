import httpx

from app.services.mcp import client as mcp_client_module


def test_mcp_httpx_client_factory_defaults_trust_env_disabled(monkeypatch):
    captured: dict[str, object] = {}

    class _FakeAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(mcp_client_module.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(mcp_client_module.settings, "MCP_HTTP_TRUST_ENV", False)

    client = mcp_client_module.MCPClient(timeout=60)
    client._httpx_client_factory(headers={"X-Test": "1"}, timeout=httpx.Timeout(10.0))

    assert captured["follow_redirects"] is True
    assert captured["trust_env"] is False
    assert isinstance(captured["timeout"], httpx.Timeout)
    assert captured["headers"] == {"X-Test": "1"}


def test_mcp_httpx_client_factory_respects_trust_env_setting(monkeypatch):
    captured: dict[str, object] = {}

    class _FakeAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(mcp_client_module.httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(mcp_client_module.settings, "MCP_HTTP_TRUST_ENV", True)

    client = mcp_client_module.MCPClient(timeout=60)
    client._httpx_client_factory(headers=None, timeout=None)

    assert captured["trust_env"] is True
    assert isinstance(captured["timeout"], httpx.Timeout)
