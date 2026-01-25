import httpx
import pytest
from sqlalchemy import select

from app.models.user_mcp_server import UserMcpServer
from app.models.user_mcp_source import UserMcpSource


@pytest.mark.asyncio
async def test_create_and_sync_source(
    client: httpx.AsyncClient,
    auth_tokens: dict,
    AsyncSessionLocal,
    monkeypatch,
    test_user: dict,
) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://example.com/mcp.json"
        payload = {
            "mcpServers": {
                "weather-server": {
                    "url": "https://mcp.example.com/sse",
                },
                "local-files": {
                    "command": "node",
                    "args": ["./server.js"],
                    "env": {"TOKEN": "secret"},
                },
            }
        }
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)

    def fake_client(**_kwargs):
        return httpx.AsyncClient(transport=transport)

    async def fake_sync(_session, _user_id):
        return 0

    monkeypatch.setattr("app.api.v1.endpoints.mcp.create_async_http_client", fake_client)
    monkeypatch.setattr("app.api.v1.endpoints.mcp.is_safe_upstream_url", lambda _url: True)
    monkeypatch.setattr("app.api.v1.endpoints.mcp.mcp_discovery_service.sync_user_tools", fake_sync)

    create_resp = await client.post(
        "/api/v1/mcp/sources",
        json={
            "name": "ModelScope",
            "source_type": "modelscope",
            "path_or_url": "https://example.com/mcp.json",
            "trust_level": "official",
        },
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert create_resp.status_code == 200
    source_id = create_resp.json()["id"]

    sync_resp = await client.post(
        f"/api/v1/mcp/sources/{source_id}/sync",
        json={},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert sync_resp.status_code == 200
    sync_data = sync_resp.json()
    assert sync_data["created"] == 2
    assert sync_data["source"]["status"] == "active"
    assert sync_data["source"]["last_synced_at"] is not None

    async with AsyncSessionLocal() as session:
        source = await session.get(UserMcpSource, source_id)
        assert source is not None
        stmt = select(UserMcpServer).where(UserMcpServer.source_id == source.id)
        result = await session.execute(stmt)
        servers = result.scalars().all()
        assert len(servers) == 2
        assert all(server.source_id == source.id for server in servers)
        stdio = next((s for s in servers if s.server_type == "stdio"), None)
        assert stdio is not None
        assert stdio.draft_config is not None
        assert stdio.draft_config.get("command") == "node"
        assert stdio.draft_config.get("args") == ["./server.js"]
        assert stdio.draft_config.get("env_keys") == ["TOKEN"]
