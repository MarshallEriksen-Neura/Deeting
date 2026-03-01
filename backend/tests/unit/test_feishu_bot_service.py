from __future__ import annotations

import pytest

from app.services.monitoring.feishu_bot_service import FeishuBotService


@pytest.mark.asyncio
async def test_process_message_event_ignores_group_message_without_mentions(monkeypatch: pytest.MonkeyPatch):
    service = FeishuBotService()

    async def _cache_set(*args, **kwargs):
        return True

    monkeypatch.setattr("app.services.monitoring.feishu_bot_service.cache.set", _cache_set)
    async def _resolve_reply_context(chat_id: str):
        return None
    monkeypatch.setattr(service, "_resolve_reply_context", _resolve_reply_context)

    payload = {
        "header": {"event_type": "im.message.receive_v1", "event_id": "evt-1"},
        "event": {
            "sender": {"sender_type": "user"},
            "message": {
                "message_type": "text",
                "chat_type": "group",
                "chat_id": "chat-1",
                "content": '{"text":"你好"}',
                "mentions": [],
            },
        },
    }

    result = await service.process_message_event(payload)
    assert result["status"] == "ignored"
    assert result["reason"] == "bot_not_mentioned"


@pytest.mark.asyncio
async def test_process_message_event_replies_when_mentioned(monkeypatch: pytest.MonkeyPatch):
    service = FeishuBotService()

    async def _cache_set(*args, **kwargs):
        return True

    monkeypatch.setattr("app.services.monitoring.feishu_bot_service.cache.set", _cache_set)
    async def _resolve_reply_context(chat_id: str):
        return FeishuBotService.ReplyContext(
            user_id="u-1",
            model=None,
            system_prompt=None,
            bot_open_id="bot-open-id",
            app_id=None,
            app_secret=None,
        )
    monkeypatch.setattr(service, "_resolve_reply_context", _resolve_reply_context)

    captured: dict[str, str] = {}

    async def _fake_generate_reply(user_text: str, *, context=None) -> str:
        captured["user_text"] = user_text
        return "测试回复"

    async def _fake_send_text_message(chat_id: str, text: str, *, context=None) -> None:
        captured["chat_id"] = chat_id
        captured["reply"] = text

    monkeypatch.setattr(service, "_generate_reply", _fake_generate_reply)
    monkeypatch.setattr(service, "_send_text_message", _fake_send_text_message)

    payload = {
        "header": {"event_type": "im.message.receive_v1", "event_id": "evt-2"},
        "event": {
            "sender": {"sender_type": "user"},
            "message": {
                "message_type": "text",
                "chat_type": "group",
                "chat_id": "chat-2",
                "content": '{"text":"@_user_1  请继续分析"}',
                "mentions": [{"key": "@_user_1", "id": {"open_id": "bot-open-id"}}],
            },
        },
    }

    result = await service.process_message_event(payload)

    assert result["status"] == "replied"
    assert captured["chat_id"] == "chat-2"
    assert captured["reply"] == "测试回复"
    assert captured["user_text"] == "请继续分析"
