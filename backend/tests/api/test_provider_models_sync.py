import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models import Base
from app.models.provider_preset import ProviderPreset
from app.services.providers import provider_instance_service
from tests.api.conftest import AsyncSessionLocal, engine
from tests.utils.provider_protocol_profiles import build_protocol_profiles

DEFAULT_PROFILE_CONFIGS = {
    "chat": {
        "template_engine": "simple_replace",
        "request_template": {
            "model": None,
            "messages": None,
            "stream": None,
            "status_stream": None,
            "temperature": None,
            "max_tokens": None,
            "provider_model_id": None,
            "assistant_id": None,
            "session_id": None,
        },
        "response_transform": {},
        "default_headers": {},
        "default_params": {},
        "async_config": {},
    },
}


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


async def _seed_preset(session, slug: str):
    existing = (
        await session.execute(
            select(ProviderPreset.slug).where(ProviderPreset.slug == slug)
        )
    ).scalar_one_or_none()
    if existing:
        return
    preset = ProviderPreset(
        id=uuid.uuid4(),
        name="OpenAI" if slug == "openai" else slug,
        slug=slug,
        provider=slug,
        base_url="https://api.openai.com",
        auth_type="bearer",
        auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
        protocol_schema_version="2026-03-07",
        protocol_profiles=build_protocol_profiles(
            provider=slug,
            profile_configs=DEFAULT_PROFILE_CONFIGS,
        ),
        is_active=True,
    )
    session.add(preset)
    await session.commit()
    await cache.delete(CacheKeys.provider_preset(slug))
    await cache.delete(CacheKeys.provider_preset_active_list())


@pytest.mark.asyncio
async def test_sync_models_accepts_empty_body(AsyncSessionLocal, monkeypatch):
    """确保同步接口在无请求体时也能通过（走自动探测分支）。"""
    async with AsyncSessionLocal() as session:
        await _seed_preset(session, "openai")
        svc = provider_instance_service.ProviderInstanceService(session)
        instance = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="sync-test",
            base_url="https://api.openai.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

    # Stub 上游探测，避免外部请求
    async def fake_fetch_models(self, preset, instance, secret):
        return [{"id": "gpt-4"}, {"id": "gpt-3.5-turbo"}]

    monkeypatch.setattr(
        provider_instance_service.ProviderInstanceService,
        "_fetch_models_from_upstream",
        fake_fetch_models,
    )

    # 调用同步接口，不提供 body
    async with AsyncSessionLocal() as session:
        svc = provider_instance_service.ProviderInstanceService(session)
        data = await svc.sync_models_from_upstream(
            instance.id,
            None,
            preserve_user_overrides=True,
        )

    assert isinstance(data, list)
    # 应至少返回 stub 的 2 个模型
    assert {m.model_id for m in data} == {"gpt-4", "gpt-3.5-turbo"}


@pytest.mark.asyncio
async def test_sync_models_returns_404_when_preset_missing(client, auth_tokens):
    """当创建实例使用不存在的 preset_slug 时，应直接返回 404。"""

    headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}
    payload = {
        "preset_slug": "non-existent-preset",
        "name": "ghost-instance",
        "base_url": "https://api.invalid.local",
        "credentials_ref": "ENV_FAKE_KEY",
        "priority": 0,
        "is_enabled": True,
    }

    resp_create = await client.post("/api/v1/providers", json=payload, headers=headers)
    assert resp_create.status_code == 404
    assert resp_create.json().get("detail") == "preset not found"
