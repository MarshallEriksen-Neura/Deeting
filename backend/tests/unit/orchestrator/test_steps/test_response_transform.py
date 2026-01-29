import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.response_transform import ResponseTransformStep


@pytest.mark.asyncio
async def test_response_transform_attaches_blocks():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set("routing", "template_engine", "openai_compat")
    ctx.set("routing", "response_transform", {})
    ctx.set(
        "upstream_call",
        "response",
        {"choices": [{"message": {"content": "hi", "reasoning_content": "think"}}]},
    )
    ctx.set("upstream_call", "status_code", 200)

    step = ResponseTransformStep()
    await step.execute(ctx)

    response = ctx.get("response_transform", "response")
    message = response["choices"][0]["message"]
    assert message["meta_info"]["blocks"] == [
        {"type": "thought", "content": "think"},
        {"type": "text", "content": "hi"},
    ]
