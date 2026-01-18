import pytest

from app.core import config
from app.schemas.gateway import ChatCompletionRequest, ChatMessage
from app.services.orchestrator.context import (
    Channel,
    ErrorSource,
    WorkflowContext,
)
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.upstream_call import UpstreamCallStep
from app.services.workflow.steps.validation import ValidationStep


def test_mark_error_with_upstream():
    ctx = WorkflowContext()
    ctx.mark_error(ErrorSource.UPSTREAM, "UP_ERR", "failed", upstream_status=502, upstream_code="HTTP_502")
    assert ctx.error_source == ErrorSource.UPSTREAM
    assert ctx.upstream_result.status_code == 502
    assert ctx.upstream_result.error_code == "HTTP_502"
    assert not ctx.is_success


@pytest.mark.asyncio
async def test_validation_request_size_limit(monkeypatch):
    monkeypatch.setattr(config.settings, "MAX_REQUEST_BYTES", 10)
    step = ValidationStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    request = ChatCompletionRequest(
        model="gpt-test",
        messages=[ChatMessage(role="user", content="01234567890")],
    )
    ctx.set("validation", "request", request)

    result = await step.execute(ctx)
    assert result.status == StepStatus.FAILED
    assert "exceeds" in (result.message or "")


@pytest.mark.asyncio
async def test_upstream_whitelist_block(monkeypatch):
    monkeypatch.setattr(config.settings, "OUTBOUND_WHITELIST", ["allowed.com"])
    monkeypatch.setattr(config.settings, "ALLOW_CUSTOM_UPSTREAM", False)
    step = UpstreamCallStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    ctx.set("template_render", "upstream_url", "https://blocked.com/api")
    ctx.set("template_render", "request_body", {})
    ctx.set("template_render", "headers", {})
    ctx.set("routing", "auth_type", "none")

    result = await step.execute(ctx)
    assert result.status == StepStatus.FAILED
    assert ctx.error_code == "UPSTREAM_DOMAIN_NOT_ALLOWED"
