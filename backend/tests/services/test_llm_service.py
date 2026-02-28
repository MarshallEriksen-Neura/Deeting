from types import SimpleNamespace

import importlib
import pytest
import sys
import types

from app.repositories.provider_instance_repository import ProviderModelRepository
from app.repositories.secretary_repository import UserSecretaryRepository


def _load_llm_module(monkeypatch):
    fake_orchestrator_pkg = types.ModuleType("app.services.orchestrator")
    fake_orchestrator_pkg.__path__ = []
    fake_context_module = types.ModuleType("app.services.orchestrator.context")
    fake_context_module.Channel = SimpleNamespace(INTERNAL=SimpleNamespace(value="internal"))
    fake_context_module.WorkflowContext = object

    monkeypatch.setitem(sys.modules, "app.services.orchestrator", fake_orchestrator_pkg)
    monkeypatch.setitem(sys.modules, "app.services.orchestrator.context", fake_context_module)
    sys.modules.pop("app.services.providers.llm", None)
    return importlib.import_module("app.services.providers.llm")


@pytest.mark.asyncio
async def test_resolve_context_uses_primary_superuser_secretary(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()
    superuser_id = "123e4567-e89b-12d3-a456-426614174000"

    async def fake_get_primary_superuser_secretary(_self):
        return (
            SimpleNamespace(id=superuser_id),
            SimpleNamespace(model_name="Kimi-K2"),
        )

    async def fake_get_available_models_for_user(_self, _user_id: str):
        return []

    monkeypatch.setattr(
        UserSecretaryRepository,
        "get_primary_superuser_secretary",
        fake_get_primary_superuser_secretary,
    )
    monkeypatch.setattr(
        ProviderModelRepository,
        "get_available_models_for_user",
        fake_get_available_models_for_user,
    )

    target_model, resolved_user_id, resolved_tenant_id, resolved_api_key_id = (
        await service._resolve_context_identity_and_model(
            session=object(),
            model=None,
            user_id=None,
            tenant_id=None,
            api_key_id=None,
        )
    )

    assert target_model == "Kimi-K2"
    assert resolved_user_id == superuser_id
    assert resolved_tenant_id == superuser_id
    assert resolved_api_key_id == superuser_id


@pytest.mark.asyncio
async def test_resolve_context_uses_user_available_model(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()
    user_id = "123e4567-e89b-12d3-a456-426614174001"

    async def fake_get_available_models_for_user(_self, target_user_id: str):
        assert target_user_id == user_id
        return ["DeepSeek-V3"]

    monkeypatch.setattr(
        ProviderModelRepository,
        "get_available_models_for_user",
        fake_get_available_models_for_user,
    )

    target_model, resolved_user_id, resolved_tenant_id, resolved_api_key_id = (
        await service._resolve_context_identity_and_model(
            session=object(),
            model=None,
            user_id=user_id,
            tenant_id=None,
            api_key_id=None,
        )
    )

    assert target_model == "DeepSeek-V3"
    assert resolved_user_id == user_id
    assert resolved_tenant_id == user_id
    assert resolved_api_key_id == user_id


@pytest.mark.asyncio
async def test_resolve_context_raises_without_any_model(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()

    async def fake_get_primary_superuser_secretary(_self):
        return None

    monkeypatch.setattr(
        UserSecretaryRepository,
        "get_primary_superuser_secretary",
        fake_get_primary_superuser_secretary,
    )

    with pytest.raises(RuntimeError, match="no model specified"):
        await service._resolve_context_identity_and_model(
            session=object(),
            model=None,
            user_id=None,
            tenant_id=None,
            api_key_id=None,
        )
