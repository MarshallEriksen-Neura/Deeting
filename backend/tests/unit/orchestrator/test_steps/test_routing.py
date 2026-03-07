from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import FailureAction, StepStatus
from app.services.workflow.steps.routing import RoutingStep


def _fake_routing_result():
    return (
        {
            "preset_id": 1,
            "preset_item_id": 11,
            "upstream_url": "https://api.fake.com",
            "provider": "fake",
            "template_engine": "legacy_engine",
            "protocol_profile": {
                "profile_id": "fake:chat:openai_chat",
                "protocol_family": "openai_chat",
                "request": {
                    "template_engine": "openai_compat",
                    "request_template": {"model": None, "messages": None},
                    "request_builder": {
                        "name": "responses_input_from_items",
                        "config": {"x": 1},
                    },
                },
                "response": {
                    "response_template": {"sanitization": {"mask_fields": ["id"]}}
                },
                "transport": {"method": "POST"},
                "defaults": {
                    "headers": {"X-Protocol": "v2"},
                    "body": {"temperature": 0.3},
                },
            },
            "request_template": {"legacy": True},
            "response_transform": {"legacy": True},
            "pricing_config": {"input_per_1k": 0.1, "output_per_1k": 0.2},
            "limit_config": {"rpm": 10, "tpm": 1000},
            "auth_type": "api_key",
            "auth_config": {"header": "Authorization"},
            "default_headers": {"User-Agent": "test"},
            "default_params": {"legacy": True},
            "routing_config": {},
            "weight": 1,
            "priority": 1,
        },
        [],
        False,
    )


def _fake_candidate() -> SimpleNamespace:
    return SimpleNamespace(
        preset_id=1,
        preset_slug="fake",
        preset_item_id=11,
        instance_id="inst-1",
        model_id="model-1",
        upstream_url="https://api.fake.com",
        provider="fake",
        template_engine="simple_replace",
        protocol_profile={
            "profile_id": "fake:chat:openai_chat",
            "protocol_family": "openai_chat",
        },
        request_template={"model": None},
        response_transform={},
        async_config={},
        http_method="POST",
        pricing_config={"input_per_1k": 0.1, "output_per_1k": 0.2},
        limit_config={"rpm": 10, "tpm": 1000},
        auth_type="api_key",
        auth_config={"header": "Authorization"},
        default_headers={"User-Agent": "test"},
        default_params={},
        routing_config={},
        config_override={},
        output_mapping={},
        request_builder={},
        weight=1,
        priority=1,
        credential_id="cred-1",
        credential_alias="main",
    )


@pytest.mark.asyncio
async def test_routing_success_populates_context(monkeypatch):
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )
    step = RoutingStep()
    monkeypatch.setattr(
        step, "_select_upstream", AsyncMock(return_value=_fake_routing_result())
    )

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert ctx.selected_upstream == "https://api.fake.com"
    assert ctx.get("routing", "preset_id") == 1
    assert ctx.get("routing", "candidates")[0]["provider"] == "fake"
    protocol_profile = ctx.get("routing", "protocol_profile")
    assert protocol_profile["protocol_family"] == "openai_chat"
    assert protocol_profile["request"]["template_engine"] == "openai_compat"
    assert protocol_profile["request"]["request_template"] == {
        "model": None,
        "messages": None,
    }
    assert protocol_profile["response"]["response_template"] == {
        "sanitization": {"mask_fields": ["id"]}
    }
    assert protocol_profile["defaults"]["headers"] == {"X-Protocol": "v2"}
    assert protocol_profile["defaults"]["body"] == {"temperature": 0.3}
    assert protocol_profile["request"]["request_builder"] == {
        "name": "responses_input_from_items",
        "config": {"x": 1},
    }
    assert ctx.routing_weight == 1


@pytest.mark.asyncio
async def test_routing_with_provider_model_id(monkeypatch):
    class DummyRequest:
        def __init__(self):
            self.model = "gpt-4"
            self.provider_model_id = "11111111-1111-1111-1111-111111111111"

    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )
    ctx.set("validation", "request", DummyRequest())

    step = RoutingStep()
    monkeypatch.setattr(
        step,
        "_select_by_provider_model_id",
        AsyncMock(return_value=_fake_routing_result()),
    )

    result = await step.execute(ctx)

    assert result.status == StepStatus.SUCCESS
    assert ctx.selected_upstream == "https://api.fake.com"


@pytest.mark.asyncio
async def test_routing_requires_model_and_db():
    step = RoutingStep()

    ctx_no_model = WorkflowContext(
        channel=Channel.EXTERNAL, db_session=AsyncMock(spec=AsyncSession)
    )
    result = await step.execute(ctx_no_model)
    assert result.status == StepStatus.FAILED

    ctx_no_db = WorkflowContext(channel=Channel.EXTERNAL, requested_model="gpt-3.5")
    result = await step.execute(ctx_no_db)
    assert result.status == StepStatus.FAILED


def test_routing_on_failure_retries_once():
    step = RoutingStep()
    assert step.on_failure(None, RuntimeError(), attempt=1) == FailureAction.RETRY
    assert step.on_failure(None, RuntimeError(), attempt=2) == FailureAction.ABORT


@pytest.mark.asyncio
async def test_select_upstream_passes_none_user_id_when_ctx_user_missing(monkeypatch):
    captured: dict = {}
    candidate = _fake_candidate()

    class FakeRoutingSelector:
        def __init__(self, _session):
            pass

        async def load_candidates(self, **kwargs):
            captured.update(kwargs)
            return [candidate]

        async def choose(self, candidates, messages=None):
            return candidates[0], [], False

    monkeypatch.setattr(
        "app.services.providers.routing_selector.RoutingSelector",
        FakeRoutingSelector,
    )

    step = RoutingStep()
    ctx = WorkflowContext(
        channel=Channel.INTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )

    result, _, _ = await step._select_upstream(
        session=ctx.db_session,
        capability="chat",
        model="gpt-4",
        channel=ctx.channel.value,
        ctx=ctx,
    )

    assert captured["user_id"] is None
    assert result["provider"] == "fake"


@pytest.mark.asyncio
async def test_select_by_provider_model_id_passes_none_user_id_when_ctx_user_missing(
    monkeypatch,
):
    captured: dict = {}
    candidate = _fake_candidate()

    class FakeRoutingSelector:
        def __init__(self, _session):
            pass

        async def load_candidates_by_provider_model_id(self, **kwargs):
            captured.update(kwargs)
            return [candidate]

        async def choose(self, candidates, messages=None):
            return candidates[0], [], False

    monkeypatch.setattr(
        "app.services.providers.routing_selector.RoutingSelector",
        FakeRoutingSelector,
    )

    step = RoutingStep()
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
    )

    result, _, _ = await step._select_by_provider_model_id(
        session=ctx.db_session,
        provider_model_id="11111111-1111-1111-1111-111111111111",
        channel=ctx.channel.value,
        ctx=ctx,
    )

    assert captured["user_id"] is None
    assert result["provider"] == "fake"
