from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_active_user
from app.models import User
from app.models.user_notification_channel import NotificationChannel
from app.services.notifications.user_notification_service import UserNotificationService

router = APIRouter(prefix="/notification-channels", tags=["Notification Channels"])


class ChannelConfig(BaseModel):
    """渠道配置基类"""

    webhook_url: str | None = Field(None, description="Webhook URL")
    bot_token: str | None = Field(None, description="Telegram Bot Token")
    chat_id: str | None = Field(None, description="Telegram Chat ID")
    smtp_host: str | None = Field(None, description="SMTP 服务器")
    smtp_port: int | None = Field(None, description="SMTP 端口")
    from_email: str | None = Field(None, description="发件人邮箱")
    from_name: str | None = Field(None, description="发件人名称")
    to_email: str | None = Field(None, description="收件人邮箱")
    username: str | None = Field(None, description="SMTP 用户名")
    password: str | None = Field(None, description="SMTP 密码")
    use_tls: bool = Field(True, description="是否使用 TLS")
    at_mobiles: list[str] = Field(default_factory=list, description="@的手机号")
    is_at_all: bool = Field(False, description="是否@所有人")
    method: str = Field("POST", description="HTTP 方法")


class CreateChannelRequest(BaseModel):
    channel: NotificationChannel = Field(..., description="渠道类型")
    config: dict[str, Any] = Field(..., description="渠道配置")
    display_name: str | None = Field(None, description="显示名称")
    priority: int = Field(100, description="优先级")


class UpdateChannelRequest(BaseModel):
    config: dict[str, Any] | None = Field(None, description="渠道配置")
    display_name: str | None = Field(None, description="显示名称")
    priority: int | None = Field(None, description="优先级")
    is_active: bool | None = Field(None, description="是否启用")


class ChannelResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    channel: NotificationChannel
    display_name: str | None
    is_active: bool
    priority: int
    last_used_at: str | None
    created_at: str
    updated_at: str


@router.get("", response_model=dict)
async def list_channels(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = UserNotificationService(db)
    channels = await service.get_user_channels(user.id)
    return {
        "items": [
            {
                "id": c.id,
                "user_id": c.user_id,
                "channel": c.channel.value,
                "display_name": c.display_name,
                "is_active": c.is_active,
                "priority": c.priority,
                "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in channels
        ],
        "total": len(channels),
    }


@router.post("", response_model=dict)
async def create_channel(
    request: CreateChannelRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = UserNotificationService(db)
    try:
        channel = await service.create_channel(
            user_id=user.id,
            channel=request.channel,
            config=request.config,
            display_name=request.display_name,
            priority=request.priority,
        )
        return {
            "id": channel.id,
            "channel": channel.channel.value,
            "message": "渠道创建成功",
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.get("/{channel_id}", response_model=dict)
async def get_channel(
    channel_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = UserNotificationService(db)
    channel = await service.get_channel(channel_id, user.id)
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="渠道不存在",
        )
    return {
        "id": channel.id,
        "user_id": channel.user_id,
        "channel": channel.channel.value,
        "display_name": channel.display_name,
        "is_active": channel.is_active,
        "priority": channel.priority,
        "last_used_at": channel.last_used_at.isoformat() if channel.last_used_at else None,
        "created_at": channel.created_at.isoformat(),
        "updated_at": channel.updated_at.isoformat(),
    }


@router.patch("/{channel_id}", response_model=dict)
async def update_channel(
    channel_id: uuid.UUID,
    request: UpdateChannelRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = UserNotificationService(db)
    try:
        updates = request.model_dump(exclude_unset=True)
        channel = await service.update_channel(
            channel_id=channel_id,
            user_id=user.id,
            **updates,
        )
        return {
            "id": channel.id,
            "message": "渠道更新成功",
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.delete("/{channel_id}", response_model=dict)
async def delete_channel(
    channel_id: uuid.UUID,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = UserNotificationService(db)
    try:
        await service.delete_channel(channel_id, user.id)
        return {"message": "渠道已删除"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post("/test", response_model=dict)
async def test_channel(
    request: CreateChannelRequest,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from app.services.notifications.base import NotificationSenderRegistry
    from app.services.notifications.base import NotificationContent

    sender = NotificationSenderRegistry.get_sender(request.channel)
    if not sender:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未支持的渠道: {request.channel}",
        )

    is_valid, error = await sender.validate_config(request.config)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"配置验证失败: {error}",
        )

    content = NotificationContent(
        title="测试通知",
        content="这是一条测试消息。如果你看到这条消息，说明通知渠道配置正确。",
    )

    result = await sender.send(request.config, content)

    return {
        "success": result.success,
        "channel": result.channel.value,
        "message": result.message or result.error,
    }
