import asyncio
import logging
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.sse import sse_client

from app.core.config import settings
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
        self.trust_env = bool(getattr(settings, "MCP_HTTP_TRUST_ENV", False))

    def _httpx_client_factory(
        self,
        headers: dict[str, Any] | None = None,
        timeout: httpx.Timeout | None = None,
        auth: httpx.Auth | None = None,
    ) -> httpx.AsyncClient:
        """
        MCP SSE 专用 HTTP 客户端工厂。

        默认禁用 trust_env，避免容器继承的全局代理影响 MCP 工具连通性。
        如需继承环境代理，可通过 MCP_HTTP_TRUST_ENV=true 开启。
        """
        kwargs: dict[str, Any] = {
            "follow_redirects": True,
            "trust_env": self.trust_env,
            "timeout": timeout or httpx.Timeout(30.0, read=300.0),
        }
        if headers is not None:
            kwargs["headers"] = headers
        if auth is not None:  # pragma: no cover
            kwargs["auth"] = auth
        return httpx.AsyncClient(**kwargs)

    async def fetch_tools(
        self, sse_url: str, headers: dict[str, str] | None = None
    ) -> list[ToolDefinition]:
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
                delay = min(
                    self.retry_backoff_max, self.retry_backoff_base * (2**attempt)
                )
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

    async def _fetch_tools_once(
        self, sse_url: str, headers: dict[str, str] | None = None
    ) -> list[ToolDefinition]:
        try:
            # Note: sse_client context manager yields (read_stream, write_stream)
            # We assume sse_client handles headers if supported, otherwise we might need to modify it or accept defaults.
            # Currently mcp 1.25.0 sse_client accepts headers.
            async with sse_client(
                sse_url,
                headers=headers,
                timeout=self.timeout,
                httpx_client_factory=self._httpx_client_factory,
            ) as (
                read,
                write,
            ):
                async with ClientSession(read, write) as session:
                    await session.initialize()

                    # List tools
                    result = await session.list_tools()

                    tools: list[ToolDefinition] = []
                    for t in result.tools:
                        # Capture extra fields not explicitly in MCP standard but often present
                        raw = t.model_dump() if hasattr(t, "model_dump") else {}
                        output_schema = raw.get("outputSchema") or raw.get("output_schema")
                        output_description = raw.get("outputDescription") or raw.get("output_description")

                        tools.append(
                            ToolDefinition(
                                name=t.name,
                                description=t.description,
                                input_schema=t.inputSchema,
                                output_schema=output_schema,
                                output_description=output_description,
                            )
                        )
                    return tools
        except Exception as e:
            raise MCPClientError(f"SDK Error: {e}") from e

    async def call_tool(
        self,
        sse_url: str,
        tool_name: str,
        arguments: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> Any:
        try:
            async with sse_client(
                sse_url,
                headers=headers,
                timeout=self.timeout,
                httpx_client_factory=self._httpx_client_factory,
            ) as (
                read,
                write,
            ):
                async with ClientSession(read, write) as session:
                    await session.initialize()

                    result = await session.call_tool(tool_name, arguments)
                    return result.content

        except Exception as e:
            logger.exception("MCP call_tool failed")
            raise MCPClientError(f"Failed to call tool {tool_name}: {e}") from e


# Singleton
mcp_client = MCPClient()
