import asyncio
import json
from contextlib import asynccontextmanager

import pytest

from app.services.mcp.client import MCPClient


class FakePostResponse:
    def __init__(self, json_data, status_code: int = 200):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        if self._json_data is None:
            raise ValueError("no json payload")
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeStreamResponse:
    def __init__(self, lines, status_code: int = 200):
        self.status_code = status_code
        self._lines = lines

    async def aiter_lines(self):
        if hasattr(self._lines, "__aiter__"):
            async for line in self._lines:
                yield line
            return
        for line in self._lines:
            yield line


class FakeAsyncClient:
    def __init__(self, *, timeout=None, headers=None, state=None, is_stream=False, post_factory=None, sse_factory=None):
        self.timeout = timeout
        self.headers = headers
        self.state = state or {}
        self.is_stream = is_stream
        self._post_factory = post_factory
        self._sse_factory = sse_factory

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def aclose(self) -> None:
        return None

    def stream(self, method: str, url: str):
        if not self.is_stream:
            raise AssertionError("stream called on non-stream client")

        @asynccontextmanager
        async def _ctx():
            yield FakeStreamResponse(self._sse_factory())

        return _ctx()

    async def post(self, url: str, json: dict):
        if "id" in json:
            self.state["payload_id"] = json["id"]
        return FakePostResponse(self._post_factory(json))


def _install_fake_httpx(monkeypatch, state, post_factory, sse_factory):
    def _factory(**kwargs):
        timeout = kwargs.get("timeout")
        is_stream = getattr(timeout, "read", None) is None
        return FakeAsyncClient(
            timeout=timeout,
            headers=kwargs.get("headers"),
            state=state,
            is_stream=is_stream,
            post_factory=post_factory,
            sse_factory=sse_factory,
        )

    monkeypatch.setattr("app.services.mcp.client.httpx.AsyncClient", _factory)


@pytest.mark.asyncio
async def test_fetch_tools_returns_direct_post_tools(monkeypatch):
    state = {}

    def post_factory(_payload):
        return {
            "jsonrpc": "2.0",
            "id": _payload["id"],
            "result": {
                "tools": [
                    {"name": "search", "description": "desc", "inputSchema": {"type": "object"}}
                ]
            },
        }

    def sse_factory():
        return [
            "event: endpoint",
            "data: /messages/?session_id=abc",
        ]

    _install_fake_httpx(monkeypatch, state, post_factory, sse_factory)

    client = MCPClient(timeout=1, max_retries=1)
    tools = await client.fetch_tools("https://example.com/sse")

    assert len(tools) == 1
    assert tools[0].name == "search"


@pytest.mark.asyncio
async def test_fetch_tools_returns_sse_tools(monkeypatch):
    state = {"payload_id": None}

    def post_factory(_payload):
        return {}

    async def sse_lines():
        yield "event: endpoint"
        yield "data: /messages/?session_id=abc"
        for _ in range(10):
            if state.get("payload_id"):
                break
            await asyncio.sleep(0)
        payload_id = state.get("payload_id")
        data = {
            "jsonrpc": "2.0",
            "id": payload_id,
            "result": {
                "tools": [
                    {"name": "sse-tool", "description": "desc", "inputSchema": {"type": "object"}}
                ]
            },
        }
        yield f"data: {json.dumps(data)}"

    def sse_factory():
        return sse_lines()

    _install_fake_httpx(monkeypatch, state, post_factory, sse_factory)

    client = MCPClient(timeout=1, max_retries=1)
    tools = await client.fetch_tools("https://example.com/sse")

    assert len(tools) == 1
    assert tools[0].name == "sse-tool"
