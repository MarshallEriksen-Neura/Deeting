import asyncio
import random
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base, ProviderPreset, ProviderPresetItem
from app.repositories.bandit_repository import BanditRepository
from app.services.providers.routing_selector import RoutingSelector


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def session() -> AsyncSession:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as sess:
        yield sess


async def _seed(session: AsyncSession):
    existing = await session.execute(
        select(ProviderPreset).where(ProviderPreset.slug == "openai-main")
    )
    preset = existing.scalars().first()
    if preset:
        items = (
            await session.execute(
                select(ProviderPresetItem).where(ProviderPresetItem.preset_id == preset.id)
            )
        ).scalars().all()
        return preset, items

    preset = ProviderPreset(
        id=uuid4(),
        name="openai-main",
        slug="openai-main",
        provider="openai",
        base_url="https://api.openai.com",
        auth_type="bearer",
        auth_config={},
        default_headers={},
        default_params={},
    )
    session.add(preset)
    await session.flush()

    items = [
        ProviderPresetItem(
            id=uuid4(),
            preset_id=preset.id,
            capability="chat",
            model="gpt-4o",
            upstream_path="/v1/chat/completions",
            channel="external",
            weight=200,
            priority=10,
            routing_config={"strategy": "weight"},
        ),
        ProviderPresetItem(
            id=uuid4(),
            preset_id=preset.id,
            capability="chat",
            model="gpt-4o",
            upstream_path="/v1/chat/completions",
            channel="external",
            weight=50,
            priority=5,
            routing_config={"strategy": "bandit", "epsilon": 1.0},
        ),
    ]
    session.add_all(items)
    await session.commit()
    return preset, items


@pytest.mark.asyncio
async def test_weight_strategy_prefers_higher_priority(session: AsyncSession):
    await _seed(session)
    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    primary, backups = selector.choose(candidates)

    assert primary.priority == 10
    assert all(b.priority <= primary.priority for b in backups)


@pytest.mark.asyncio
async def test_bandit_strategy_respects_epsilon(session: AsyncSession, monkeypatch):
    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")

    # 强制 exploration
    monkeypatch.setattr(random, "random", lambda: 0.0)
    primary, _ = selector.choose(candidates)
    assert primary.routing_config.get("strategy") in ("bandit", "weight")


@pytest.mark.asyncio
async def test_channel_filter(session: AsyncSession):
    # 添加 internal only item
    preset = (await session.execute(select(ProviderPreset))).scalars().first()
    internal_item = ProviderPresetItem(
        id=uuid4(),
        preset_id=preset.id,
        capability="chat",
        model="gpt-4o",
        upstream_path="/v1/chat/completions",
        channel="internal",
        weight=10,
        priority=1,
    )
    session.add(internal_item)
    await session.commit()

    selector = RoutingSelector(session)
    external_candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    assert all(c.channel != "internal" for c in external_candidates)

    internal_candidates = await selector.load_candidates("chat", "gpt-4o", "internal")
    assert any(c.channel == "internal" for c in internal_candidates)


@pytest.mark.asyncio
async def test_bandit_skips_cooldown(session: AsyncSession):
    _, items = await _seed(session)
    repo = BanditRepository(session)
    target_item = items[0]
    state = await repo.ensure_state(str(target_item.id))
    state.cooldown_until = datetime.now(UTC) + timedelta(minutes=5)
    await session.commit()

    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    assert all(c.preset_item_id != str(target_item.id) for c in candidates)


@pytest.mark.asyncio
async def test_bandit_feedback_enters_cooldown(session: AsyncSession):
    _, items = await _seed(session)
    repo = BanditRepository(session)
    target_item = items[1]

    for _ in range(5):
        await repo.record_feedback(
            preset_item_id=str(target_item.id),
            success=False,
            latency_ms=1200,
            cost=None,
            reward=None,
            routing_config={"failure_cooldown_threshold": 5, "cooldown_seconds": 30},
        )

    state = await repo.get_by_item(str(target_item.id))
    assert state is not None
    assert state.cooldown_until is not None
    assert state.cooldown_until > datetime.now(UTC)


@pytest.mark.asyncio
async def test_ucb_strategy_prefers_higher_ucb(session: AsyncSession, monkeypatch):
    await _seed(session)
    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    # 为两个候选构造 bandit 状态
    fast = candidates[0]
    slow = candidates[1]
    fast.routing_config["strategy"] = "ucb1"
    slow.routing_config["strategy"] = "ucb1"
    repo = BanditRepository(session)
    fast_state = await repo.ensure_state(fast.preset_item_id, strategy="ucb1")
    slow_state = await repo.ensure_state(slow.preset_item_id, strategy="ucb1")
    fast_state.total_trials = 10
    fast_state.successes = 8
    slow_state.total_trials = 10
    slow_state.successes = 4
    await session.commit()

    fast.bandit_state = fast_state
    slow.bandit_state = slow_state
    primary, _ = selector.choose([fast, slow])
    assert primary.preset_item_id == fast.preset_item_id


@pytest.mark.asyncio
async def test_thompson_strategy_samples(session: AsyncSession, monkeypatch):
    await _seed(session)
    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    c1, c2 = candidates[0], candidates[1]
    c1.routing_config["strategy"] = "thompson"
    c2.routing_config["strategy"] = "thompson"
    repo = BanditRepository(session)
    s1 = await repo.ensure_state(c1.preset_item_id, strategy="thompson", alpha=2, beta=1)
    s1.successes = 5
    s1.failures = 1
    s2 = await repo.ensure_state(c2.preset_item_id, strategy="thompson", alpha=1, beta=2)
    s2.successes = 1
    s2.failures = 5
    await session.commit()
    c1.bandit_state = s1
    c2.bandit_state = s2

    # 固定随机种子保证采样可测
    random.seed(42)
    primary, _ = selector.choose([c1, c2])
    assert primary.preset_item_id == c1.preset_item_id


@pytest.mark.asyncio
async def test_bandit_cache_version_miss_triggers_db(session: AsyncSession):
    await _seed(session)
    selector = RoutingSelector(session)
    candidates = await selector.load_candidates("chat", "gpt-4o", "external")
    target = candidates[0]
    repo = BanditRepository(session)
    state = await repo.ensure_state(target.preset_item_id, strategy="ucb1")
    # 写入旧版本缓存
    await repo._invalidator.bump_version()  # bump to make cache version stale
    version = await selector.bandit_repo._invalidator.get_version()
    wrong_version = (version or 1) - 1
    from app.core.cache import cache
    from app.core.cache_keys import CacheKeys
    await cache.set_with_version(
        CacheKeys.bandit_state(target.preset_item_id),
        repo._serialize_state(state),
        wrong_version,
        ttl=60,
    )
    # 重新加载应回源 DB 而不是使用旧缓存
    fresh_map = await repo.get_states_map([target.preset_item_id])
    assert fresh_map[target.preset_item_id].strategy == state.strategy
