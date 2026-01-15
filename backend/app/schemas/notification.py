from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.models.notification import NotificationLevel, NotificationType
from app.schemas.base import BaseSchema


class NotificationPublishBase(BaseSchema):
    title: str = Field(..., max_length=200, description="标题")
    content: str = Field(..., description="内容")
    type: NotificationType = Field(NotificationType.SYSTEM, description="通知类型")
    level: NotificationLevel = Field(NotificationLevel.INFO, description="通知级别")
    payload: dict[str, Any] | None = Field(None, description="扩展字段（非敏感）")
    source: str | None = Field(None, max_length=120, description="来源模块/服务")
    dedupe_key: str | None = Field(None, max_length=120, description="去重键（幂等）")
    expires_at: datetime | None = Field(None, description="过期时间")
    tenant_id: UUID | None = Field(None, description="租户 ID（为空表示全局）")


class NotificationPublishUserRequest(NotificationPublishBase):
    pass


class NotificationPublishAllRequest(NotificationPublishBase):
    active_only: bool = Field(True, description="仅激活用户")


class NotificationPublishResponse(BaseSchema):
    notification_id: UUID = Field(..., description="通知 ID")
    scheduled: bool = Field(True, description="是否已调度异步投递")
    message: str = Field(..., description="提示信息")


class NotificationInboxItem(BaseSchema):
    id: UUID = Field(..., description="通知 ID")
    notification_id: UUID = Field(..., description="通知 ID")
    title: str = Field(..., description="标题")
    content: str = Field(..., description="内容")
    type: NotificationType = Field(..., description="通知类型")
    level: NotificationLevel = Field(..., description="通知级别")
    payload: dict[str, Any] = Field(default_factory=dict, description="扩展字段")
    source: str | None = Field(None, description="来源模块/服务")
    created_at: datetime = Field(..., description="投递时间")
    read_at: datetime | None = Field(None, description="已读时间")
    archived_at: datetime | None = Field(None, description="归档时间")
    read: bool = Field(False, description="是否已读")


class NotificationSnapshot(BaseSchema):
    items: list[NotificationInboxItem] = Field(default_factory=list, description="通知列表")
    unread_count: int = Field(0, description="未读数量")


class NotificationWSOutbound(BaseSchema):
    type: Literal["snapshot", "notification", "ack", "pong", "error"]
    data: NotificationSnapshot | NotificationInboxItem | dict[str, Any] | None = None


class NotificationWSInbound(BaseSchema):
    type: Literal["ping", "mark_read", "mark_all_read", "clear"]
    notification_id: UUID | None = Field(None, description="通知 ID")
