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


@NotificationSenderRegistry.register(NotificationChannel.DINGTALK)
class DingTalkSender(NotificationSender):
    """钉钉通知发送器"""

    channel = NotificationChannel.DINGTALK

    async def validate_config(self, config: dict[str, Any]) -> tuple[bool, str | None]:
        if not config.get("webhook_url"):
            return False, "缺少必填字段: webhook_url"

        webhook = config.get("webhook_url", "")
        if not webhook.startswith(("http://", "https://")):
            return False, "webhook_url 必须是有效的 URL"

        return True, None

    async def send(
        self,
        user_channel_config: dict[str, Any],
        content: NotificationContent,
    ) -> NotificationResult:
        webhook_url = user_channel_config.get("webhook_url")
        at_mobiles = user_channel_config.get("at_mobiles", [])
        is_at_all = user_channel_config.get("is_at_all", False)

        payload = {
            "msgtype": "markdown",
            "markdown": {
                "title": content.title,
                "text": f"## {content.title}\n\n{content.content}",
            },
            "at": {
                "atMobiles": at_mobiles,
                "isAtAll": is_at_all,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

            if response.status_code == 200:
                try:
                    result_data = response.json()
                except Exception:
                    result_data = {}
                if result_data.get("errcode") == 0:
                    return NotificationResult(
                        success=True,
                        channel=self.channel,
                        message="钉钉消息发送成功",
                    )
                else:
                    return NotificationResult(
                        success=False,
                        channel=self.channel,
                        error=f"钉钉 API 错误: {result_data.get('errmsg')}",
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
            logger.exception("DingTalkSender.send failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=str(e),
            )
