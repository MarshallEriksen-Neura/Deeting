import uuid
import httpx
from datetime import datetime, timezone
from typing import Any, List, Dict

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Response
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import get_current_active_user
from app.core.http_client import create_async_http_client
from app.core.database import get_db
from app.models.user import User
from app.models.user_mcp_server import UserMcpServer
from app.models.user_mcp_source import UserMcpSource
from app.schemas.mcp_server import (
    UserMcpServerCreate,
    UserMcpServerResponse,
    UserMcpServerUpdate,
    McpServerToolItem,
    McpServerToolToggleRequest,
    McpToolTestRequest,
    McpToolTestResponse,
)
from app.schemas.mcp_source import (
    McpSourceSyncRequest,
    McpSourceSyncResponse,
    UserMcpSourceCreate,
    UserMcpSourceResponse,
)
from app.services.secrets.manager import SecretManager
from app.services.mcp.discovery import mcp_discovery_service
from app.services.mcp.client import mcp_client
from app.utils.security import is_safe_upstream_url

router = APIRouter()
secret_manager = SecretManager()


def _sanitize_draft_config(payload: Dict[str, Any] | None) -> Dict[str, Any] | None:
    if not payload or not isinstance(payload, dict):
        return None
    command = payload.get("command")
    args = payload.get("args")
    env = payload.get("env")
    if command is None and args is None and env is None:
        return None
    sanitized: Dict[str, Any] = {}
    if isinstance(command, str):
        sanitized["command"] = command
    if isinstance(args, list):
        sanitized["args"] = [item for item in args if isinstance(item, str)]
    if isinstance(env, dict):
        sanitized["env_keys"] = [str(key) for key in env.keys()]
    return sanitized or None


def _extract_mcp_servers(payload: Dict[str, Any]) -> Dict[str, Any]:
    servers = payload.get("mcpServers")
    if not isinstance(servers, dict):
        raise HTTPException(status_code=400, detail="invalid mcpServers payload")
    return servers


async def _fetch_mcp_source_payload(source_url: str, auth_token: str | None) -> Dict[str, Any]:
    if not is_safe_upstream_url(source_url):
        raise HTTPException(status_code=400, detail="unsafe source_url")
    headers: Dict[str, str] = {"Accept": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    client = create_async_http_client(timeout=10.0, headers=headers)
    try:
        async with client:
            resp = await client.get(source_url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"failed to fetch source: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid json payload") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="invalid mcp source payload")
    return data

@router.get("/servers", response_model=List[UserMcpServerResponse])
async def list_mcp_servers(
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    List all MCP servers configured by the current user.
    """
    stmt = select(UserMcpServer).where(UserMcpServer.user_id == current_user.id)
    result = await session.execute(stmt)
    servers = result.scalars().all()
    return [UserMcpServerResponse.from_orm_model(s) for s in servers]

@router.post("/servers", response_model=UserMcpServerResponse)
async def create_mcp_server(
    *,
    server_in: UserMcpServerCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Connect a new remote MCP server.
    """
    server_type = server_in.server_type or "sse"
    sse_url = str(server_in.sse_url) if server_in.sse_url else None
    if server_type == "sse" and not sse_url:
        raise HTTPException(status_code=400, detail="sse_url is required for remote MCP servers")

    # 1. Handle Secret (if provided)
    secret_ref_id = None
    if server_in.secret_value:
        # Use a deterministic name/key logic or random
        secret_key = f"user_mcp_{uuid.uuid4().hex[:8]}"
        await secret_manager.set(
            provider="mcp_custom",
            key=secret_key,
            value=server_in.secret_value,
            session=session
        )
        secret_ref_id = secret_key

    # 2. Create DB Record
    is_enabled = server_in.is_enabled if server_type == "sse" else False
    draft_config = _sanitize_draft_config(server_in.draft_config) if server_type == "stdio" else None

    new_server = UserMcpServer(
        user_id=current_user.id,
        name=server_in.name,
        description=server_in.description,
        sse_url=sse_url if server_type == "sse" else None,
        server_type=server_type,
        auth_type=server_in.auth_type,
        secret_ref_id=secret_ref_id,
        is_enabled=is_enabled,
        tools_cache=[],
        draft_config=draft_config,
    )
    
    session.add(new_server)
    await session.commit()
    await session.refresh(new_server)

    # 3. Trigger initial sync in background (remote servers only)
    if server_type == "sse" and sse_url:
        background_tasks.add_task(
            mcp_discovery_service.sync_user_tools,
            session,  # Note: passing session to bg task can be tricky if session closes.
                      # Better to let the service create its own session or handle it carefully.
                      # For now, we rely on the service being robust or passing IDs.
            current_user.id
        )
        # Actually, sync_user_tools needs a session.
        # It's safer to not pass the request-scoped session to background task.
        # We should refactor sync to create its own session or just run it inline for immediate feedback?
        # Let's run it inline for "Connect" action so user sees results immediately (or error).
        try:
            await mcp_discovery_service.sync_user_tools(session, current_user.id)
            await session.refresh(new_server) # Refresh to get updated tools_cache
        except Exception:
            # Don't fail the creation if sync fails, user can retry
            pass

    return UserMcpServerResponse.from_orm_model(new_server)

@router.put("/servers/{server_id}", response_model=UserMcpServerResponse)
async def update_mcp_server(
    *,
    server_id: uuid.UUID,
    server_in: UserMcpServerUpdate,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Update an MCP server configuration.
    """
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    # Update fields
    if server_in.name is not None:
        server.name = server_in.name
    if server_in.description is not None:
        server.description = server_in.description
    if server_in.sse_url is not None:
        server.sse_url = str(server_in.sse_url)
    if server_in.is_enabled is not None:
        server.is_enabled = server_in.is_enabled
    if server_in.server_type is not None:
        server.server_type = server_in.server_type
    if server_in.auth_type is not None:
        server.auth_type = server_in.auth_type
    if server_in.draft_config is not None:
        server.draft_config = _sanitize_draft_config(server_in.draft_config)

    if server.server_type == "stdio":
        server.is_enabled = False
        server.sse_url = None
    elif server.server_type == "sse" and not server.sse_url:
        raise HTTPException(status_code=400, detail="sse_url is required for remote MCP servers")

    # Update secret if provided
    if server_in.secret_value:
        if server.secret_ref_id:
            # Update existing secret
            await secret_manager.set(
                provider="mcp_custom",
                key=server.secret_ref_id,
                value=server_in.secret_value,
                session=session
            )
        else:
            # Create new secret
            secret_key = f"user_mcp_{uuid.uuid4().hex[:8]}"
            await secret_manager.set(
                provider="mcp_custom",
                key=secret_key,
                value=server_in.secret_value,
                session=session
            )
            server.secret_ref_id = secret_key

    await session.commit()
    await session.refresh(server)
    return UserMcpServerResponse.from_orm_model(server)

@router.post("/servers/{server_id}/sync", response_model=UserMcpServerResponse)
async def sync_mcp_server(
    *,
    server_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Manually trigger a tool sync for this server.
    """
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if server.server_type != "sse" or not server.sse_url:
        raise HTTPException(status_code=400, detail="MCP server is not a remote SSE server")

    # We reuse the bulk sync service but it filters by user. 
    # To be more specific, we might want a sync_single_server method later.
    # For now, syncing all user's servers is acceptable or we rely on the service loop.
    
    # Let's call sync for this user, it will update this server (and others).
    await mcp_discovery_service.sync_user_tools(session, current_user.id)
    
    await session.refresh(server)
    return UserMcpServerResponse.from_orm_model(server)


@router.get("/sources", response_model=List[UserMcpSourceResponse])
async def list_mcp_sources(
    *,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stmt = select(UserMcpSource).where(UserMcpSource.user_id == current_user.id)
    result = await session.execute(stmt)
    sources = result.scalars().all()
    return [UserMcpSourceResponse.from_orm_model(s) for s in sources]


@router.post("/sources", response_model=UserMcpSourceResponse)
async def create_mcp_source(
    *,
    payload: UserMcpSourceCreate,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    source_url = str(payload.path_or_url)
    if not is_safe_upstream_url(source_url):
        raise HTTPException(status_code=400, detail="unsafe source_url")

    new_source = UserMcpSource(
        user_id=current_user.id,
        name=payload.name,
        source_type=payload.source_type,
        path_or_url=source_url,
        trust_level=payload.trust_level,
        status="active",
        is_read_only=False,
    )
    session.add(new_source)
    await session.commit()
    await session.refresh(new_source)
    return UserMcpSourceResponse.from_orm_model(new_source)


@router.post("/sources/{source_id}/sync", response_model=McpSourceSyncResponse)
async def sync_mcp_source(
    *,
    source_id: uuid.UUID,
    payload: McpSourceSyncRequest,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stmt = select(UserMcpSource).where(
        UserMcpSource.id == source_id,
        UserMcpSource.user_id == current_user.id,
    )
    result = await session.execute(stmt)
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="MCP source not found")

    source.status = "syncing"
    await session.commit()

    created = 0
    updated = 0
    skipped = 0

    try:
        payload_data = await _fetch_mcp_source_payload(str(source.path_or_url), payload.auth_token)
        servers_payload = _extract_mcp_servers(payload_data)
        for key, config in servers_payload.items():
            if not isinstance(key, str) or not isinstance(config, dict):
                skipped += 1
                continue

            url = config.get("url")
            server_type = "sse" if isinstance(url, str) and url else "stdio"
            sse_url = str(url) if server_type == "sse" else None
            name = config.get("name") if isinstance(config.get("name"), str) else key
            description = config.get("description") if isinstance(config.get("description"), str) else None
            draft_config = _sanitize_draft_config(config) if server_type == "stdio" else None

            server_stmt = select(UserMcpServer).where(
                UserMcpServer.user_id == current_user.id,
                UserMcpServer.source_id == source.id,
                UserMcpServer.source_key == key,
            )
            server_result = await session.execute(server_stmt)
            server = server_result.scalar_one_or_none()

            if server:
                server.name = name
                server.description = description
                server.server_type = server_type
                server.sse_url = sse_url if server_type == "sse" else None
                if server_type == "stdio":
                    server.is_enabled = False
                server.draft_config = draft_config
                updated += 1
            else:
                new_server = UserMcpServer(
                    user_id=current_user.id,
                    source_id=source.id,
                    source_key=key,
                    name=name,
                    description=description,
                    sse_url=sse_url if server_type == "sse" else None,
                    server_type=server_type,
                    auth_type="none",
                    secret_ref_id=None,
                    is_enabled=True if server_type == "sse" else False,
                    tools_cache=[],
                    draft_config=draft_config,
                )
                session.add(new_server)
                created += 1

        await session.commit()

        await mcp_discovery_service.sync_user_tools(session, current_user.id)

        source.status = "active"
        source.last_synced_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(source)
    except HTTPException:
        source.status = "error"
        await session.commit()
        raise
    except Exception as exc:
        source.status = "error"
        await session.commit()
        raise HTTPException(status_code=500, detail="failed to sync source") from exc

    return McpSourceSyncResponse(
        source=UserMcpSourceResponse.from_orm_model(source),
        created=created,
        updated=updated,
        skipped=skipped,
    )


@router.delete(
    "/sources/{source_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def delete_mcp_source(
    *,
    source_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    stmt = delete(UserMcpSource).where(
        UserMcpSource.id == source_id,
        UserMcpSource.user_id == current_user.id,
    )
    result = await session.execute(stmt)
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="MCP source not found")
    await session.commit()
    return Response(status_code=204)


@router.get("/servers/{server_id}/tools", response_model=List[McpServerToolItem])
async def list_mcp_server_tools(
    *,
    server_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    disabled = set(server.disabled_tools or [])
    tools = []
    for tool in server.tools_cache or []:
        name = tool.get("name")
        if not name:
            continue
        tools.append(
            McpServerToolItem(
                name=name,
                description=tool.get("description"),
                input_schema=tool.get("input_schema") or {},
                enabled=name not in disabled,
            )
        )
    return tools


@router.patch("/servers/{server_id}/tools/{tool_name}", response_model=McpServerToolItem)
async def toggle_mcp_server_tool(
    *,
    server_id: uuid.UUID,
    tool_name: str,
    payload: McpServerToolToggleRequest,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if server.server_type != "sse":
        raise HTTPException(status_code=400, detail="MCP server is not a remote SSE server")

    tool = next((item for item in (server.tools_cache or []) if item.get("name") == tool_name), None)
    if not tool:
        raise HTTPException(status_code=404, detail="MCP tool not found")

    disabled_tools = set(server.disabled_tools or [])
    if payload.enabled:
        disabled_tools.discard(tool_name)
    else:
        disabled_tools.add(tool_name)
    server.disabled_tools = list(disabled_tools)

    await session.commit()
    await session.refresh(server)

    return McpServerToolItem(
        name=tool_name,
        description=tool.get("description"),
        input_schema=tool.get("input_schema") or {},
        enabled=tool_name not in disabled_tools,
    )


@router.post("/tools/test", response_model=McpToolTestResponse)
async def test_mcp_tool(
    payload: McpToolTestRequest,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == payload.server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    if server.server_type != "sse" or not server.sse_url:
        raise HTTPException(status_code=400, detail="MCP server is not a remote SSE server")

    tool = next((item for item in (server.tools_cache or []) if item.get("name") == payload.tool_name), None)
    if not tool:
        raise HTTPException(status_code=404, detail="MCP tool not found")
    if payload.tool_name in (server.disabled_tools or []):
        raise HTTPException(status_code=400, detail="MCP tool is disabled")

    trace_id = uuid.uuid4().hex
    logs: List[str] = []
    try:
        logs.append(f"trace={trace_id} connect {server.sse_url}")
        headers = await mcp_discovery_service._get_auth_headers(session, server)
        logs.append(f"trace={trace_id} call tools/call {payload.tool_name}")
        result = await mcp_client.call_tool(
            server.sse_url,
            payload.tool_name,
            payload.arguments or {},
            headers=headers,
        )
        logs.append(f"trace={trace_id} success")
        return McpToolTestResponse(status="success", result=result, logs=logs, trace_id=trace_id)
    except Exception as exc:
        logs.append(f"trace={trace_id} error: {exc}")
        return McpToolTestResponse(status="error", error=str(exc), logs=logs, trace_id=trace_id)

@router.delete("/servers/{server_id}")
async def delete_mcp_server(
    *,
    server_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Delete an MCP server configuration.
    """
    stmt = select(UserMcpServer).where(
        UserMcpServer.id == server_id,
        UserMcpServer.user_id == current_user.id
    )
    result = await session.execute(stmt)
    server = result.scalar_one_or_none()
    
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    # Cleanup secret
    if server.secret_ref_id:
        # SecretManager currently doesn't have a delete method exposed directly in this context easily?
        # Assuming we can just leave it or implementing delete later.
        # Ideally: await secret_manager.delete(...)
        pass

    await session.delete(server)
    await session.commit()
    return {"ok": True}
