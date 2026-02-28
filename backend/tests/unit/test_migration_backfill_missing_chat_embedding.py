from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations/versions/20260228_01_backfill_missing_chat_embedding_capability_configs.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "migration_backfill_missing_chat_embedding",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ensure_chat_embedding_configs_adds_missing_defaults() -> None:
    migration = _load_migration_module()
    source = {"image_generation": {"enabled": True}}

    updated, changed = migration._ensure_chat_embedding_configs(source, "modelscope")

    assert changed is True
    assert source == {"image_generation": {"enabled": True}}
    assert updated["image_generation"] == {"enabled": True}
    assert updated["chat"]["template_engine"] == "openai_compat"
    assert updated["chat"]["request_template"]["messages"] is None
    assert updated["embedding"]["request_template"]["input"] is None


def test_ensure_chat_embedding_configs_keeps_existing_values() -> None:
    migration = _load_migration_module()
    existing_chat = {
        "template_engine": "jinja2",
        "request_template": {"messages": "{{ input.messages }}"},
    }
    existing_embedding = {
        "template_engine": "simple_replace",
        "request_template": {"input": "{{ input }}"},
    }
    source = {
        "chat": existing_chat,
        "embedding": existing_embedding,
        "image_generation": {"enabled": True},
    }

    updated, changed = migration._ensure_chat_embedding_configs(source, "anthropic")

    assert changed is False
    assert updated["chat"] == existing_chat
    assert updated["embedding"] == existing_embedding


def test_resolve_chat_template_engine_by_provider() -> None:
    migration = _load_migration_module()

    assert migration._resolve_chat_template_engine("anthropic") == "anthropic_messages"
    assert migration._resolve_chat_template_engine("google") == "google_gemini"
    assert migration._resolve_chat_template_engine("modelscope") == "openai_compat"
