import pytest

from app.schemas.tool import ToolDefinition
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
    ctx.set(
        "validation", "validated", {"model": "gpt-image-1", "response_format": None}
    )

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
    ctx.set(
        "validation", "validated", {"model": "gpt-image-1", "response_format": "url"}
    )

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
    ctx.set(
        "routing",
        "request_template",
        {"input": "{{ prompt }}", "count": "{{ num_outputs }}"},
    )
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


@pytest.mark.asyncio
async def test_template_render_injects_router_base_prompt():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/chat/completions")
    ctx.set("routing", "template_engine", "simple_replace")
    ctx.set("routing", "request_template", {"messages": []})
    ctx.set(
        "validation", "validated", {"messages": [{"role": "user", "content": "hi"}]}
    )

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    assert rendered["messages"][0]["role"] == "system"
    assert "Meta Rules" in rendered["messages"][0]["content"]


@pytest.mark.asyncio
async def test_template_render_injects_code_mode_reminder():
    step = TemplateRenderStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "upstream_url", "https://example.com/v1/chat/completions")
    ctx.set("routing", "template_engine", "simple_replace")
    ctx.set("routing", "request_template", {"messages": []})
    ctx.set(
        "validation", "validated", {"messages": [{"role": "user", "content": "帮我执行复杂任务"}]}
    )
    ctx.set(
        "mcp_discovery",
        "tools",
        [
            ToolDefinition(
                name="search_sdk",
                description="search core sdk",
                input_schema={"type": "object", "properties": {}},
            ),
            ToolDefinition(
                name="execute_code_plan",
                description="execute python code plan",
                input_schema={"type": "object", "properties": {}},
            ),
        ],
    )

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    rendered = ctx.get("template_render", "request_body")
    system_prompt = rendered["messages"][0]["content"]
    assert "Code Mode Capability" in system_prompt
    assert "search_sdk" in system_prompt
    assert "execute_code_plan" in system_prompt
    assert "deeting.call_tool(name, **kwargs)" in system_prompt
    assert "deeting.call_tool(name, {...})" in system_prompt
    assert "deeting.log(json.dumps(result, ensure_ascii=False))" in system_prompt
