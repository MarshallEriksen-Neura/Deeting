from __future__ import annotations

from typing import Any

import httpx
from pydantic import Field

from app.schemas.base import BaseSchema


class UpstreamRequest(BaseSchema):
    method: str = "POST"
    url: str
    headers: dict[str, Any] = Field(default_factory=dict)
    query: dict[str, Any] = Field(default_factory=dict)
    body: dict[str, Any] = Field(default_factory=dict)


async def execute_upstream_request(
    upstream_request: UpstreamRequest,
    client: httpx.AsyncClient | None = None,
) -> httpx.Response:
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient()

    try:
        response = await client.request(
            method=upstream_request.method,
            url=upstream_request.url,
            headers=upstream_request.headers,
            params=upstream_request.query,
            json=upstream_request.body,
        )
        return response
    finally:
        if owns_client:
            await client.aclose()
