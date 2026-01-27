from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models.user_mcp_server import UserMcpServer


@pytest.mark.asyncio
async def test_create_stdio_server_draft(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
) -> None:
    payload = {
        "name": "Draft MCP",
        "description": "local draft import",
        "server_type": "stdio",
        "draft_config": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem"],
            "env": {"TOKEN": "secret", "PATH": "/tmp"},
        },
    }

    resp = await client.post(
        "/api/v1/mcp/servers",
        json=payload,
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["server_type"] == "stdio"
    assert data["is_enabled"] is False
    assert data["status"] == "draft"
    assert data.get("sse_url") in (None, "")

    async with AsyncSessionLocal() as session:
        server = await session.get(UserMcpServer, UUID(data["id"]))
        assert server is not None
        assert server.server_type == "stdio"
        assert server.is_enabled is False
        assert server.draft_config is not None
        assert server.draft_config.get("command") == "npx"
        assert server.draft_config.get("args") == ["-y", "@modelcontextprotocol/server-filesystem"]
        assert server.draft_config.get("env_keys") == ["TOKEN", "PATH"]


@pytest.mark.asyncio
async def test_list_and_toggle_server_tools(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    test_user: dict,
) -> None:
    async with AsyncSessionLocal() as session:
        user_id = UUID(test_user["id"])
        server = UserMcpServer(
            user_id=user_id,
            name="Remote MCP",
            description="remote",
            sse_url="https://example.com/mcp/sse",
            server_type="sse",
            auth_type="none",
            is_enabled=True,
            tools_cache=[
                {
                    "name": "search",
                    "description": "Search tool",
                    "input_schema": {"type": "object"},
                }
            ],
            disabled_tools=[],
        )
        session.add(server)
        await session.commit()
        await session.refresh(server)

    resp = await client.get(
        f"/api/v1/mcp/servers/{server.id}/tools",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["name"] == "search"
    assert data[0]["enabled"] is True

    toggle_resp = await client.patch(
        f"/api/v1/mcp/servers/{server.id}/tools/search",
        json={"enabled": False},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert toggle_resp.status_code == 200
    toggled = toggle_resp.json()
    assert toggled["enabled"] is False

    refresh = await client.get(
        f"/api/v1/mcp/servers/{server.id}/tools",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert refresh.status_code == 200
    refreshed = refresh.json()
    assert refreshed[0]["enabled"] is False


@pytest.mark.asyncio
async def test_tool_test_endpoint(
    client: AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
    test_user: dict,
) -> None:
    async with AsyncSessionLocal() as session:
        user_id = UUID(test_user["id"])
        server = UserMcpServer(
            user_id=user_id,
            name="Remote MCP",
            description="remote",
            sse_url="https://example.com/mcp/sse",
            server_type="sse",
            auth_type="none",
            is_enabled=True,
            tools_cache=[
                {
                    "name": "echo",
                    "description": "Echo tool",
                    "input_schema": {"type": "object"},
                }
            ],
            disabled_tools=[],
        )
        session.add(server)
        await session.commit()
        await session.refresh(server)

    from app.api.v1.endpoints import mcp as mcp_route

    monkeypatch.setattr(
        mcp_route.mcp_client,
        "call_tool",
        AsyncMock(return_value={"ok": True}),
    )

    resp = await client.post(
        "/api/v1/mcp/tools/test",
        json={"server_id": str(server.id), "tool_name": "echo", "arguments": {"text": "hi"}},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["result"] == {"ok": True}
    assert data["trace_id"]
    assert data["logs"]
