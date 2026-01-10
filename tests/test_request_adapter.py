import pytest

from app.schemas.gateway import AnthropicMessagesRequest, ChatCompletionRequest
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.request_adapter import RequestAdapterStep


@pytest.mark.asyncio
async def test_anthropic_messages_adapts_to_chat_request():
    req = AnthropicMessagesRequest(
        model="claude-3",
        system="You are helpful.",
        messages=[
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": [{"type": "text", "text": "hi"}]},
        ],
        max_tokens=128,
        temperature=0.3,
        stream=True,
    )

    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")
    ctx.set("adapter", "vendor", "anthropic")
    ctx.set("adapter", "raw_request", req)

    step = RequestAdapterStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    adapted = ctx.get("validation", "request")
    assert isinstance(adapted, ChatCompletionRequest)
    assert adapted.model == "claude-3"
    assert adapted.stream is True
    assert adapted.max_tokens == 128
    assert adapted.messages[0].role == "system"
    assert adapted.messages[1].role == "user"
    assert adapted.messages[2].role == "assistant"


@pytest.mark.asyncio
async def test_request_adapter_skips_non_chat_capability():
    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="embedding")
    ctx.set("validation", "request", ChatCompletionRequest(model="gpt", messages=[]))

    step = RequestAdapterStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    # 原请求未被修改
    assert isinstance(ctx.get("validation", "request"), ChatCompletionRequest)
