
import pytest
from unittest.mock import MagicMock
from app.services.orchestrator.context import WorkflowContext, Channel
from app.services.workflow.steps.response_transform import ResponseTransformStep
from app.services.workflow.steps.base import StepStatus

@pytest.mark.asyncio
async def test_transform_openai_response():
    step = ResponseTransformStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    
    openai_response = {
        "id": "chatcmpl-123",
        "object": "chat.completion",
        "created": 1677652288,
        "model": "gpt-3.5-turbo-0613",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Hello there!",
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": 9,
            "completion_tokens": 12,
            "total_tokens": 21
        }
    }
    
    ctx.set("upstream_call", "response", openai_response)
    ctx.set("upstream_call", "status_code", 200)
    ctx.set("routing", "provider", "openai")
    
    result = await step.execute(ctx)
    
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("response_transform", "response") == openai_response
    assert ctx.get("response_transform", "usage") == {
        "prompt_tokens": 9,
        "completion_tokens": 12,
        "total_tokens": 21
    }
    assert ctx.billing.input_tokens == 9
    assert ctx.billing.output_tokens == 12
    assert ctx.billing.total_tokens == 21

@pytest.mark.asyncio
async def test_transform_anthropic_response():
    step = ResponseTransformStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    
    anthropic_response = {
        "id": "msg_01Xnu9znmY9F2wJ1TzX4kL6V",
        "type": "message",
        "role": "assistant",
        "model": "claude-3-opus-20240229",
        "content": [
            {
                "type": "text",
                "text": "Hi, I'm Claude."
            }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": 10,
            "output_tokens": 15
        }
    }
    
    ctx.set("upstream_call", "response", anthropic_response)
    ctx.set("upstream_call", "status_code", 200)
    ctx.set("routing", "provider", "anthropic")
    
    result = await step.execute(ctx)
    
    assert result.status == StepStatus.SUCCESS
    transformed = ctx.get("response_transform", "response")
    assert transformed["object"] == "chat.completion"
    assert transformed["choices"][0]["message"]["content"] == "Hi, I'm Claude."
    assert transformed["choices"][0]["finish_reason"] == "stop"
    assert transformed["usage"]["total_tokens"] == 25
    
    usage = ctx.get("response_transform", "usage")
    assert usage["prompt_tokens"] == 10
    assert usage["completion_tokens"] == 15
    assert usage["total_tokens"] == 25
    
    assert ctx.billing.input_tokens == 10
    assert ctx.billing.output_tokens == 15

@pytest.mark.asyncio
async def test_transform_stream_skips(monkeypatch):
    step = ResponseTransformStep()
    ctx = WorkflowContext(channel=Channel.EXTERNAL)
    ctx.set("upstream_call", "stream", True)
    
    result = await step.execute(ctx)
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("response_transform", "stream") is True
    assert ctx.get("response_transform", "response") is None
