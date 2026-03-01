from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger
from sqlalchemy import select

from app.core.cache import cache
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user_notification_channel import NotificationChannel, UserNotificationChannel
from app.services.secrets.manager import SecretManager


class FeishuBotService:
    """飞书应用机器人消息处理服务（事件回调 -> LLM -> 群回复）。"""

    TOKEN_CACHE_KEY = "feishu:tenant_access_token"
    EVENT_DEDUP_TTL_SECONDS = 600
    DEFAULT_SYSTEM_PROMPT = (
        "你是 Deeting 战情助手。请基于用户问题给出简洁、可执行的中文回答。"
        "若信息不足，请明确说明不确定性并给出下一步建议。"
    )

    @dataclass
    class ReplyContext:
        user_id: str | None
        model: str | None
        system_prompt: str | None
        bot_open_id: str | None
        app_id: str | None
        app_secret: str | None

    def __init__(self) -> None:
        self._secret_manager = SecretManager()

    async def process_message_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        header = payload.get("header") if isinstance(payload, dict) else {}
        if not isinstance(header, dict):
            return {"status": "ignored", "reason": "invalid_header"}

        event_type = str(header.get("event_type") or "").strip()
        if event_type != "im.message.receive_v1":
            return {"status": "ignored", "reason": "unsupported_event_type"}

        event_id = str(header.get("event_id") or "").strip()
        if event_id:
            accepted = await cache.set(
                f"feishu:event:{event_id}",
                True,
                ex=self.EVENT_DEDUP_TTL_SECONDS,
                nx=True,
            )
            if accepted is False and getattr(cache, "_redis", None) is not None:
                return {"status": "ignored", "reason": "duplicate_event"}

        event = payload.get("event")
        if not isinstance(event, dict):
            return {"status": "ignored", "reason": "invalid_event"}

        sender = event.get("sender")
        if not isinstance(sender, dict):
            return {"status": "ignored", "reason": "invalid_sender"}
        sender_type = str(sender.get("sender_type") or "").strip().lower()
        if sender_type != "user":
            return {"status": "ignored", "reason": "non_user_sender"}

        message = event.get("message")
        if not isinstance(message, dict):
            return {"status": "ignored", "reason": "invalid_message"}

        msg_type = str(message.get("message_type") or "").strip().lower()
        if msg_type != "text":
            return {"status": "ignored", "reason": "non_text_message"}

        chat_id = str(message.get("chat_id") or "").strip()
        if not chat_id:
            return {"status": "ignored", "reason": "missing_chat_id"}

        context = await self._resolve_reply_context(chat_id)
        chat_type = str(message.get("chat_type") or "").strip().lower()
        mentions = message.get("mentions") if isinstance(message.get("mentions"), list) else []

        if chat_type in {"group", "supergroup"}:
            if not self._is_bot_mentioned(mentions, context.bot_open_id if context else None):
                return {"status": "ignored", "reason": "bot_not_mentioned"}

        text = self._extract_text_content(message.get("content"))
        text = self._strip_mention_keys(text, mentions)
        text = " ".join(text.split()).strip()
        if not text:
            return {"status": "ignored", "reason": "empty_message"}

        reply_text = await self._generate_reply(text, context=context)
        await self._send_text_message(chat_id=chat_id, text=reply_text, context=context)
        return {"status": "replied", "chat_id": chat_id}

    @staticmethod
    def _extract_text_content(raw_content: Any) -> str:
        if isinstance(raw_content, str):
            text = raw_content.strip()
            if not text:
                return ""
            try:
                data = json.loads(text)
                if isinstance(data, dict):
                    msg = data.get("text")
                    if isinstance(msg, str):
                        return msg
            except Exception:
                return text
            return text
        if isinstance(raw_content, dict):
            text = raw_content.get("text")
            if isinstance(text, str):
                return text
        return ""

    @staticmethod
    def _strip_mention_keys(text: str, mentions: list[Any]) -> str:
        output = text or ""
        for mention in mentions:
            if not isinstance(mention, dict):
                continue
            key = mention.get("key")
            if isinstance(key, str) and key:
                output = output.replace(key, " ")
        return output

    @staticmethod
    def _is_bot_mentioned(mentions: list[Any], bot_open_id: str | None) -> bool:
        if not mentions:
            return False

        open_id = (bot_open_id or "").strip()
        if not open_id:
            # 未配置 bot open_id 时，保守认为“有 @ 即触发”。
            return True

        for mention in mentions:
            if not isinstance(mention, dict):
                continue
            target_id = mention.get("id")
            if not isinstance(target_id, dict):
                continue
            if str(target_id.get("open_id") or "").strip() == open_id:
                return True
        return False

    async def _generate_reply(self, user_text: str, *, context: ReplyContext | None) -> str:
        from app.services.providers.llm import llm_service

        system_prompt = (
            (context.system_prompt if context else None)
            or (settings.FEISHU_BOT_SYSTEM_PROMPT or "").strip()
            or self.DEFAULT_SYSTEM_PROMPT
        )
        model = (
            (context.model if context else None)
            or (settings.FEISHU_BOT_MODEL or "").strip()
            or None
        )
        default_user_id = (context.user_id if context else None) or None
        trace_id = f"feishu_msg_{abs(hash(user_text))}"

        try:
            result = await llm_service.chat_completion(
                model=model,
                user_id=default_user_id,
                tenant_id=default_user_id,
                api_key_id=default_user_id,
                trace_id=trace_id,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_text},
                ],
                temperature=0.2,
                max_tokens=800,
            )
            if isinstance(result, str):
                reply = result.strip()
            else:
                reply = json.dumps(result, ensure_ascii=False)
            if reply:
                return reply[:3000]
        except Exception:
            logger.exception("feishu_bot_generate_reply_failed")

        return "已收到你的消息。当前智能回复服务暂时不可用，请稍后再试。"

    async def _get_tenant_access_token(self, *, context: ReplyContext | None = None) -> str:
        app_id = ((context.app_id if context else None) or settings.FEISHU_BOT_APP_ID or "").strip()
        app_secret = ((context.app_secret if context else None) or settings.FEISHU_BOT_APP_SECRET or "").strip()
        cache_key = f"{self.TOKEN_CACHE_KEY}:{app_id}" if app_id else self.TOKEN_CACHE_KEY

        cached = await cache.get(cache_key)
        if isinstance(cached, str) and cached.strip():
            return cached.strip()

        if not app_id or not app_secret:
            raise RuntimeError("FEISHU_BOT_APP_ID / FEISHU_BOT_APP_SECRET not configured")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
        if resp.status_code != 200:
            raise RuntimeError(f"feishu_auth_http_{resp.status_code}")

        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"feishu_auth_code_{data.get('code')}")

        token = str(data.get("tenant_access_token") or "").strip()
        if not token:
            raise RuntimeError("feishu_auth_missing_token")

        expire = int(data.get("expire", 7200) or 7200)
        ttl = max(60, expire - 120)
        await cache.set(cache_key, token, ttl=ttl)
        return token

    async def _send_text_message(self, chat_id: str, text: str, *, context: ReplyContext | None = None) -> None:
        token = await self._get_tenant_access_token(context=context)
        payload = {
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages",
                params={"receive_id_type": "chat_id"},
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=utf-8",
                },
            )

        if resp.status_code != 200:
            raise RuntimeError(f"feishu_send_http_{resp.status_code}")

        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"feishu_send_code_{data.get('code')}: {data.get('msg')}")

    @staticmethod
    def _get_text_config(config: dict[str, Any], *keys: str) -> str | None:
        for key in keys:
            value = config.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _chat_id_matches(config: dict[str, Any], chat_id: str) -> bool:
        direct = config.get("chat_id")
        if isinstance(direct, str) and direct.strip() == chat_id:
            return True

        chat_ids = config.get("chat_ids")
        if isinstance(chat_ids, list):
            for item in chat_ids:
                if str(item).strip() == chat_id:
                    return True
        return False

    async def _resolve_reply_context(self, chat_id: str) -> ReplyContext | None:
        async with AsyncSessionLocal() as session:
            stmt = select(UserNotificationChannel).where(
                UserNotificationChannel.channel == NotificationChannel.FEISHU,
                UserNotificationChannel.is_active == True,
            )
            channels = (await session.execute(stmt)).scalars().all()

            matched: UserNotificationChannel | None = None
            for channel in channels:
                if not isinstance(channel.config, dict):
                    continue
                if self._chat_id_matches(channel.config, chat_id):
                    matched = channel
                    break
            if not matched:
                return None

            config = dict(matched.config or {})
            provider = "notification_feishu"

            app_id = self._get_text_config(config, "bot_app_id", "app_id")
            app_secret = self._get_text_config(config, "bot_app_secret", "app_secret")
            if isinstance(app_secret, str) and app_secret.startswith("db:"):
                app_secret = await self._secret_manager.get(
                    provider=provider,
                    secret_ref_id=app_secret,
                    db_session=session,
                )

            model = self._get_text_config(config, "bot_model", "model")
            system_prompt = self._get_text_config(config, "bot_system_prompt", "system_prompt")
            bot_open_id = self._get_text_config(config, "bot_open_id", "open_id")

            return self.ReplyContext(
                user_id=str(matched.user_id) if isinstance(matched.user_id, uuid.UUID) else str(matched.user_id),
                model=model,
                system_prompt=system_prompt,
                bot_open_id=bot_open_id,
                app_id=app_id,
                app_secret=app_secret,
            )
