import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.response_transform import ResponseTransformStep


@pytest.mark.asyncio
async def test_response_transform_attaches_blocks():
    ctx = WorkflowContext(channel=Channel.INTERNAL)
    ctx.set(
        "routing",
        "protocol_profile",
        {
            "request": {"template_engine": "openai_compat"},
            "response": {"response_template": {}},
        },
    )
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


@pytest.mark.asyncio
async def test_response_transform_uses_protocol_profile_decoder_when_available():
    ctx = WorkflowContext(channel=Channel.INTERNAL, requested_model="gpt-5.3-codex")
    ctx.set(
        "routing",
        "protocol_profile",
        {"response": {"decoder": {"name": "openai_responses"}}},
    )
    ctx.set(
        "upstream_call",
        "response",
        {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "hello"}],
                }
            ],
            "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            "status": "completed",
        },
    )
    ctx.set("upstream_call", "status_code", 200)

    step = ResponseTransformStep()
    await step.execute(ctx)

    response = ctx.get("response_transform", "response")
    assert response["choices"][0]["message"]["content"] == "hello"
    assert response["usage"]["total_tokens"] == 2
