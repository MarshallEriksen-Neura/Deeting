from app.services.orchestrator.context import (
    Channel,
    ErrorSource,
    WorkflowContext,
)


def test_namespace_get_set_isolated():
    ctx = WorkflowContext()

    ctx.set("step_a", "foo", "bar")
    ctx.set("step_b", "foo", "baz")

    assert ctx.get("step_a", "foo") == "bar"
    assert ctx.get("step_b", "foo") == "baz"
    assert ctx.get("step_a", "missing", "default") == "default"
    assert ctx.get_namespace("step_a") == {"foo": "bar"}


def test_mark_step_executed_tracks_timings():
    ctx = WorkflowContext()

    ctx.mark_step_executed("validation", 12.5)
    ctx.mark_step_executed("routing", 8.0)

    assert ctx.executed_steps == ["validation", "routing"]
    assert ctx.step_timings["validation"] == 12.5
    assert ctx.step_timings["routing"] == 8.0
    assert sum(ctx.step_timings.values()) == 20.5


def test_mark_error_updates_flags_and_upstream():
    ctx = WorkflowContext()

    ctx.mark_error(
        ErrorSource.UPSTREAM,
        "UPSTREAM_TIMEOUT",
        "timeout",
        upstream_status=504,
        upstream_code="TIMEOUT",
    )

    assert ctx.is_success is False
    assert ctx.error_source == ErrorSource.UPSTREAM
    assert ctx.error_code == "UPSTREAM_TIMEOUT"
    assert ctx.error_message == "timeout"
    assert ctx.upstream_result.status_code == 504
    assert ctx.upstream_result.error_code == "TIMEOUT"


def test_to_audit_dict_includes_summary_without_sensitive():
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        tenant_id="tenant-1",
        api_key_id="ak-1",
        capability="chat",
        requested_model="gpt-4",
    )
    ctx.upstream_result.provider = "openai"
    ctx.upstream_result.status_code = 200
    ctx.billing.total_cost = 0.12
    ctx.mark_step_executed("validation", 5.0)
    ctx.mark_step_executed("routing", 3.0)

    audit = ctx.to_audit_dict()

    assert audit["trace_id"] == ctx.trace_id
    assert audit["channel"] == "external"
    assert audit["requested_model"] == "gpt-4"
    assert audit["upstream"]["provider"] == "openai"
    assert audit["billing"]["total_cost"] == 0.12
    assert audit["total_duration_ms"] == 8.0
    # 确保敏感请求体未暴露
    assert "validation" not in audit


def test_channel_flags():
    external_ctx = WorkflowContext(channel=Channel.EXTERNAL)
    internal_ctx = WorkflowContext(channel=Channel.INTERNAL)

    assert external_ctx.is_external is True
    assert external_ctx.is_internal is False
    assert internal_ctx.is_internal is True
    assert internal_ctx.is_external is False
