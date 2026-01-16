from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mcp_market import McpMarketTool, UserMcpSubscription, McpToolCategory


class McpMarketRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_market_tools(
        self,
        *,
        category: McpToolCategory | None = None,
        search: str | None = None,
    ) -> list[McpMarketTool]:
        stmt = select(McpMarketTool)
        if category:
            stmt = stmt.where(McpMarketTool.category == category)
        if search:
            pattern = f"%{search}%"
            stmt = stmt.where(
                McpMarketTool.name.ilike(pattern)
                | McpMarketTool.description.ilike(pattern)
                | McpMarketTool.identifier.ilike(pattern)
            )
        stmt = stmt.order_by(McpMarketTool.created_at.desc(), McpMarketTool.id.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_market_tool(self, tool_id: UUID) -> McpMarketTool | None:
        return await self.session.get(McpMarketTool, tool_id)

    async def get_market_tool_by_identifier(self, identifier: str) -> McpMarketTool | None:
        stmt = select(McpMarketTool).where(McpMarketTool.identifier == identifier)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_subscriptions(self, user_id: UUID) -> list[tuple[UserMcpSubscription, McpMarketTool]]:
        stmt = (
            select(UserMcpSubscription, McpMarketTool)
            .join(McpMarketTool, McpMarketTool.id == UserMcpSubscription.market_tool_id)
            .where(UserMcpSubscription.user_id == user_id)
            .order_by(UserMcpSubscription.created_at.desc(), UserMcpSubscription.id.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.all())

    async def get_subscription(
        self,
        *,
        user_id: UUID,
        market_tool_id: UUID,
    ) -> UserMcpSubscription | None:
        stmt = select(UserMcpSubscription).where(
            UserMcpSubscription.user_id == user_id,
            UserMcpSubscription.market_tool_id == market_tool_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_subscription(
        self,
        *,
        user_id: UUID,
        market_tool_id: UUID,
        alias: str | None,
        config_hash_snapshot: str | None,
    ) -> UserMcpSubscription:
        subscription = UserMcpSubscription(
            user_id=user_id,
            market_tool_id=market_tool_id,
            alias=alias,
            config_hash_snapshot=config_hash_snapshot,
        )
        self.session.add(subscription)
        await self.session.flush()
        await self.session.refresh(subscription)
        return subscription

    async def delete_subscription(
        self,
        *,
        user_id: UUID,
        market_tool_id: UUID,
    ) -> bool:
        stmt = delete(UserMcpSubscription).where(
            UserMcpSubscription.user_id == user_id,
            UserMcpSubscription.market_tool_id == market_tool_id,
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0
