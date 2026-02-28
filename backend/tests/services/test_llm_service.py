from types import SimpleNamespace

import importlib
import pytest
import sys
import types

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
async def test_resolve_context_uses_user_secretary_model(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()
    user_id = "123e4567-e89b-12d3-a456-426614174000"

    async def fake_get_by_user_id(_self, _user_id):
        return SimpleNamespace(model_name="Kimi-K2")

    monkeypatch.setattr(
        UserSecretaryRepository,
        "get_by_user_id",
        fake_get_by_user_id,
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

    assert target_model == "Kimi-K2"
    assert resolved_user_id == user_id
    assert resolved_tenant_id == user_id
    assert resolved_api_key_id == user_id


@pytest.mark.asyncio
async def test_resolve_context_raises_without_user_id_when_model_unspecified(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()

    with pytest.raises(
        RuntimeError,
        match="user_id is required when model is not specified",
    ):
        await service._resolve_context_identity_and_model(
            session=object(),
            model=None,
            user_id=None,
            tenant_id=None,
            api_key_id=None,
        )


@pytest.mark.asyncio
async def test_resolve_context_raises_without_secretary_model(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()
    user_id = "123e4567-e89b-12d3-a456-426614174001"

    async def fake_get_by_user_id(_self, _user_id):
        return SimpleNamespace(model_name=None)

    monkeypatch.setattr(
        UserSecretaryRepository,
        "get_by_user_id",
        fake_get_by_user_id,
    )

    with pytest.raises(RuntimeError, match="secretary model is not configured"):
        await service._resolve_context_identity_and_model(
            session=object(),
            model=None,
            user_id=user_id,
            tenant_id=None,
            api_key_id=None,
        )


@pytest.mark.asyncio
async def test_resolve_context_keeps_explicit_model_without_user(monkeypatch):
    llm_module = _load_llm_module(monkeypatch)
    service = llm_module.LLMService()

    target_model, resolved_user_id, resolved_tenant_id, resolved_api_key_id = (
        await service._resolve_context_identity_and_model(
            session=object(),
            model="gpt-4o-mini",
            user_id=None,
            tenant_id=None,
            api_key_id=None,
        )
    )

    assert target_model == "gpt-4o-mini"
    assert resolved_user_id is None
    assert resolved_tenant_id is None
    assert resolved_api_key_id is None
