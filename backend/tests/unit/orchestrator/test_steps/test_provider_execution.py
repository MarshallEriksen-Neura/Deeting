from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.provider_execution import ProviderExecutionStep


@pytest.mark.asyncio
async def test_provider_execution_prefers_protocol_profile(monkeypatch):
    captured: dict = {}

    class DummyProvider:
        def __init__(self, config):
            captured["config"] = config

        async def execute(self, request_payload, client, extra_context=None):
            captured["request_payload"] = request_payload
            captured["extra_context"] = extra_context or {}
            return {"ok": True}

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    step = ProviderExecutionStep()
    ctx = WorkflowContext(channel=Channel.INTERNAL, requested_model="gpt-5.3-codex")
    ctx.selected_instance_id = "inst-1"
    ctx.set("routing", "upstream_url", "https://api.example.com/v1/responses")
    ctx.set("routing", "provider", "openai")
    ctx.set("routing", "auth_config", {"secret_ref_id": "db:secret"})
    ctx.set("routing", "request_template", {"messages": None})
    ctx.set("routing", "default_headers", {"X-Legacy": "1"})
    ctx.set("routing", "http_method", "POST")
    ctx.set("routing", "request_builder", {"type": "legacy"})
    ctx.set(
        "routing",
        "protocol_profile",
        {
            "transport": {"method": "POST"},
            "request": {
                "request_template": {"model": None, "input": None},
                "request_builder": {
                    "name": "responses_input_from_items",
                    "config": {"extra_flag": True},
                },
            },
            "defaults": {"headers": {"X-Protocol": "v2"}},
        },
    )
    ctx.set(
        "validation",
        "validated",
        {"model": "gpt-5.3-codex", "input": "hello provider execution"},
    )

    monkeypatch.setattr(
        "app.services.workflow.steps.provider_execution.ConfigDrivenProvider",
        DummyProvider,
    )
    monkeypatch.setattr(
        "app.services.workflow.steps.provider_execution.create_async_http_client",
        lambda timeout=120.0: DummyClient(),
    )
    step.secret_manager.get = AsyncMock(return_value="sk-test")
    monkeypatch.setattr(
        step,
        "_update_provider_health",
        AsyncMock(return_value=None),
    )

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert captured["config"]["request_template"] == {"model": None, "input": None}
    assert captured["config"]["headers"] == {"X-Protocol": "v2"}
    assert captured["config"]["request_builder"] == {
        "type": "responses_input_from_items",
        "extra_flag": True,
    }
    assert captured["request_payload"]["input"] == "hello provider execution"
