from app.core.metrics import (
    metrics_content,
    record_code_mode_execution,
    record_code_mode_tool_call,
)


def test_record_code_mode_execution_and_tool_call_metrics():
    record_code_mode_execution(
        status="success",
        duration_seconds=0.25,
        error_code=None,
    )
    record_code_mode_execution(
        status="failed",
        duration_seconds=0.5,
        error_code="CODE_MODE_VALIDATION_FAILED",
    )
    record_code_mode_tool_call(
        tool_name="search_web",
        status="success",
        error_code=None,
    )
    record_code_mode_tool_call(
        tool_name="send_alert",
        status="failed",
        error_code="UPSTREAM_TIMEOUT",
    )

    payload = metrics_content().decode("utf-8")

    assert "code_mode_executions_total" in payload
    assert "code_mode_execution_duration_seconds" in payload
    assert "code_mode_tool_calls_total" in payload
    assert "code_mode_errors_total" in payload
    assert 'error_code="CODE_MODE_VALIDATION_FAILED"' in payload
    assert 'tool_name="send_alert"' in payload
