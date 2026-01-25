import argparse
import asyncio
import json
import sys
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx


def _build_headers(api_key: Optional[str], bearer: Optional[str]) -> Dict[str, str]:
    headers: Dict[str, str] = {"Accept": "text/event-stream"}
    if api_key:
        headers["x-api-key"] = api_key
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


def _extract_tools(payload: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if isinstance(payload.get("result"), dict) and isinstance(payload["result"].get("tools"), list):
        return payload["result"]["tools"]
    if isinstance(payload.get("tools"), list):
        return payload["tools"]
    return None


async def _fetch_tools(
    sse_url: str,
    headers: Dict[str, str],
    timeout: float,
) -> List[Dict[str, Any]]:
    stream_timeout = httpx.Timeout(timeout, read=None)
    post_timeout = httpx.Timeout(timeout)
    async with (
        httpx.AsyncClient(headers=headers, timeout=stream_timeout) as stream_client,
        httpx.AsyncClient(headers=headers, timeout=post_timeout) as post_client,
    ):
        async with stream_client.stream("GET", sse_url) as response:
            response.raise_for_status()

            endpoint: Optional[str] = None
            payload: Optional[Dict[str, Any]] = None
            posted = False

            async with asyncio.timeout(timeout):
                async for line in response.aiter_lines():
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("event: "):
                        continue
                    if not line.startswith("data: "):
                        continue

                    data_text = line[6:].strip()
                    if not data_text:
                        continue

                    if not endpoint:
                        if data_text.startswith("{"):
                            try:
                                endpoint_payload = json.loads(data_text)
                            except json.JSONDecodeError:
                                continue
                            if isinstance(endpoint_payload, dict):
                                endpoint = endpoint_payload.get("endpoint")
                        else:
                            endpoint = data_text

                        if not endpoint:
                            raise RuntimeError("SSE did not provide message endpoint")
                        if not endpoint.startswith(("http://", "https://")):
                            endpoint = urljoin(sse_url, endpoint)

                        payload = {
                            "jsonrpc": "2.0",
                            "id": str(uuid.uuid4()),
                            "method": "tools/list",
                            "params": {},
                        }
                        post_resp = await post_client.post(endpoint, json=payload)
                        post_resp.raise_for_status()

                        # Some servers return tools directly in POST response
                        try:
                            direct_json = post_resp.json()
                        except ValueError:
                            direct_json = None
                        if isinstance(direct_json, dict):
                            tools = _extract_tools(direct_json)
                            if tools:
                                return tools

                        posted = True
                        continue

                    if posted and payload:
                        try:
                            data = json.loads(data_text)
                        except json.JSONDecodeError:
                            continue
                        if data.get("id") == payload["id"]:
                            tools = _extract_tools(data)
                            if tools is not None:
                                return tools

    raise RuntimeError("Timeout or connection closed before receiving tools/list response")


async def main() -> int:
    parser = argparse.ArgumentParser(description="Probe MCP SSE endpoint and fetch tools list.")
    parser.add_argument("sse_url", help="SSE endpoint URL, e.g. https://host/mcp")
    parser.add_argument("--api-key", dest="api_key", default=None, help="x-api-key header value")
    parser.add_argument("--bearer", dest="bearer", default=None, help="Authorization bearer token")
    parser.add_argument("--timeout", type=float, default=60.0, help="timeout seconds for SSE probing")
    args = parser.parse_args()

    headers = _build_headers(args.api_key, args.bearer)
    try:
        tools = await _fetch_tools(args.sse_url, headers, args.timeout)
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({"tools": tools}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
