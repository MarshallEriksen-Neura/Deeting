from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "migrations/versions/20260308_04_seed_nvidia_provider_preset.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "migration_seed_nvidia_provider_preset",
        MIGRATION_PATH,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_nvidia_preset_values_uses_openai_compatible_defaults() -> None:
    migration = _load_migration_module()

    values = migration._build_nvidia_preset_values()

    assert values["slug"] == "nvidia"
    assert values["provider"] == "nvidia"
    assert values["base_url"] == "https://integrate.api.nvidia.com"
    assert values["auth_type"] == "bearer"
    assert values["auth_config"]["secret_ref_id"] == "NGC_API_KEY"
    assert values["protocol_schema_version"] == "2026-03-07"


def test_build_nvidia_protocol_profiles_defaults_to_chat_and_embedding() -> None:
    migration = _load_migration_module()

    profiles = migration._build_nvidia_protocol_profiles()

    assert set(profiles.keys()) == {"chat", "embedding"}
    assert profiles["chat"]["transport"]["path"] == "chat/completions"
    assert profiles["chat"]["stream"]["stream_decoder"]["name"] == "openai_chat_stream"
    assert profiles["chat"]["features"]["supports_tools"] is True
    assert profiles["embedding"]["transport"]["path"] == "embeddings"
    assert profiles["embedding"]["stream"]["stream_decoder"] is None
    assert profiles["embedding"]["features"]["supports_messages"] is False
