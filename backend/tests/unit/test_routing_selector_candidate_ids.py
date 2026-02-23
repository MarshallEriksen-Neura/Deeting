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
        capability_configs={
            "chat": {
                "template_engine": "simple_replace",
                "request_template": {"messages": "{{messages}}"},
            }
        },
        auth_type="bearer",
        auth_config={},
        default_headers={},
        default_params={},
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
