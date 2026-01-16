from __future__ import annotations

import hashlib
import json
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mcp_market import McpMarketTool, UserMcpSubscription, McpToolCategory
from app.repositories.mcp_market_repository import McpMarketRepository


class McpMarketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = McpMarketRepository(session)

    async def list_market_tools(
        self,
        *,
        category: McpToolCategory | None = None,
        search: str | None = None,
    ) -> list[McpMarketTool]:
        return await self.repo.list_market_tools(category=category, search=search)

    async def get_market_tool(self, tool_id: UUID) -> McpMarketTool | None:
        return await self.repo.get_market_tool(tool_id)

    async def list_subscriptions(self, user_id: UUID) -> list[tuple[UserMcpSubscription, McpMarketTool]]:
        return await self.repo.list_subscriptions(user_id)

    async def subscribe(
        self,
        *,
        user_id: UUID,
        tool_id: UUID,
        alias: str | None = None,
    ) -> tuple[UserMcpSubscription, McpMarketTool, bool]:
        tool = await self.repo.get_market_tool(tool_id)
        if not tool:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tool not found")

        existing = await self.repo.get_subscription(user_id=user_id, market_tool_id=tool_id)
        if existing:
            return existing, tool, False

        manifest_hash = self._hash_manifest(tool.install_manifest or {})
        subscription = await self.repo.create_subscription(
            user_id=user_id,
            market_tool_id=tool_id,
            alias=alias,
            config_hash_snapshot=manifest_hash,
        )
        await self.session.commit()
        await self.session.refresh(subscription)
        return subscription, tool, True

    async def unsubscribe(self, *, user_id: UUID, tool_id: UUID) -> bool:
        deleted = await self.repo.delete_subscription(user_id=user_id, market_tool_id=tool_id)
        if deleted:
            await self.session.commit()
        return deleted

    @staticmethod
    def _hash_manifest(manifest: dict) -> str:
        payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
