from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from app.models.user_notification_channel import NotificationChannel
from app.services.notifications.base import (
    NotificationContent,
    NotificationResult,
    NotificationSender,
    NotificationSenderRegistry,
)


@NotificationSenderRegistry.register(NotificationChannel.TELEGRAM)
class TelegramSender(NotificationSender):
    """Telegram 通知发送器"""

    channel = NotificationChannel.TELEGRAM

    async def validate_config(self, config: dict[str, Any]) -> tuple[bool, str | None]:
        required_fields = ["bot_token", "chat_id"]
        for field in required_fields:
            if not config.get(field):
                return False, f"缺少必填字段: {field}"

        return True, None

    async def send(
        self,
        user_channel_config: dict[str, Any],
        content: NotificationContent,
    ) -> NotificationResult:
        bot_token = user_channel_config.get("bot_token")
        chat_id = user_channel_config.get("chat_id")

        text = f"*{content.title}*\n\n{content.content}"

        if content.extra:
            extra_lines = []
            for key, value in content.extra.items():
                extra_lines.append(f"*{key}*: `{value}`")
            if extra_lines:
                text += "\n\n" + "\n".join(extra_lines)

        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        }

        api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

            if response.status_code == 200:
                try:
                    result_data = response.json()
                except Exception:
                    result_data = {}
                if result_data.get("ok"):
                    return NotificationResult(
                        success=True,
                        channel=self.channel,
                        message="Telegram 消息发送成功",
                        metadata={"message_id": result_data.get("result", {}).get("message_id")},
                    )
                else:
                    return NotificationResult(
                        success=False,
                        channel=self.channel,
                        error=f"Telegram API 错误: {result_data.get('description')}",
                    )
            else:
                return NotificationResult(
                    success=False,
                    channel=self.channel,
                    error=f"HTTP {response.status_code}: {response.text[:200]}",
                )
        except httpx.TimeoutException:
            return NotificationResult(
                success=False,
                channel=self.channel,
                error="请求超时",
            )
        except Exception as e:
            logger.exception("TelegramSender.send failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=str(e),
            )
