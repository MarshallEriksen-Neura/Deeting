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


def test_feishu_card_formats_snapshot_preview_as_structured_markdown():
    sender = FeishuSender()
    card = sender._build_interactive_card(
        NotificationContent(
            title="监控提醒",
            content="有重大变化",
            extra={
                "monitor_task_id": "task-id",
                "trace_id": "trace-id",
                "snapshot_preview": {
                    "status": "IRGC_Power_Struggle_Escalated",
                    "timestamp_utc": "2026-03-01T14:14:32Z",
                    "key_facts": ["布伦特原油 78.42 USD/bbl (+1.8%)", "现货黄金 1873.10 USD/oz"],
                    "scenarios": {"A_全面战争": 52, "B_外交斡旋": 28},
                },
            },
        )
    )

    markdown_blocks = [
        element["content"]
        for element in card["card"]["elements"]
        if element.get("tag") == "markdown"
    ]
    assert any("📊 **研判快照**" in block for block in markdown_blocks)
    assert any("状态: `IRGC_Power_Struggle_Escalated`" in block for block in markdown_blocks)
    assert any("关键事实" in block for block in markdown_blocks)


def test_feishu_card_skips_empty_extra_fields():
    sender = FeishuSender()
    card = sender._build_interactive_card(
        NotificationContent(
            title="监控提醒",
            content="内容",
            extra={
                "monitor_task_id": "task-id",
                "trace_id": "trace-id",
                "assistant_id": None,
                "debug_note": "",
                "source": "monitor",
            },
        )
    )

    div_block = next(
        (element for element in card["card"]["elements"] if element.get("tag") == "div"),
        None,
    )
    assert div_block is not None
    text = div_block["text"]["content"]
    assert "**source**: monitor" in text
    assert "assistant_id" not in text
    assert "debug_note" not in text
