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

    async def evalsha(self, sha, *keys_and_args, keys=None, args=None):
        if keys is None and args is None:
            if not keys_and_args:
                return None
            numkeys = keys_and_args[0]
            if not isinstance(numkeys, int):
                return None
            keys = list(keys_and_args[1:1 + numkeys])
            args = list(keys_and_args[1 + numkeys:])
        if not keys or not args:
            return None
        key = keys[0]
        bucket = self.hash_store.get(key)
        if not bucket or len(args) < 6:
            return None

        # quota_deduct.lua 模拟
        def _get_num(field, default=0.0):
            field_key = field.decode() if isinstance(field, (bytes, bytearray)) else str(field)
            raw = bucket.get(field_key)
            if raw is None:
                return default
            try:
                return float(raw)
            except Exception:
                return default

        balance = _get_num("balance", 0.0)
        credit_limit = _get_num("credit_limit", 0.0)
        daily_quota = int(_get_num("daily_quota", 0))
        daily_used = int(_get_num("daily_used", 0))
        daily_date = str(bucket.get("daily_date") or "")
        monthly_quota = int(_get_num("monthly_quota", 0))
        monthly_used = int(_get_num("monthly_used", 0))
        monthly_month = str(bucket.get("monthly_month") or "")
        version = int(_get_num("version", 0))

        amount = float(args[0])
        daily_requests = int(args[1])
        monthly_requests = int(args[2])
        today = str(args[3])
        month = str(args[4])
        allow_negative = int(args[5])

        effective_balance = balance + credit_limit
        if allow_negative == 0 and effective_balance < amount:
            return [0, "INSUFFICIENT_BALANCE", balance, credit_limit, amount]

        if daily_date != today:
            daily_used = 0
            daily_date = today
        new_daily_used = daily_used + daily_requests
        if daily_quota > 0 and new_daily_used > daily_quota:
            return [0, "DAILY_QUOTA_EXCEEDED", daily_quota, daily_used]

        if monthly_month != month:
            monthly_used = 0
            monthly_month = month
        new_monthly_used = monthly_used + monthly_requests
        if monthly_quota > 0 and new_monthly_used > monthly_quota:
            return [0, "MONTHLY_QUOTA_EXCEEDED", monthly_quota, monthly_used]

        new_balance = balance - amount
        bucket["balance"] = str(new_balance)
        bucket["daily_used"] = str(new_daily_used)
        bucket["daily_date"] = daily_date
        bucket["monthly_used"] = str(new_monthly_used)
        bucket["monthly_month"] = monthly_month
        bucket["version"] = str(version + 1)

        return [1, "OK", new_balance, new_daily_used, new_monthly_used, version + 1]


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


import pytest_asyncio


@pytest_asyncio.fixture
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
