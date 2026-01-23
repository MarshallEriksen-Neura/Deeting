import json
import logging
import uuid
import asyncio
from typing import Any, Dict, List, Optional
import httpx
from app.schemas.tool import ToolDefinition, ToolCall

logger = logging.getLogger(__name__)

class MCPClientError(Exception):
    """Base exception for MCP Client operations."""
    pass

class MCPClient:
    """
    A lightweight, stateless MCP (Model Context Protocol) client.
    Used by the Gateway to discover and invoke tools from remote MCP servers.
    
    This implementation follows the JSON-RPC 2.0 over SSE/HTTP pattern
    without requiring the full MCP SDK.
    """

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout

    async def fetch_tools(self, sse_url: str, headers: Optional[Dict[str, str]] = None) -> List[ToolDefinition]:
        """
        Discovers tools from a remote MCP server.
        
        Note: MCP over SSE is technically stateful. This method performs a 
        quick handshake to list tools and then closes the connection.
        """
        try:
            # 1. Establish SSE connection to get the message endpoint
            async with httpx.AsyncClient(headers=headers, timeout=self.timeout) as client:
                async with client.stream("GET", sse_url) as response:
                    if response.status_code != 200:
                        raise MCPClientError(f"Failed to connect to MCP SSE: {response.status_code}")

                    # 2. Listen for the 'endpoint' event
                    post_endpoint = None
                    async for line in response.aiter_lines():
                        if line.startswith("event: endpoint"):
                            continue
                        if line.startswith("data: "):
                            post_endpoint = line[6:].strip()
                            # Resolve relative URL if necessary
                            if post_endpoint and not post_endpoint.startswith(("http://", "https://")):
                                from urllib.parse import urljoin
                                post_endpoint = urljoin(sse_url, post_endpoint)
                            break
                    
                    if not post_endpoint:
                        raise MCPClientError("MCP Server did not provide a message endpoint.")

                    # 3. Call 'tools/list' via the POST endpoint
                    # We need to stay in the same session context if the server requires it
                    payload = {
                        "jsonrpc": "2.0",
                        "id": str(uuid.uuid4()),
                        "method": "tools/list",
                        "params": {}
                    }
                    
                    # Since we are in the stream, we might need a concurrent POST
                    # But usually, MCP servers allow a separate POST to the endpoint.
                    list_resp = await client.post(post_endpoint, json=payload)
                    list_resp.raise_for_status()
                    
                    # 4. Wait for the response in the SSE stream
                    # In standard MCP, the response to a POST message comes back through the SSE stream.
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = json.loads(line[6:])
                            if data.get("id") == payload["id"]:
                                # Found our response!
                                tools_raw = data.get("result", {}).get("tools", [])
                                return [
                                    ToolDefinition(
                                        name=t["name"],
                                        description=t.get("description"),
                                        input_schema=t["inputSchema"]
                                    )
                                    for t in tools_raw
                                ]
                    
            raise MCPClientError("Timeout or connection closed before receiving tools/list response.")

        except Exception as e:
            logger.error(f"MCP fetch_tools failed: {e}")
            raise MCPClientError(f"Failed to fetch tools: {str(e)}")

    async def call_tool(
        self, 
        sse_url: str, 
        tool_name: str, 
        arguments: Dict[str, Any], 
        headers: Optional[Dict[str, str]] = None
    ) -> Any:
        """
        Invokes a tool on a remote MCP server.
        """
        try:
            async with httpx.AsyncClient(headers=headers, timeout=self.timeout) as client:
                async with client.stream("GET", sse_url) as response:
                    # Same handshake as fetch_tools
                    post_endpoint = None
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            post_endpoint = line[6:].strip()
                            if post_endpoint and not post_endpoint.startswith(("http://", "https://")):
                                from urllib.parse import urljoin
                                post_endpoint = urljoin(sse_url, post_endpoint)
                            break
                    
                    if not post_endpoint:
                        raise MCPClientError("MCP Server did not provide a message endpoint.")

                    payload = {
                        "jsonrpc": "2.0",
                        "id": str(uuid.uuid4()),
                        "method": "tools/call",
                        "params": {
                            "name": tool_name,
                            "arguments": arguments
                        }
                    }

                    await client.post(post_endpoint, json=payload)

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = json.loads(line[6:])
                            if data.get("id") == payload["id"]:
                                # Standard MCP result structure: { content: [...] }
                                result = data.get("result", {})
                                return result
            
            raise MCPClientError("Timeout or connection closed before receiving tool/call response.")

        except Exception as e:
            logger.error(f"MCP call_tool failed: {e}")
            raise MCPClientError(f"Failed to call tool {tool_name}: {str(e)}")

# Singleton
mcp_client = MCPClient()
