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


@pytest.mark.asyncio
async def test_provider_model_list_cache_and_update_invalidate():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-cache",
            base_url="https://api.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        model = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4o",
            display_name="gpt-4o",
            upstream_path="chat/completions",
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
        await svc.upsert_models(inst.id, None, [model])

        models = await svc.list_models(inst.id, None)
        assert len(models) == 1
        cache_key = cache._make_key(CacheKeys.provider_model_list(str(inst.id)))  # type: ignore[attr-defined]
        assert cache_key in cache._redis.store  # type: ignore[attr-defined]

        updated = await svc.update_model(model.id, None, is_active=False)
        assert updated.is_active is False
        assert cache_key not in cache._redis.store  # type: ignore[attr-defined]

        models = await svc.list_models(inst.id, None)
        assert models[0].is_active is False


@pytest.mark.asyncio
async def test_provider_instance_model_count_updates_with_models():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-count",
            base_url="https://api.openai.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        repo = ProviderInstanceRepository(session)
        instances = await repo.get_available_instances(user_id=None, include_public=True)
        assert len(instances) == 1
        assert getattr(instances[0], "model_count", 0) == 0

        payload = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4o",
            display_name="gpt-4o",
            upstream_path="/v1/chat/completions",
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

        # 再次获取实例列表，模型数量应为 1，且缓存已被失效
        instances = await repo.get_available_instances(user_id=None, include_public=True)
        assert len(instances) == 1
        assert getattr(instances[0], "model_count", 0) == 1


@pytest.mark.asyncio
async def test_quick_add_models_defaults_and_upstream_path():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-quick",
            base_url="https://api.openai.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        results = await svc.quick_add_models(inst.id, None, ["gpt-4o", "text-embedding-3-small"])
        assert len(results) == 2

        models = await svc.list_models(inst.id, None)
        by_id = {m.model_id: m for m in models}
        assert "gpt-4o" in by_id
        assert "text-embedding-3-small" in by_id
        # chat 默认路径
        assert by_id["gpt-4o"].upstream_path.endswith("chat/completions")
        # embedding 路径
        assert "embeddings" in by_id["text-embedding-3-small"].upstream_path


@pytest.mark.asyncio
async def test_provider_model_test_ping(monkeypatch):
    class FakeResp:
        def __init__(self):
            self.status_code = 200
            self._json = {"ok": True}
            self.text = "{}"

        def json(self):
            return self._json

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return FakeResp()

    monkeypatch.setattr("app.services.providers.provider_instance_service.httpx.AsyncClient", FakeClient)

    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-test",
            base_url="https://api.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
            api_key="sk-test",
        )
        model = ProviderModel(
            id=uuid.uuid4(),
            instance_id=inst.id,
            capability="chat",
            model_id="gpt-4o",
            display_name="gpt-4o",
            upstream_path="chat/completions",
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
        await svc.upsert_models(inst.id, None, [model])

        result = await svc.test_model(model.id, None, prompt="ping")
        assert result["success"] is True
        assert result["status_code"] == 200


@pytest.mark.asyncio
async def test_provider_instance_update_and_delete_invalidate_cache_and_health():
    async with AsyncSessionLocal() as session:
        svc = ProviderInstanceService(session)
        inst = await svc.create_instance(
            user_id=None,
            preset_slug="openai",
            name="inst-to-update",
            base_url="https://api.example.com",
            icon=None,
            credentials_ref="ENV_OPENAI_KEY",
        )

        repo = ProviderInstanceRepository(session)
        _ = await repo.get_available_instances(user_id=None, include_public=True)
        list_key = cache._make_key(CacheKeys.provider_instance_list(None, True))  # type: ignore[attr-defined]
        assert list_key in cache._redis.store  # type: ignore[attr-defined]

        # 更新实例并添加 api_key -> 凭证缓存应失效
        await svc.update_instance(inst.id, None, name="inst-updated", api_key="NEW_KEY")
        assert list_key not in cache._redis.store  # type: ignore[attr-defined]

        cred_key = cache._make_key(CacheKeys.provider_credentials(str(inst.id)))  # type: ignore[attr-defined]
        await cache.set(cred_key, "dummy")  # type: ignore[attr-defined]
        model_list_key = cache._make_key(CacheKeys.provider_model_list(str(inst.id)))  # type: ignore[attr-defined]
        await cache.set(model_list_key, "dummy")  # type: ignore[attr-defined]
        await cache.redis.hset(f"provider:health:{inst.id}", mapping={"status": "healthy", "latency": 10})  # type: ignore[attr-defined]
        await cache.redis.rpush(f"provider:health:{inst.id}:history", 1)  # type: ignore[attr-defined]

        await svc.delete_instance(inst.id, None)

        assert list_key not in cache._redis.store  # type: ignore[attr-defined]
        assert cred_key not in cache._redis.store  # type: ignore[attr-defined]
        assert model_list_key not in cache._redis.store  # type: ignore[attr-defined]
        assert f"provider:health:{inst.id}" not in cache._redis.store  # type: ignore[attr-defined]
        assert f"provider:health:{inst.id}:history" not in cache._redis.store  # type: ignore[attr-defined]
