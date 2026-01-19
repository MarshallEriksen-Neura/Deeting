import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.template_render import TemplateRenderStep


@pytest.mark.asyncio
async def test_template_render_drops_null_response_format():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/images/generations")
    ctx.set("routing", "template_engine", "simple_replace")
    ctx.set("validation", "validated", {"model": "gpt-image-1", "response_format": None})

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    assert "response_format" not in rendered


@pytest.mark.asyncio
async def test_template_render_keeps_response_format_value():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/images/generations")
    ctx.set("routing", "template_engine", "simple_replace")
    ctx.set("validation", "validated", {"model": "gpt-image-1", "response_format": "url"})

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    assert rendered.get("response_format") == "url"
