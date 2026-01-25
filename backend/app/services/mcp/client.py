import logging
import asyncio
from typing import Any, Dict, List, Optional

from mcp import ClientSession
from mcp.client.sse import sse_client
from app.schemas.tool import ToolDefinition

logger = logging.getLogger(__name__)

class MCPClientError(Exception):
    """Base exception for MCP Client operations."""
    pass

class MCPClient:
    """
    A lightweight MCP client wrapper using the official mcp Python SDK.
    """

    def __init__(
        self,
        timeout: float = 60.0,
        max_retries: int = 3,
        retry_backoff_base: float = 1.0,
        retry_backoff_max: float = 8.0,
    ):
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff_base = retry_backoff_base
        self.retry_backoff_max = retry_backoff_max

    async def fetch_tools(self, sse_url: str, headers: Optional[Dict[str, str]] = None) -> List[ToolDefinition]:
        """
        Discovers tools from a remote MCP server using official SDK.
        """
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return await self._fetch_tools_once(sse_url, headers=headers)
            except Exception as e:
                last_error = e
                if attempt >= self.max_retries - 1:
                    break
                delay = min(self.retry_backoff_max, self.retry_backoff_base * (2 ** attempt))
                logger.warning(
                    "MCP fetch_tools retry %s/%s after error: %s",
                    attempt + 1,
                    self.max_retries,
                    e,
                )
                await asyncio.sleep(delay)
        
        if last_error:
            logger.exception("MCP fetch_tools final failure")
            raise MCPClientError(f"Failed to fetch tools: {last_error}") from last_error
        raise MCPClientError("Failed to fetch tools: unknown error")

    async def _fetch_tools_once(self, sse_url: str, headers: Optional[Dict[str, str]] = None) -> List[ToolDefinition]:
        try:
            # Note: sse_client context manager yields (read_stream, write_stream)
            # We assume sse_client handles headers if supported, otherwise we might need to modify it or accept defaults.
            # Currently mcp 1.25.0 sse_client accepts headers.
            async with sse_client(sse_url, headers=headers, timeout=self.timeout) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    
                    # List tools
                    result = await session.list_tools()
                    
                    return [
                        ToolDefinition(
                            name=t.name,
                            description=t.description,
                            input_schema=t.inputSchema
                        )
                        for t in result.tools
                    ]
        except Exception as e:
            raise MCPClientError(f"SDK Error: {e}") from e

    async def call_tool(
        self, 
        sse_url: str, 
        tool_name: str, 
        arguments: Dict[str, Any], 
        headers: Optional[Dict[str, str]] = None
    ) -> Any:
        try:
            async with sse_client(sse_url, headers=headers, timeout=self.timeout) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    
                    result = await session.call_tool(tool_name, arguments)
                    return result.content
                    
        except Exception as e:
            logger.exception("MCP call_tool failed")
            raise MCPClientError(f"Failed to call tool {tool_name}: {e}") from e

# Singleton
mcp_client = MCPClient()
