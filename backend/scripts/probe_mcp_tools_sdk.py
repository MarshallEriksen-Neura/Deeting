import argparse
import asyncio
import inspect
import json
import sys
from typing import Any, Dict, List, Optional

from mcp import ClientSession
from mcp.client.sse import sse_client


def _build_headers(api_key: Optional[str], bearer: Optional[str]) -> Dict[str, str]:
    headers: Dict[str, str] = {"Accept": "text/event-stream"}
    if api_key:
        headers["x-api-key"] = api_key
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


def _unwrap_tools(result: Any) -> List[Any]:
    if hasattr(result, "tools"):
        return list(result.tools)
    if isinstance(result, list):
        return result
    return []


async def _list_tools(url: str, headers: Dict[str, str]) -> List[Any]:
    kwargs = {}
    sig = inspect.signature(sse_client)
    if "headers" in sig.parameters:
        kwargs["headers"] = headers
    if "accept" in sig.parameters:
        kwargs["accept"] = "text/event-stream"

    async with sse_client(url, **kwargs) as streams:
        async with ClientSession(streams[0], streams[1]) as session:
            await session.initialize()
            result = await session.list_tools()
            return _unwrap_tools(result)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Probe MCP tools list via official MCP Python SDK.")
    parser.add_argument("sse_url", help="SSE endpoint URL, e.g. https://host/mcp")
    parser.add_argument("--api-key", dest="api_key", default=None, help="x-api-key header value")
    parser.add_argument("--bearer", dest="bearer", default=None, help="Authorization bearer token")
    args = parser.parse_args()

    headers = _build_headers(args.api_key, args.bearer)
    try:
        tools = await _list_tools(args.sse_url, headers)
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({"tools": [t.model_dump() if hasattr(t, "model_dump") else t for t in tools]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
