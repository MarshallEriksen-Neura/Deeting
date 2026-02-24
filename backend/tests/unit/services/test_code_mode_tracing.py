import pytest

from app.services.code_mode import tracing as code_mode_tracing


def test_code_mode_span_child_relationship_and_duration():
    with code_mode_tracing.start_span(
        "code_mode.execution",
        trace_id="trace-unit-1",
        attributes={"code_mode.code_chars": 128},
    ) as parent_span:
        parent_span.add_event("execution.started", {"step": "prepare"})
        with parent_span.child("code_mode.sandbox.run") as child_span:
            child_span.set_attribute("code_mode.sandbox_attempt", 1)

    assert parent_span.trace_id == "trace-unit-1"
    assert parent_span.duration_ms is not None
    assert parent_span.duration_ms >= 0
    assert child_span.parent_span_id == parent_span.span_id
    assert child_span.trace_id == parent_span.trace_id
    assert child_span.duration_ms is not None
    assert child_span.duration_ms >= 0


def test_code_mode_span_marks_error_on_exception():
    with pytest.raises(RuntimeError):
        with code_mode_tracing.start_span("code_mode.execution") as span:
            raise RuntimeError("boom")

    assert span.status == "error"
    assert span.error is not None
    assert "boom" in span.error
    assert span.duration_ms is not None
    assert span.duration_ms >= 0
