import asyncio
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models import Base
from app.models.billing import TransactionStatus
from app.repositories.billing_repository import BillingRepository
from app.repositories.quota_repository import QuotaRepository


class DummyRedis:
    """简易内存 Redis，支持 set/hset/hget/exists 用于单元测试"""

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.hash_store: dict[str, dict[str, str]] = {}

    async def set(self, key, value, ex=None, nx=None):
        if nx:
            if key in self.store:
                return False
        self.store[key] = value
        return True

    async def get(self, key):
        return self.store.get(key)

    async def delete(self, *keys):
        removed = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                removed += 1
            if k in self.hash_store:
                del self.hash_store[k]
                removed += 1
        return removed

    async def exists(self, key):
        return int(key in self.store or key in self.hash_store)

    async def hset(self, key, mapping):
        bucket = self.hash_store.setdefault(key, {})
        for k, v in mapping.items():
            bucket[k] = str(v)
        return True

    async def incr(self, key):
        current = self.store.get(key, 0)
        try:
            current_val = int(current)
        except Exception:
            current_val = 0
        new_val = current_val + 1
        self.store[key] = new_val
        return new_val

    async def hget(self, key, field):
        return self.hash_store.get(key, {}).get(field)

    async def expire(self, key, ttl):
        return True

    async def keys(self, pattern: str):
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [k for k in list(self.store) + list(self.hash_store) if k.startswith(prefix)]
        return [k for k in list(self.store) + list(self.hash_store) if k == pattern]

    async def unlink(self, *keys):
        return await self.delete(*keys)


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def session():
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


@pytest.fixture
def dummy_redis(monkeypatch):
    original = getattr(cache, "_redis", None)
    dummy = DummyRedis()
    monkeypatch.setattr(cache, "_redis", dummy)
    yield dummy
    monkeypatch.setattr(cache, "_redis", original)


@pytest.mark.asyncio
async def test_quota_dual_write_syncs_redis(session, dummy_redis):
    tenant_id = uuid4()
    repo = QuotaRepository(session)

    quota = await repo.get_or_create(tenant_id)
    hash_key = cache._make_key(CacheKeys.quota_hash(str(tenant_id)))
    # 初次创建应同步 Redis Hash
    assert await dummy_redis.hget(hash_key, "balance") == "0"

    updated = await repo.check_and_deduct(
        tenant_id=tenant_id,
        daily_requests=1,
        monthly_requests=1,
        balance_amount=Decimal("0"),
        allow_negative=True,
    )
    assert updated.daily_used == 1
    assert await dummy_redis.hget(hash_key, "daily_used") == "1"


@pytest.mark.asyncio
async def test_billing_deduct_idempotent_and_tx(session, dummy_redis):
    tenant_id = uuid4()
    quota_repo = QuotaRepository(session)
    # 预置余额，避免拒绝
    await quota_repo.get_or_create(tenant_id, defaults={"balance": 5})

    repo = BillingRepository(session)
    tx1 = await repo.deduct(
        tenant_id=tenant_id,
        amount=Decimal("1.5"),
        trace_id="trace-123",
        allow_negative=True,
    )
    assert tx1.status == TransactionStatus.COMMITTED

    # 再次调用同一 trace，不应重复扣费
    tx2 = await repo.deduct(
        tenant_id=tenant_id,
        amount=Decimal("1.5"),
        trace_id="trace-123",
        allow_negative=True,
    )
    assert tx2.id == tx1.id
    # 余额只扣一次
    refreshed = await quota_repo.get_or_create(tenant_id)
    assert float(refreshed.balance) == float(Decimal("5") - Decimal("1.5"))
