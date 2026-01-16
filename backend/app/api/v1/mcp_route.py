from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.schemas.auth import MessageResponse
from app.schemas.mcp_market import (
    McpMarketToolDetail,
    McpMarketToolSummary,
    McpSubscriptionCreateRequest,
    McpSubscriptionItem,
    McpToolCategory,
)
from app.services.mcp.market_service import McpMarketService

router = APIRouter(prefix="/mcp", tags=["MCP"])


@router.get("/market-tools", response_model=List[McpMarketToolSummary])
async def list_market_tools(
    category: McpToolCategory | None = Query(None, description="分类过滤"),
    q: str | None = Query(None, description="搜索关键字"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = McpMarketService(db)
    return await svc.list_market_tools(category=category, search=q)


@router.get("/market-tools/{tool_id}", response_model=McpMarketToolDetail)
async def get_market_tool(
    tool_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = McpMarketService(db)
    tool = await svc.get_market_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="tool not found")
    return tool


@router.get("/subscriptions", response_model=List[McpSubscriptionItem])
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = McpMarketService(db)
    items = await svc.list_subscriptions(user_id=user.id)
    return [
        McpSubscriptionItem(
            id=sub.id,
            created_at=sub.created_at,
            updated_at=sub.updated_at,
            user_id=sub.user_id,
            market_tool_id=sub.market_tool_id,
            alias=sub.alias,
            config_hash_snapshot=sub.config_hash_snapshot,
            tool=tool,
        )
        for sub, tool in items
    ]


@router.post("/subscriptions", response_model=McpSubscriptionItem, status_code=status.HTTP_201_CREATED)
async def create_subscription(
    payload: McpSubscriptionCreateRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = McpMarketService(db)
    subscription, tool, created = await svc.subscribe(
        user_id=user.id,
        tool_id=payload.tool_id,
        alias=payload.alias,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return McpSubscriptionItem(
        id=subscription.id,
        created_at=subscription.created_at,
        updated_at=subscription.updated_at,
        user_id=subscription.user_id,
        market_tool_id=subscription.market_tool_id,
        alias=subscription.alias,
        config_hash_snapshot=subscription.config_hash_snapshot,
        tool=tool,
    )


@router.delete("/subscriptions/{tool_id}", response_model=MessageResponse)
async def delete_subscription(
    tool_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = McpMarketService(db)
    deleted = await svc.unsubscribe(user_id=user.id, tool_id=tool_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="subscription not found")
    return MessageResponse(message="subscription removed")
