import pytest
from pydantic import ValidationError

from app.services.monitor_cron import next_run_after, validate_cron_expr
from app.schemas.monitor import MonitorTaskCreate
from app.tasks.monitor import _build_monitor_prompt, _parse_agent_output
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
