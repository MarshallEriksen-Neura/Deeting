import uuid

import pytest
from pydantic import ValidationError

from app.services.monitor_cron import next_run_after, validate_cron_expr
from app.schemas.monitor import MonitorTaskCreate
from app.tasks.monitor import (
    _backpressure_delay_seconds,
    _backpressure_next_run,
    _build_monitor_prompt,
    _dispatch_target_is_desktop,
    _extract_notify_channel_ids,
    _max_trigger_per_tick,
    _max_trigger_per_user_per_tick,
    _parse_agent_output,
    reasoning_task,
    trigger_reasoning_task,
)
from app.core.config import settings
from app.utils.time_utils import Datetime


def test_validate_cron_expr_ok():
    ok, err = validate_cron_expr("0 */6 * * *")
    assert ok is True
    assert err is None


def test_validate_cron_expr_invalid():
    ok, err = validate_cron_expr("bad-cron")
    assert ok is False
    assert isinstance(err, str)


def test_next_run_after_in_future():
    now = Datetime.now()
    nxt = next_run_after("*/5 * * * *", now)
    assert nxt > now
    assert nxt.minute % 5 == 0


def test_parse_agent_output_accepts_markdown_block():
    output = """```json
{
  "is_significant_change": true,
  "change_summary": "发生重大变化",
  "new_snapshot": {"key_metrics": {"x": 1}}
}
```"""
    parsed = _parse_agent_output(output)
    assert parsed["is_significant_change"] is True
    assert parsed["change_summary"] == "发生重大变化"
    assert parsed["new_snapshot"]["key_metrics"]["x"] == 1


def test_parse_agent_output_fallback_on_invalid_json():
    parsed = _parse_agent_output('{"is_significant_change": ')
    assert parsed["is_significant_change"] is False


def test_parse_agent_output_keeps_summary_when_not_significant_change():
    output = """{
      "is_significant_change": false,
      "change_summary": "### 例行简报\\n局势总体平稳，仅有小幅波动。",
      "new_snapshot": {"status": "stable"}
    }"""
    parsed = _parse_agent_output(output)
    assert parsed["is_significant_change"] is False
    assert "例行简报" in parsed["change_summary"]


def test_parse_agent_output_builds_snapshot_summary_when_summary_missing():
    output = """{
      "is_significant_change": false,
      "change_summary": "",
      "new_snapshot": {
        "status": "watching",
        "timestamp_utc": "2026-03-01T14:14:32Z",
        "key_facts": ["事实A", "事实B"]
      }
    }"""
    parsed = _parse_agent_output(output)
    assert parsed["is_significant_change"] is False
    assert "例行简报" in parsed["change_summary"]
    assert "事实A" in parsed["change_summary"]


def test_build_monitor_prompt_has_required_fields():
    class DummyTask:
        title = "示例任务"
        objective = "监控 https://example.com"
        last_snapshot = {"a": 1}

    prompt = _build_monitor_prompt(DummyTask(), "聚焦事实变化")  # type: ignore[arg-type]
    assert "is_significant_change" in prompt
    assert "示例任务" in prompt
    assert "聚焦事实变化" in prompt


def test_monitor_task_create_normalizes_allowed_tools():
    payload = MonitorTaskCreate(
        title="test",
        objective="watch",
        allowed_tools=[" fetch_web_content ", "fetch_web_content", "web.search"],
    )
    assert payload.allowed_tools == ["fetch_web_content", "web.search"]


def test_monitor_task_create_rejects_invalid_allowed_tools():
    with pytest.raises(ValidationError, match="allowed_tools 含非法工具名"):
        MonitorTaskCreate(
            title="test",
            objective="watch",
            allowed_tools=["bad tool"],
        )


def test_monitor_task_create_accepts_execution_target():
    payload = MonitorTaskCreate(
        title="test",
        objective="watch",
        execution_target="desktop_preferred",
    )
    assert payload.execution_target.value == "desktop_preferred"


def test_extract_notify_channel_ids_filters_invalid_and_deduplicates():
    c1 = uuid.uuid4()
    c2 = uuid.uuid4()
    parsed = _extract_notify_channel_ids(
        {
            "channel_ids": [
                str(c1),
                "invalid",
                c1,
                str(c2),
            ]
        }
    )
    assert parsed == [c1, c2]


def test_trigger_reasoning_task_propagates_force_notify(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    def _fake_apply_async(*, args, countdown, queue):
        captured["args"] = args
        captured["countdown"] = countdown
        captured["queue"] = queue

    monkeypatch.setattr(reasoning_task, "apply_async", _fake_apply_async)
    monkeypatch.setattr("app.tasks.monitor.random.randint", lambda a, b: 7)

    result = trigger_reasoning_task.run("task-1", True)

    assert result["status"] == "triggered"
    assert result["force_notify"] is True
    assert captured["args"] == ["task-1", True]
    assert captured["countdown"] == 0


def test_trigger_reasoning_task_default_force_notify_false(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, object] = {}

    def _fake_apply_async(*, args, countdown, queue):
        captured["args"] = args
        captured["countdown"] = countdown
        captured["queue"] = queue

    monkeypatch.setattr(reasoning_task, "apply_async", _fake_apply_async)
    monkeypatch.setattr("app.tasks.monitor.random.randint", lambda a, b: 3)

    result = trigger_reasoning_task.run("task-2")

    assert result["force_notify"] is False
    assert captured["args"] == ["task-2", False]
    assert captured["countdown"] == 3


def test_scheduler_limit_helpers_have_safe_floor(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "MONITOR_MAX_TRIGGER_PER_TICK", 0, raising=False)
    monkeypatch.setattr(settings, "MONITOR_MAX_TRIGGER_PER_USER_PER_TICK", -1, raising=False)
    monkeypatch.setattr(settings, "MONITOR_BACKPRESSURE_DELAY_SECONDS", 0, raising=False)

    assert _max_trigger_per_tick() == 1
    assert _max_trigger_per_user_per_tick() == 1
    assert _backpressure_delay_seconds() == 5


def test_backpressure_next_run_uses_delay_setting(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "MONITOR_BACKPRESSURE_DELAY_SECONDS", 75, raising=False)
    now = Datetime.now()
    delayed = _backpressure_next_run(now)
    assert int((delayed - now).total_seconds()) == 75


@pytest.mark.asyncio
async def test_dispatch_target_is_desktop_for_hard_local():
    class DummyTask:
        notify_config = {"execution_target": "desktop"}

    assert await _dispatch_target_is_desktop(
        DummyTask(),  # type: ignore[arg-type]
        desktop_online_cache={},
    )


@pytest.mark.asyncio
async def test_dispatch_target_is_desktop_for_preferred_when_online(monkeypatch: pytest.MonkeyPatch):
    class DummyTask:
        user_id = uuid.uuid4()
        notify_config = {"execution_target": "desktop_preferred"}

    async def _fake_get(_key: str):
        return {"agent_id": "desktop-1"}

    monkeypatch.setattr("app.tasks.monitor.cache.get", _fake_get)
    assert await _dispatch_target_is_desktop(
        DummyTask(),  # type: ignore[arg-type]
        desktop_online_cache={},
    )


@pytest.mark.asyncio
async def test_dispatch_target_is_desktop_for_preferred_when_offline(monkeypatch: pytest.MonkeyPatch):
    class DummyTask:
        user_id = uuid.uuid4()
        notify_config = {"execution_target": "desktop_preferred"}

    async def _fake_get(_key: str):
        return None

    monkeypatch.setattr("app.tasks.monitor.cache.get", _fake_get)
    assert not await _dispatch_target_is_desktop(
        DummyTask(),  # type: ignore[arg-type]
        desktop_online_cache={},
    )
