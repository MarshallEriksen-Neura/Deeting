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
    ctx.set("routing", "request_template", {"model": None, "response_format": None})
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
    ctx.set("routing", "request_template", {"model": None, "response_format": None})
    ctx.set("validation", "validated", {"model": "gpt-image-1", "response_format": "url"})

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    assert rendered.get("response_format") == "url"


@pytest.mark.asyncio
async def test_template_render_uses_jinja2_template():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/images/generations")
    ctx.set("routing", "template_engine", "jinja2")
    ctx.set("routing", "request_template", {"input": "{{ prompt }}", "count": "{{ num_outputs }}"})
    ctx.set("validation", "validated", {"prompt": "hello", "num_outputs": 2})

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    assert rendered == {"input": "hello", "count": "2"}


@pytest.mark.asyncio
async def test_template_render_requires_request_template():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/images/generations")
    ctx.set("routing", "template_engine", "simple_replace")
    ctx.set("validation", "validated", {"model": "gpt-image-1"})

    result = await step.execute(ctx)

    assert result.status == StepStatus.FAILED
