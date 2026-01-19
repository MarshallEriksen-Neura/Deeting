import json

import pytest

from app.core.config import settings
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.resolve_assets import ResolveAssetsStep


@pytest.mark.asyncio
async def test_resolve_assets_step_updates_request_data(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")
    ctx.set("request", "base_url", "http://test")
    ctx.set(
        "validation",
        "validated",
        {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": "asset://assets/demo/2026/01/15/hello.png"},
                        },
                        {"type": "text", "text": "hi"},
                    ],
                }
            ]
        },
    )

    step = ResolveAssetsStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS

    resolved = ctx.get("resolve_assets", "request_data")
    assert resolved is not None
    resolved_url = resolved["messages"][0]["content"][0]["image_url"]["url"]
    assert resolved_url.startswith("http://test/api/v1/media/assets/")

    original = ctx.get("validation", "validated")
    original_url = original["messages"][0]["content"][0]["image_url"]["url"]
    assert original_url == "asset://assets/demo/2026/01/15/hello.png"


@pytest.mark.asyncio
async def test_resolve_assets_step_handles_string_content(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")

    content = json.dumps(
        [
            {"type": "text", "text": "hello"},
            {"type": "image_url", "image_url": {"url": "asset://assets/demo/img.png"}},
        ]
    )
    ctx = WorkflowContext(channel=Channel.EXTERNAL, capability="chat")
    ctx.set("request", "base_url", "http://test")
    ctx.set(
        "validation",
        "validated",
        {"messages": [{"role": "user", "content": content}]},
    )

    step = ResolveAssetsStep()
    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS

    resolved = ctx.get("resolve_assets", "request_data")
    resolved_content = resolved["messages"][0]["content"]
    parsed = json.loads(resolved_content)
    assert parsed[1]["image_url"]["url"].startswith("http://test/api/v1/media/assets/")
