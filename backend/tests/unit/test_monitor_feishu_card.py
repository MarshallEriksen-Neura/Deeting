from __future__ import annotations

from app.services.notifications.base import NotificationContent
from app.services.notifications.feishu import FeishuSender


def test_feishu_card_contains_pause_and_dialogue_actions():
    sender = FeishuSender()
    card = sender._build_interactive_card(
        NotificationContent(
            title="监控提醒",
            content="有重大变化",
            extra={
                "monitor_task_id": "task-id",
                "trace_id": "trace-id",
                "assistant_id": "assistant-id",
            },
        )
    )

    elements = card["card"]["elements"]
    action_block = next(item for item in elements if item.get("tag") == "action")
    events = [
        action.get("value", {}).get("event")
        for action in action_block["actions"]
        if isinstance(action.get("value"), dict)
    ]

    assert "pause" in events
    assert "dialogue" in events
