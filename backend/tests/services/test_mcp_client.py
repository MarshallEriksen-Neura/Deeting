from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app.services.mcp.client import MCPClient


def _install_fake_sdk(monkeypatch, tools):
    @asynccontextmanager
    async def fake_sse_client(*_args, **_kwargs):
        yield object(), object()

    class FakeSession:
        def __init__(self, _read, _write):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def initialize(self):
            return None

        async def list_tools(self):
            items = [
                SimpleNamespace(
                    name=tool["name"],
                    description=tool.get("description"),
                    inputSchema=tool.get("inputSchema"),
                )
                for tool in tools
            ]
            return SimpleNamespace(tools=items)

    monkeypatch.setattr("app.services.mcp.client.sse_client", fake_sse_client)
    monkeypatch.setattr("app.services.mcp.client.ClientSession", FakeSession)


@pytest.mark.asyncio
async def test_fetch_tools_returns_direct_post_tools(monkeypatch):
    _install_fake_sdk(
        monkeypatch,
        [
            {"name": "search", "description": "desc", "inputSchema": {"type": "object"}},
        ],
    )

    client = MCPClient(timeout=1, max_retries=1)
    tools = await client.fetch_tools("https://example.com/sse")

    assert len(tools) == 1
    assert tools[0].name == "search"


@pytest.mark.asyncio
async def test_fetch_tools_returns_sse_tools(monkeypatch):
    _install_fake_sdk(
        monkeypatch,
        [
            {"name": "sse-tool", "description": "desc", "inputSchema": {"type": "object"}},
        ],
    )

    client = MCPClient(timeout=1, max_retries=1)
    tools = await client.fetch_tools("https://example.com/sse")

    assert len(tools) == 1
    assert tools[0].name == "sse-tool"
