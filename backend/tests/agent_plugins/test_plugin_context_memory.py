import uuid

import pytest

from app.agent_plugins.core.context import ConcretePluginContext


def test_memory_denies_nil_user_id(monkeypatch):
    monkeypatch.setattr(
        "app.agent_plugins.core.context.qdrant_is_configured", lambda: True
    )

    ctx = ConcretePluginContext(
        plugin_name="system/vector_store",
        plugin_id="system/vector_store",
        user_id=uuid.UUID(int=0),
    )

    with pytest.raises(RuntimeError, match="real user_id"):
        _ = ctx.memory


def test_memory_builds_client_for_real_user(monkeypatch):
    monkeypatch.setattr(
        "app.agent_plugins.core.context.qdrant_is_configured", lambda: True
    )
    monkeypatch.setattr(
        "app.agent_plugins.core.context.get_qdrant_client", lambda: object()
    )

    user_id = uuid.uuid4()
    ctx = ConcretePluginContext(
        plugin_name="system/vector_store",
        plugin_id="system/vector_store",
        user_id=user_id,
    )

    memory = ctx.memory
    assert memory is ctx.memory
    assert getattr(memory, "_user_id") == str(user_id)
