from unittest.mock import patch

import pytest

from app.services.orchestrator.context import BillingInfo, Channel, UpstreamResult, WorkflowContext
from app.services.workflow.steps.audit_log import AuditLogStep


@pytest.mark.asyncio
async def test_audit_log_dispatches_task():
    step = AuditLogStep()
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        tenant_id="test_tenant",
        trace_id="test_trace",
        requested_model="gpt-4",
        is_success=True,
    )
    ctx.billing = BillingInfo(
        input_tokens=10,
        output_tokens=20,
        total_tokens=30,
        total_cost=0.05
    )
    ctx.upstream_result = UpstreamResult(
        status_code=200
    )
    ctx.step_timings = {"step1": 100.0}

    # Patch the task inside the module where it is imported/used
    # Note: In AuditLogStep.execute, we do 'from app.tasks.audit import record_audit_log_task'
    # So we need to patch 'app.tasks.audit.record_audit_log_task'

    with patch("app.tasks.audit.record_audit_log_task") as mock_task:
        result = await step.execute(ctx)

        assert result.status.value == "success"
        assert mock_task.delay.called

        call_args = mock_task.delay.call_args[0][0]
        assert call_args["model"] == "gpt-4"
        assert call_args["input_tokens"] == 10
        assert call_args["status_code"] == 200
