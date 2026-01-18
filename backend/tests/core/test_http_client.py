import pytest

from app.core import http_client as hc


class DummyAsyncClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def aclose(self) -> None:
        return None


@pytest.mark.asyncio
async def test_create_async_http_client_maps_proxies_to_proxy(monkeypatch):
    captured: dict[str, object] = {}

    class CapturingClient(DummyAsyncClient):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            captured.update(kwargs)

    monkeypatch.setattr(hc, "_proxy_kwarg_supported", True)
    monkeypatch.setattr(hc, "_proxies_kwarg_supported", False)
    monkeypatch.setattr(hc, "_proxy_kwarg_logged", False)
    monkeypatch.setattr(hc, "_build_curl_transport", lambda **_: None)
    monkeypatch.setattr(hc.httpx, "AsyncClient", CapturingClient)

    client = hc.create_async_http_client(proxies={"http": "http://example.com"})
    await client.aclose()

    assert "proxy" in captured
    assert "proxies" not in captured


@pytest.mark.asyncio
async def test_create_async_http_client_keeps_proxies_when_supported(monkeypatch):
    captured: dict[str, object] = {}

    class CapturingClient(DummyAsyncClient):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            captured.update(kwargs)

    monkeypatch.setattr(hc, "_proxy_kwarg_supported", False)
    monkeypatch.setattr(hc, "_proxies_kwarg_supported", True)
    monkeypatch.setattr(hc, "_proxy_kwarg_logged", False)
    monkeypatch.setattr(hc, "_build_curl_transport", lambda **_: None)
    monkeypatch.setattr(hc.httpx, "AsyncClient", CapturingClient)

    client = hc.create_async_http_client(proxies={"http": "http://example.com"})
    await client.aclose()

    assert "proxies" in captured
    assert "proxy" not in captured
