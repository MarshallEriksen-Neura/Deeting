import logging
import uuid
from typing import List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_mcp_server import UserMcpServer
from app.services.mcp.client import mcp_client, MCPClientError
from app.services.secrets.manager import SecretManager
from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)

class MCPDiscoveryService:
    """
    Service to manage discovery and syncing of tools from User-configured MCP servers.
    """

    def __init__(self):
        self.secret_manager = SecretManager()

    async def sync_user_tools(self, session: AsyncSession, user_id: uuid.UUID) -> int:
        """
        Synchronizes tools for all enabled MCP servers belonging to a user.
        Returns the total number of tools discovered.
        """
        stmt = select(UserMcpServer).where(
            UserMcpServer.user_id == user_id,
            UserMcpServer.is_enabled == True,
            UserMcpServer.server_type == "sse",
        )
        result = await session.execute(stmt)
        servers = result.scalars().all()

        total_tools = 0
        for server in servers:
            try:
                if not server.sse_url:
                    continue
                # 1. Get Auth Headers
                headers = await self._get_auth_headers(session, server)
                
                # 2. Fetch Tools from Remote
                tools = await mcp_client.fetch_tools(server.sse_url, headers=headers)
                
                # 3. Update Cache in DB
                tools_data = [t.model_dump() for t in tools]
                server.tools_cache = tools_data
                total_tools += len(tools)
                
                logger.info(f"Synced {len(tools)} tools from MCP server '{server.name}' for user {user_id}")
            
            except MCPClientError as e:
                logger.error(f"Failed to sync MCP server '{server.name}': {e}")
                # We keep the old cache if sync fails, or we could mark it as error
            except Exception as e:
                logger.exception(f"Unexpected error syncing MCP server '{server.name}': {e}")

        await session.commit()
        return total_tools

    async def get_active_tools(self, session: AsyncSession, user_id: uuid.UUID) -> List[ToolDefinition]:
        """
        Retrieves all currently active tools for a user from their MCP servers.
        Uses the tools_cache for performance.
        """
        stmt = select(UserMcpServer.tools_cache, UserMcpServer.disabled_tools).where(
            UserMcpServer.user_id == user_id,
            UserMcpServer.is_enabled == True,
            UserMcpServer.server_type == "sse",
        )
        result = await session.execute(stmt)
        all_rows = result.all()
        
        tools = []
        for cache, disabled_tools in all_rows:
            disabled = set(disabled_tools or [])
            for t_data in cache or []:
                if t_data.get("name") in disabled:
                    continue
                tools.append(ToolDefinition(**t_data))
        
        return tools

    async def _get_auth_headers(self, session: AsyncSession, server: UserMcpServer) -> dict:
        """
        Helper to resolve credentials from SecretManager.
        """
        if not server.secret_ref_id or server.auth_type == "none":
            return {}

        # The SecretManager usually needs a 'provider' name. 
        # For user MCPs, we can use a generic name or the server ID.
        provider_name = f"mcp_custom_{server.id}"
        secret = await self.secret_manager.get(provider_name, server.secret_ref_id, session)
        
        if not secret:
            return {}

        if server.auth_type == "api_key":
            return {"x-api-key": secret}
        elif server.auth_type == "bearer":
            return {"Authorization": f"Bearer {secret}"}
        
        return {}

mcp_discovery_service = MCPDiscoveryService()
