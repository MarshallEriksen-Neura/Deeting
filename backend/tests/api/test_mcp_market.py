from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models.mcp_market import McpMarketTool, McpToolCategory


async def _seed_market_tool(session) -> McpMarketTool:
    identifier = f"mcp/brave-search-{uuid4().hex[:8]}"
    tool = McpMarketTool(
        id=uuid4(),
        identifier=identifier,
        name="Brave Search",
        description="Brave Search MCP tool",
        avatar_url=None,
        category=McpToolCategory.SEARCH,
        tags=["search", "web"],
        author="Deeting Official",
        is_official=True,
        download_count=0,
        install_manifest={
            "runtime": "node",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-brave-search"],
            "env_config": [
                {
                    "key": "BRAVE_API_KEY",
                    "label": "Brave API Key",
                    "required": True,
                    "secret": True,
                    "description": "Get it from https://api.search.brave.com/app/keys",
                }
            ],
        },
    )
    session.add(tool)
    await session.commit()
    await session.refresh(tool)
    return tool


@pytest.mark.asyncio
async def test_list_market_tools(client: AsyncClient, auth_tokens: dict, AsyncSessionLocal) -> None:
    async with AsyncSessionLocal() as session:
        tool = await _seed_market_tool(session)

    resp = await client.get(
        "/api/v1/mcp/market-tools",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["identifier"] == tool.identifier


@pytest.mark.asyncio
async def test_subscribe_and_unsubscribe(client: AsyncClient, auth_tokens: dict, AsyncSessionLocal) -> None:
    async with AsyncSessionLocal() as session:
        tool = await _seed_market_tool(session)

    payload = {"tool_id": str(tool.id)}
    resp = await client.post(
        "/api/v1/mcp/subscriptions",
        json=payload,
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["market_tool_id"] == str(tool.id)
    assert body["config_hash_snapshot"]

    resp_repeat = await client.post(
        "/api/v1/mcp/subscriptions",
        json=payload,
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp_repeat.status_code == 200

    list_resp = await client.get(
        "/api/v1/mcp/subscriptions",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert len(list_data) == 1

    del_resp = await client.delete(
        f"/api/v1/mcp/subscriptions/{tool.id}",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert del_resp.status_code == 200

    list_resp = await client.get(
        "/api/v1/mcp/subscriptions",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []
