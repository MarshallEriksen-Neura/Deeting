from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_notification_channel import NotificationChannel, UserNotificationChannel
from app.services.secrets.manager import SecretManager
from app.services.notifications.base import (
    NotificationContent,
    NotificationResult,
    NotificationSender,
    NotificationSenderRegistry,
)

from app.services.notifications.dingtalk import DingTalkSender
from app.services.notifications.email import EmailSender
from app.services.notifications.feishu import FeishuSender, WebhookSender
from app.services.notifications.telegram import TelegramSender


class UserNotificationService:
    """
    用户通知服务
    统一管理用户的通知渠道，按优先级发送通知
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.secret_manager = SecretManager()
        self._init_senders()

    def _init_senders(self) -> None:
        _ = FeishuSender
        _ = WebhookSender
        _ = DingTalkSender
        _ = TelegramSender
        _ = EmailSender

    @staticmethod
    def _normalize_channel(channel: NotificationChannel | str) -> NotificationChannel:
        if isinstance(channel, NotificationChannel):
            return channel
        try:
            return NotificationChannel(channel)
        except ValueError as exc:
            raise ValueError(f"未支持的渠道: {channel}") from exc

    async def get_user_channels(
        self,
        user_id: uuid.UUID,
        active_only: bool = True,
        channel_ids: list[uuid.UUID] | None = None,
    ) -> list[UserNotificationChannel]:
        stmt = select(UserNotificationChannel).where(UserNotificationChannel.user_id == user_id)
        if active_only:
            stmt = stmt.where(UserNotificationChannel.is_active == True)
        if channel_ids:
            stmt = stmt.where(UserNotificationChannel.id.in_(channel_ids))
        stmt = stmt.order_by(UserNotificationChannel.priority.asc())

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def notify_user(
        self,
        user_id: uuid.UUID,
        title: str,
        content: str,
        extra: dict[str, Any] | None = None,
        fallback: bool = True,
        channel_ids: list[uuid.UUID] | None = None,
        stop_on_success: bool = True,
    ) -> list[NotificationResult]:
        """
        向用户发送通知，按优先级尝试所有启用的渠道

        Args:
            user_id: 用户 ID
            title: 通知标题
            content: 通知内容
            extra: 额外信息
            fallback: 是否在失败时尝试下一个渠道
            channel_ids: 指定只发送到这些渠道（为空则按全量启用渠道）
            stop_on_success: 是否在首个成功后立即停止

        Returns:
            所有渠道的发送结果列表
        """
        channels = await self.get_user_channels(user_id, channel_ids=channel_ids)

        if not channels:
            logger.warning(f"No notification channels configured for user {user_id}")
            return []

        notification_content = NotificationContent(
            title=title,
            content=content,
            extra=extra,
        )

        results: list[NotificationResult] = []
        success = False

        for channel_config in channels:
            normalized_channel = self._normalize_channel(channel_config.channel)
            sender = NotificationSenderRegistry.get_sender(normalized_channel)
            if not sender:
                logger.warning(f"No sender registered for channel {normalized_channel}")
                continue

            runtime_config = await self._resolve_runtime_config(
                normalized_channel,
                channel_config.config,
            )

            result = await sender.send(
                user_channel_config=runtime_config,
                content=notification_content,
            )

            results.append(result)

            if result.success:
                success = True
                channel_config.last_used_at = datetime.utcnow()
                self.session.add(channel_config)
                await self.session.commit()
                logger.info(
                    f"Notification sent successfully via {normalized_channel} to user {user_id}"
                )
                if stop_on_success:
                    break
            else:
                logger.warning(f"Failed to send via {normalized_channel}: {result.error}")
                if not fallback:
                    break

        if not success and fallback:
            logger.error(f"All notification channels failed for user {user_id}")

        return results

    async def notify_users(
        self,
        user_ids: list[uuid.UUID],
        title: str,
        content: str,
        extra: dict[str, Any] | None = None,
    ) -> dict[uuid.UUID, list[NotificationResult]]:
        """向多个用户发送通知"""
        results: dict[uuid.UUID, list[NotificationResult]] = {}
        for user_id in user_ids:
            results[user_id] = await self.notify_user(
                user_id=user_id,
                title=title,
                content=content,
                extra=extra,
            )
        return results

    async def create_channel(
        self,
        user_id: uuid.UUID,
        channel: NotificationChannel,
        config: dict[str, Any],
        display_name: str | None = None,
        priority: int = 100,
    ) -> UserNotificationChannel:
        """创建用户的通知渠道"""
        channel = self._normalize_channel(channel)
        sender = NotificationSenderRegistry.get_sender(channel)
        if not sender:
            raise ValueError(f"未支持的渠道: {channel}")

        is_valid, error = await sender.validate_config(config)
        if not is_valid:
            raise ValueError(f"配置验证失败: {error}")

        existing = await self.session.execute(
            select(UserNotificationChannel).where(
                and_(
                    UserNotificationChannel.user_id == user_id,
                    UserNotificationChannel.channel == channel,
                )
            )
        )
        if existing.scalars().first():
            raise ValueError(f"渠道 {channel.value} 已存在，请更新配置")

        secure_config = await self._secure_channel_config(channel, config)

        user_channel = UserNotificationChannel(
            user_id=user_id,
            channel=channel,
            display_name=display_name,
            config=secure_config,
            priority=priority,
            is_active=True,
        )

        self.session.add(user_channel)
        await self.session.commit()
        await self.session.refresh(user_channel)

        return user_channel

    async def update_channel(
        self,
        channel_id: uuid.UUID,
        user_id: uuid.UUID,
        config: dict[str, Any] | None = None,
        display_name: str | None = None,
        priority: int | None = None,
        is_active: bool | None = None,
    ) -> UserNotificationChannel:
        """更新用户的通知渠道"""
        channel = await self.session.get(UserNotificationChannel, channel_id)
        if not channel:
            raise ValueError("渠道不存在")
        if channel.user_id != user_id:
            raise ValueError("无权限操作")

        if config is not None:
            normalized_channel = self._normalize_channel(channel.channel)
            sender = NotificationSenderRegistry.get_sender(normalized_channel)
            if sender:
                is_valid, error = await sender.validate_config(config)
                if not is_valid:
                    raise ValueError(f"配置验证失败: {error}")
            channel.config = await self._secure_channel_config(normalized_channel, config)

        if display_name is not None:
            channel.display_name = display_name
        if priority is not None:
            channel.priority = priority
        if is_active is not None:
            channel.is_active = is_active

        self.session.add(channel)
        await self.session.commit()
        await self.session.refresh(channel)

        return channel

    async def delete_channel(
        self,
        channel_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """删除用户的通知渠道"""
        channel = await self.session.get(UserNotificationChannel, channel_id)
        if not channel:
            raise ValueError("渠道不存在")
        if channel.user_id != user_id:
            raise ValueError("无权限操作")

        await self.session.delete(channel)
        await self.session.commit()

    async def get_channel(
        self,
        channel_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> UserNotificationChannel | None:
        """获取用户的指定渠道"""
        channel = await self.session.get(UserNotificationChannel, channel_id)
        if channel and channel.user_id == user_id:
            return channel
        return None

    async def get_channel_with_runtime_config(
        self,
        channel_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> tuple[UserNotificationChannel, dict[str, Any]] | None:
        """
        获取渠道详情（含可编辑的运行时配置，已解析 db: 密钥引用）。
        """
        channel = await self.get_channel(channel_id, user_id)
        if not channel:
            return None
        runtime_config = await self.resolve_runtime_config(
            channel.channel,
            channel.config if isinstance(channel.config, dict) else {},
        )
        return channel, runtime_config

    async def resolve_runtime_config(
        self,
        channel: NotificationChannel | str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """公开配置解析入口，供 API 层安全复用。"""
        return await self._resolve_runtime_config(channel, config)

    @staticmethod
    def _is_sensitive_config_key(key: str) -> bool:
        normalized = (key or "").strip().lower()
        sensitive_keywords = (
            "token",
            "secret",
            "password",
            "webhook",
            "api_key",
            "access_key",
            "private_key",
        )
        return any(keyword in normalized for keyword in sensitive_keywords)

    async def _secure_channel_config(
        self,
        channel: NotificationChannel | str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        channel = self._normalize_channel(channel)
        secured: dict[str, Any] = {}
        provider = f"notification_{channel.value}"

        for key, value in (config or {}).items():
            if (
                isinstance(value, str)
                and value.strip()
                and self._is_sensitive_config_key(key)
                and not value.startswith("db:")
            ):
                try:
                    secured[key] = await self.secret_manager.store(
                        provider=provider,
                        raw_secret=value.strip(),
                        db_session=self.session,
                    )
                except Exception as exc:
                    logger.error(
                        "notification_config_secure_failed channel={} key={} err={}",
                        channel.value,
                        key,
                        exc,
                    )
                    raise ValueError(f"敏感配置字段 {key} 存储失败") from exc
            else:
                secured[key] = value

        return secured

    async def _resolve_runtime_config(
        self,
        channel: NotificationChannel | str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        channel = self._normalize_channel(channel)
        resolved: dict[str, Any] = {}
        provider = f"notification_{channel.value}"

        for key, value in (config or {}).items():
            if isinstance(value, str) and value.startswith("db:"):
                secret = await self.secret_manager.get(
                    provider=provider,
                    secret_ref_id=value,
                    db_session=self.session,
                    allow_env=False,
                )
                if secret is None:
                    logger.warning(
                        "notification_secret_resolve_failed channel={} key={} ref={}",
                        channel.value,
                        key,
                        value,
                    )
                    resolved[key] = ""
                else:
                    resolved[key] = secret
            else:
                resolved[key] = value

        return resolved
