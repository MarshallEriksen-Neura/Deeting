from __future__ import annotations

import json
import uuid
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


@NotificationSenderRegistry.register(NotificationChannel.FEISHU)
class FeishuSender(NotificationSender):
    """飞书通知发送器"""

    channel = NotificationChannel.FEISHU

    async def validate_config(self, config: dict[str, Any]) -> tuple[bool, str | None]:
        required_fields = ["webhook_url"]
        for field in required_fields:
            if not config.get(field):
                return False, f"缺少必填字段: {field}"

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

        card = self._build_interactive_card(content)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    webhook_url,
                    json=card,
                    headers={"Content-Type": "application/json"},
                )

            if response.status_code == 200:
                try:
                    result_data = response.json()
                except Exception:
                    result_data = {}
                if result_data.get("code") == 0:
                    return NotificationResult(
                        success=True,
                        channel=self.channel,
                        message="飞书消息发送成功",
                        metadata={"msg_id": result_data.get("msg_id")},
                    )
                else:
                    return NotificationResult(
                        success=False,
                        channel=self.channel,
                        error=f"飞书 API 错误: {result_data.get('msg')}",
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
            logger.exception("FeishuSender.send failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=str(e),
            )

    def _build_interactive_card(self, content: NotificationContent) -> dict[str, Any]:
        """构建包含反馈按钮的飞书互动卡片。"""
        elements = [
            {
                "tag": "markdown",
                "content": content.content,
            }
        ]

        # 1. 渲染快照预览（如果存在）
        if content.extra and "snapshot_preview" in content.extra:
            snapshot = content.extra["snapshot_preview"]
            if snapshot:
                snapshot_str = json.dumps(snapshot, ensure_ascii=False, indent=2)
                elements.append({
                    "tag": "note",
                    "elements": [{"tag": "plain_text", "content": f"📊 研判快照预览:\n{snapshot_str[:500]}..."}]
                })

        # 2. 注入监控反馈交互按钮
        monitor_task_id = content.extra.get("monitor_task_id") if content.extra else None
        trace_id = content.extra.get("trace_id") if content.extra else None
        assistant_id = content.extra.get("assistant_id") if content.extra else None
        
        if monitor_task_id and trace_id:
            actions = [
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "👍 有价值"},
                    "type": "primary",
                    "value": {
                        "event": "useful",
                        "monitor_task_id": str(monitor_task_id),
                        "trace_id": str(trace_id)
                    }
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "👎 无意义"},
                    "type": "default",
                    "value": {
                        "event": "useless",
                        "monitor_task_id": str(monitor_task_id),
                        "trace_id": str(trace_id)
                    }
                }
            ]
            
            # 如果有关联助手，增加“立即对话”回调按钮
            if assistant_id:
                dialogue_url = f"https://deeting.app/chat/assistants/{assistant_id}"
                actions.append({
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "💬 立即对话"},
                    "type": "default",
                    "value": {
                        "event": "dialogue",
                        "monitor_task_id": str(monitor_task_id),
                        "assistant_id": str(assistant_id),
                        "dialogue_url": dialogue_url,
                    },
                })

            actions.append({
                "tag": "button",
                "text": {"tag": "plain_text", "content": "⏸️ 暂停监控"},
                "type": "danger",
                "confirm": {
                    "title": {"tag": "plain_text", "content": "确认暂停"},
                    "text": {"tag": "plain_text", "content": "确认不再接收此任务的推送吗？"}
                },
                "value": {
                    "event": "pause",
                    "monitor_task_id": str(monitor_task_id)
                }
            })
            
            elements.append({
                "tag": "action",
                "actions": actions
            })

        # 3. 兼容通用扩展信息显示
        if content.extra:
            extra_info = []
            for key, value in content.extra.items():
                if key in {"monitor_task_id", "trace_id", "snapshot_preview", "monitor_actions"}:
                    continue
                extra_info.append(f"**{key}**: {value}")
            if extra_info:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "plain_text", "content": "\n".join(extra_info)}
                })

        return {
            "msg_type": "interactive",
            "card": {
                "header": {
                    "title": {
                        "tag": "plain_text",
                        "content": content.title,
                    },
                    "template": "blue",
                },
                "elements": elements,
            },
        }


@NotificationSenderRegistry.register(NotificationChannel.WEBHOOK)
class WebhookSender(NotificationSender):
    """通用 Webhook 发送器（用于自定义回调）"""

    channel = NotificationChannel.WEBHOOK

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
        method = user_channel_config.get("method", "POST").upper()

        payload = {
            "title": content.title,
            "content": content.content,
            "extra": content.extra,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.request(
                    method=method,
                    url=webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

            if 200 <= response.status_code < 300:
                return NotificationResult(
                    success=True,
                    channel=self.channel,
                    message="Webhook 调用成功",
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
            logger.exception("WebhookSender.send failed")
            return NotificationResult(
                success=False,
                channel=self.channel,
                error=str(e),
            )
