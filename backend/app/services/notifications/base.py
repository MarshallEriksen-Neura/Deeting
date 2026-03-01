from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.models.user_notification_channel import NotificationChannel


@dataclass
class NotificationResult:
    """通知发送结果"""

    success: bool
    channel: NotificationChannel
    message: str | None = None
    error: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class NotificationContent:
    """通知内容"""

    title: str
    content: str
    extra: dict[str, Any] | None = None


class NotificationSender(ABC):
    """
    通知发送器抽象基类
    每个渠道实现一个子类，负责具体发送逻辑
    """

    channel: NotificationChannel

    @abstractmethod
    async def send(
        self,
        user_channel_config: dict[str, Any],
        content: NotificationContent,
    ) -> NotificationResult:
        """
        发送通知

        Args:
            user_channel_config: 用户渠道配置（从 UserNotificationChannel.config 读取）
            content: 通知内容

        Returns:
            NotificationResult: 发送结果
        """
        pass

    @abstractmethod
    async def validate_config(self, config: dict[str, Any]) -> tuple[bool, str | None]:
        """
        验证渠道配置是否有效

        Returns:
            (is_valid, error_message)
        """
        pass

    async def before_send(self, user_id: uuid.UUID) -> None:
        """发送前钩子（如记录日志）"""
        pass

    async def after_send(self, user_id: uuid.UUID, result: NotificationResult) -> None:
        """发送后钩子（如更新最后使用时间）"""
        pass


class NotificationSenderRegistry:
    """
    通知发送器注册中心
    管理所有渠道的发送器实现
    """

    _senders: dict[NotificationChannel, type[NotificationSender]] = {}

    @classmethod
    def register(cls, channel: NotificationChannel) -> callable:
        """装饰器：注册发送器"""

        def decorator(sender_cls: type[NotificationSender]) -> type[NotificationSender]:
            cls._senders[channel] = sender_cls
            return sender_cls

        return decorator

    @classmethod
    def get_sender(cls, channel: NotificationChannel) -> NotificationSender | None:
        """获取发送器实例"""
        sender_cls = cls._senders.get(channel)
        if sender_cls:
            return sender_cls()
        return None

    @classmethod
    def get_all_channels(cls) -> list[NotificationChannel]:
        """获取所有已注册的渠道"""
        return list(cls._senders.keys())
