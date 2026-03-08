from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.orchestrator.config import (
    WorkflowTemplate,
    get_workflow_for_channel,
)
from app.services.orchestrator.context import Channel, WorkflowContext
from app.services.workflow.steps.base import StepStatus
from app.services.workflow.steps.routing import RoutingStep


def test_external_chat_workflow_contract_steps():
    cfg = get_workflow_for_channel(Channel.EXTERNAL, "chat")

    assert cfg.template == WorkflowTemplate.EXTERNAL_CHAT
    assert cfg.steps == [
        "request_adapter",
        "validation",
        "signature_verify",
        "resolve_assets",
        "mcp_discovery",
        "quota_check",
        "rate_limit",
        "routing",
        "template_render",
        "agent_executor",
        "response_transform",
        "memory_write",
        "sanitize",
        "billing",
        "audit_log",
    ]


def test_external_image_workflow_contract_steps():
    cfg = get_workflow_for_channel(Channel.EXTERNAL, "image_generation")

    assert cfg.template == WorkflowTemplate.EXTERNAL_IMAGE
    assert "provider_execution" in cfg.steps
    assert "agent_executor" not in cfg.steps
    assert cfg.steps.index("provider_execution") < cfg.steps.index("response_transform")


def test_internal_chat_workflow_contract_steps():
    cfg = get_workflow_for_channel(Channel.INTERNAL, "chat")

    assert cfg.template == WorkflowTemplate.INTERNAL_CHAT
    assert cfg.steps[0] == "request_adapter"
    assert "conversation_load" in cfg.steps
    assert "conversation_append" in cfg.steps
    assert cfg.steps.index("conversation_load") < cfg.steps.index("routing")
    assert cfg.steps.index("conversation_append") < cfg.steps.index("billing")


def test_internal_non_chat_routes_to_preview_workflow():
    cfg = get_workflow_for_channel(Channel.INTERNAL, "embedding")

    assert cfg.template == WorkflowTemplate.INTERNAL_PREVIEW
    assert "conversation_load" not in cfg.steps
    assert "conversation_append" not in cfg.steps
    assert "agent_executor" in cfg.steps


@pytest.mark.asyncio
async def test_routing_step_contract_populates_required_namespace_keys(monkeypatch):
    routing_result = {
        "preset_id": 1,
        "instance_id": "inst-1",
        "provider_model_id": "pm-1",
        "upstream_url": "https://api.example.com/v1/chat/completions",
        "provider": "custom",
        "protocol_profile": {
            "request": {
                "template_engine": "jinja2",
                "request_template": {"model": None, "messages": None},
                "request_builder": {"name": "default", "config": {}},
            },
            "response": {"response_template": {"mode": "openai"}},
            "transport": {"method": "POST"},
            "defaults": {
                "headers": {"x-trace": "1"},
                "body": {"temperature": 0.7},
            },
        },
        "async_config": {"enabled": False},
        "routing_config": {"strategy": "weight"},
        "config_override": {"allow_template_override": True},
        "output_mapping": {"content": "choices.0.message.content"},
        "limit_config": {"rpm": 60, "tpm": 100000, "timeout": 30},
        "pricing_config": {"input_per_1k": 0.1, "output_per_1k": 0.2, "currency": "USD"},
        "auth_type": "bearer",
        "auth_config": {"secret_ref_id": "sec_xxx"},
        "weight": 10,
        "priority": 100,
    }

    backups = [
        {
            **routing_result,
            "instance_id": "inst-2",
            "provider_model_id": "pm-2",
            "weight": 5,
            "priority": 90,
        }
    ]

    step = RoutingStep()
    monkeypatch.setattr(
        step,
        "_select_upstream",
        AsyncMock(return_value=(routing_result, backups, False)),
    )

    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        requested_model="gpt-4",
        db_session=AsyncMock(spec=AsyncSession),
        capability="chat",
    )

    result = await step.execute(ctx)
    assert result.status == StepStatus.SUCCESS

    routing_ns = ctx.get_namespace("routing")
    required_keys = {
        "preset_id",
        "instance_id",
        "provider_model_id",
        "upstream_url",
        "provider",
        "protocol_profile",
        "async_config",
        "routing_config",
        "config_override",
        "output_mapping",
        "limit_config",
        "pricing_config",
        "auth_type",
        "auth_config",
        "candidates",
        "candidate_index",
        "affinity_hit",
        "affinity_provider_model_id",
    }
    assert required_keys.issubset(set(routing_ns.keys()))

    assert ctx.selected_instance_id == "inst-1"
    assert ctx.selected_provider_model_id == "pm-1"
    assert ctx.selected_upstream == routing_result["upstream_url"]
    assert ctx.routing_weight == 10
