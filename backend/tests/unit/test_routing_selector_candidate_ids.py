from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from app.services.providers.routing_selector import RoutingSelector


def _build_preset(preset_id):
    return SimpleNamespace(
        id=preset_id,
        slug="test-preset",
        provider="openai",
        is_active=True,
        protocol_profiles={
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "openai:chat:openai_chat",
                "provider": "openai",
                "protocol_family": "openai_chat",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "chat/completions",
                    "query_template": {},
                    "header_template": {},
                },
                "request": {
                    "template_engine": "simple_replace",
                    "request_template": {"messages": "{{messages}}"},
                },
                "response": {
                    "decoder": {"name": "openai_chat", "config": {}},
                    "response_template": {},
                },
                "stream": {
                    "stream_decoder": {
                        "name": "openai_chat_stream",
                        "config": {},
                    }
                },
                "auth": {"auth_policy": "inherit", "config": {}},
                "features": {"supports_messages": True, "supports_input_items": False},
                "defaults": {"headers": {}, "query": {}, "body": {}},
            }
        },
        auth_type="bearer",
        auth_config={},
    )


def _build_instance(instance_id):
    return SimpleNamespace(
        id=instance_id,
        preset_slug="test-preset",
        credentials_ref="test-secret-ref",
        base_url="https://api.example.com",
        meta={"protocol": "openai"},
        user_id=None,
        is_enabled=True,
    )


def _build_model(model_id, instance_id):
    return SimpleNamespace(
        id=model_id,
        instance_id=instance_id,
        is_active=True,
        capabilities=["chat"],
        upstream_path="chat/completions",
        pricing_config={},
        limit_config={},
        routing_config={},
        config_override={},
        weight=10,
        priority=5,
    )


@pytest.mark.asyncio
async def test_load_candidates_sets_preset_item_id_to_model_id():
    session = AsyncMock()
    selector = RoutingSelector(session)

    instance_id = uuid4()
    model_id = uuid4()
    preset_id = uuid4()

    instance = _build_instance(instance_id)
    model = _build_model(model_id, instance_id)
    preset = _build_preset(preset_id)

    selector.instance_repo.get_available_instances = AsyncMock(return_value=[instance])
    selector.model_repo.get_candidates = AsyncMock(return_value=[model])
    selector.preset_repo.get_by_slug = AsyncMock(return_value=preset)
    selector.credential_repo.get_by_instance_ids = AsyncMock(
        return_value={str(instance_id): []}
    )
    selector.bandit_repo.get_states_map = AsyncMock(return_value={})

    candidates = await selector.load_candidates(
        capability="chat",
        model="gpt-4o",
        channel="internal",
        user_id=None,
    )

    assert len(candidates) == 1
    assert candidates[0].model_id == str(model_id)
    assert candidates[0].preset_item_id == str(model_id)


@pytest.mark.asyncio
async def test_load_candidates_by_provider_model_id_sets_preset_item_id():
    session = AsyncMock()
    selector = RoutingSelector(session)

    instance_id = uuid4()
    model_id = uuid4()
    preset_id = uuid4()

    instance = _build_instance(instance_id)
    model = _build_model(model_id, instance_id)
    preset = _build_preset(preset_id)

    selector.model_repo.get = AsyncMock(return_value=model)
    selector.instance_repo.get = AsyncMock(return_value=instance)
    selector.preset_repo.get_by_slug = AsyncMock(return_value=preset)
    selector.credential_repo.get_by_instance_ids = AsyncMock(
        return_value={str(instance_id): []}
    )
    selector.bandit_repo.get_states_map = AsyncMock(return_value={})

    candidates = await selector.load_candidates_by_provider_model_id(
        provider_model_id=str(model_id),
        capability="chat",
        channel="internal",
        user_id=None,
    )

    assert len(candidates) == 1
    assert candidates[0].model_id == str(model_id)
    assert candidates[0].preset_item_id == str(model_id)


@pytest.mark.asyncio
async def test_load_candidates_prefers_protocol_profile_fields_when_present():
    session = AsyncMock()
    selector = RoutingSelector(session)

    instance_id = uuid4()
    model_id = uuid4()
    preset_id = uuid4()

    instance = _build_instance(instance_id)
    model = _build_model(model_id, instance_id)
    model.upstream_path = "responses"
    preset = _build_preset(preset_id)
    preset.protocol_profiles = {
        "chat": {
            "runtime_version": "v2",
            "schema_version": "2026-03-07",
            "profile_id": "openai:chat:openai_responses",
            "provider": "openai",
            "protocol_family": "openai_responses",
            "capability": "chat",
            "transport": {
                "method": "POST",
                "path": "responses",
                "query_template": {},
                "header_template": {},
            },
            "request": {
                "template_engine": "openai_compat",
                "request_template": {"model": None, "input": None},
                "request_builder": {
                    "name": "responses_input_from_items",
                    "config": {},
                },
            },
            "response": {
                "decoder": {"name": "openai_responses", "config": {}},
                "response_template": {},
            },
            "stream": {
                "stream_decoder": {
                    "name": "openai_responses_stream",
                    "config": {},
                }
            },
            "auth": {"auth_policy": "inherit", "config": {}},
            "features": {"supports_messages": False, "supports_input_items": True},
            "defaults": {"headers": {}, "query": {}, "body": {}},
        }
    }

    selector.instance_repo.get_available_instances = AsyncMock(return_value=[instance])
    selector.model_repo.get_candidates = AsyncMock(return_value=[model])
    selector.preset_repo.get_by_slug = AsyncMock(return_value=preset)
    selector.credential_repo.get_by_instance_ids = AsyncMock(
        return_value={str(instance_id): []}
    )
    selector.bandit_repo.get_states_map = AsyncMock(return_value={})

    candidates = await selector.load_candidates(
        capability="chat",
        model="gpt-5.3-codex",
        channel="internal",
        user_id=None,
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    profile = candidate.protocol_profile
    assert profile["request"]["template_engine"] == "openai_compat"
    assert profile["request"]["request_template"] == {"model": None, "input": None}
    assert profile["request"]["request_builder"]["name"] == "responses_input_from_items"
    assert candidate.protocol_profile["protocol_family"] == "openai_responses"
