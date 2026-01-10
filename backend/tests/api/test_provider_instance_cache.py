import uuid

import pytest

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.models.provider_preset import ProviderPreset
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.services.providers.provider_instance_service import ProviderInstanceService
from tests.api.conftest import AsyncSessionLocal, engine
from app.models import Base

import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def ensure_tables():
    """确保内存 SQLite 存在最新表结构（补充 provider_instance/provider_preset 表）。"""
    async with engine.begin() as conn:  # type: ignore[attr-defined]
        await conn.run_sync(Base.metadata.create_all)


@pytest.mark.asyncio
async def test_provider_instance_list_cached_and_invalidated():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)

        # 创建第一条实例并触发缓存写入
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-a",
            base_url="https://api.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )
        repo = ProviderInstanceRepository(session)
        instances = await repo.get_available_instances(user_id=None, include_public=True)
        assert len(instances) == 1

        key = cache._make_key(CacheKeys.provider_instance_list(None, True))  # type: ignore[attr-defined]
        assert key in cache._redis.store  # type: ignore[attr-defined]

        # 新增实例应触发失效，缓存被清除
        await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-b",
            base_url="https://api2.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY2",
        )
        assert key not in cache._redis.store  # type: ignore[attr-defined]

        instances = await repo.get_available_instances(user_id=None, include_public=True)
        assert len(instances) == 2


@pytest.mark.asyncio
async def test_provider_model_candidates_cache_and_invalidate():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="azure",
            name="inst-chat",
            base_url="https://chat.example.com",
            icon=None,
            credentials_ref="ENV_AZURE_KEY",
        )

        # 初次写入模型并缓存候选列表
        payload = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4",
            display_name="GPT-4",
            upstream_path="/v1/chat",
            template_engine="simple_replace",
            request_template={},
            response_transform={},
            pricing_config={},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            source="manual",
            extra_meta={},
            weight=100,
            priority=0,
            is_active=True,
        )
        await svc.upsert_models(inst.id, None, [payload])

        model_repo = ProviderModelRepository(session)
        candidates = await model_repo.get_candidates("chat", "gpt-4", user_id=None, include_public=True)
        assert len(candidates) == 1

        key = cache._make_key(CacheKeys.provider_model_candidates("chat", "gpt-4", None, True))  # type: ignore[attr-defined]
        assert key in cache._redis.store  # type: ignore[attr-defined]

        # 更新同一模型（权重变化）应失效候选缓存
        updated = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4",
            display_name="GPT-4",
            upstream_path="/v1/chat",
            template_engine="simple_replace",
            request_template={},
            response_transform={},
            pricing_config={},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            source="manual",
            extra_meta={},
            weight=500,
            priority=0,
            is_active=True,
        )
        await svc.upsert_models(inst.id, None, [updated])

        assert key not in cache._redis.store  # type: ignore[attr-defined]

        candidates = await model_repo.get_candidates("chat", "gpt-4", user_id=None, include_public=True)
        assert len(candidates) == 1
        assert candidates[0].weight == 500


@pytest.mark.asyncio
async def test_provider_preset_cache_and_invalidate():
    async with AsyncSessionLocal() as session:
        repo = ProviderPresetRepository(session)

        preset = ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI",
            slug="openai",
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={},
            default_headers={},
            default_params={},
            is_active=True,
        )
        session.add(preset)
        await session.commit()

        # 首次查询写入缓存
        obj = await repo.get_by_slug("openai")
        assert obj is not None
        key_one = cache._make_key(CacheKeys.provider_preset("openai"))  # type: ignore[attr-defined]
        assert key_one in cache._redis.store  # type: ignore[attr-defined]

        # 活跃列表缓存
        lst = await repo.get_active_presets()
        assert len(lst) == 1
        key_list = cache._make_key(CacheKeys.provider_preset_active_list())  # type: ignore[attr-defined]
        assert key_list in cache._redis.store  # type: ignore[attr-defined]

        # 失效调用应清除缓存
        from app.core.cache_invalidation import CacheInvalidator
        invalidator = CacheInvalidator()
        await invalidator.on_preset_updated(preset_id=str(preset.id))

        assert key_one not in cache._redis.store  # type: ignore[attr-defined]
        assert key_list not in cache._redis.store  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_provider_model_alias_match():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-alias",
            base_url="https://api.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        alias_name = "claude-4.5"
        upstream_name = "gpt-4o"

        payload = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id=upstream_name,
            unified_model_id=alias_name,
            display_name="Alias Claude",
            upstream_path="/v1/chat",
            template_engine="simple_replace",
            request_template={},
            response_transform={},
            pricing_config={},
            limit_config={},
            tokenizer_config={},
            routing_config={},
            source="manual",
            extra_meta={},
            weight=100,
            priority=0,
            is_active=True,
        )
        await svc.upsert_models(inst.id, None, [payload])

        model_repo = ProviderModelRepository(session)
        # 通过别名命中
        candidates = await model_repo.get_candidates("chat", alias_name, user_id=None, include_public=True)
        assert len(candidates) == 1
        assert candidates[0].model_id == upstream_name
        assert candidates[0].unified_model_id == alias_name
