"""
测试配置与 fixtures（API 层）

- 使用内存 SQLite (aiosqlite) 运行真实业务逻辑
- 覆盖 get_db 依赖，避免连接真实 PostgreSQL
- 用内存 Redis 替身挂载到 CacheService
- 通过登录接口获取真实 JWT 作为测试 token
"""
import os
import asyncio
import sys
from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# 确保 backend/ 在 sys.path，便于导入 app.*
BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# 测试环境禁用真实 Redis/Celery 连接，避免进程退出卡住
os.environ.setdefault("REDIS_URL", "")
os.environ.setdefault("CELERY_BROKER_URL", "")
os.environ.setdefault("CELERY_RESULT_BACKEND", "")

from app.core.config import settings
from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.database import get_db
from app.models import Base, User
from app.utils.security import get_password_hash
from main import app

# 测试环境禁止连接真实 Redis，确保使用 DummyRedis
settings.REDIS_URL = ""

# ---- 内存 Redis 替身 ----

class DummyRedis:
    def __init__(self):
        self.store: dict[str, bytes | int | float | str] = {}
        self.hash_store: dict[str, dict[bytes, bytes | str | int | float]] = {}
        self.zset_store: dict[str, list[tuple[str, float]]] = {}
        self.scripts: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None, nx: bool | None = None):
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def delete(self, *keys):
        removed = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                removed += 1
            if k in self.hash_store:
                del self.hash_store[k]
                removed += 1
            if k in self.zset_store:
                del self.zset_store[k]
                removed += 1
        return removed

    async def unlink(self, *keys):
        # Redis unlink is non-blocking delete;在内存替身中等价为 delete
        return await self.delete(*keys)

    async def keys(self, pattern: str):
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [k for k in list(self.store) + list(self.hash_store) + list(self.zset_store) if k.startswith(prefix)]
        return [k for k in list(self.store) + list(self.hash_store) + list(self.zset_store) if k == pattern]

    async def exists(self, *keys):
        return sum(1 for k in keys if k in self.store or k in self.hash_store or k in self.zset_store)

    async def flushall(self):
        self.store.clear()
        self.hash_store.clear()
        self.zset_store.clear()
        self.scripts.clear()

    async def incr(self, key: str, amount: int = 1):
        current = self.store.get(key, 0)
        try:
            current_val = int(current)
        except Exception:
            current_val = 0
        new_val = current_val + amount
        self.store[key] = new_val
        return new_val

    async def expire(self, key: str, ttl):
        return True

    async def pexpire(self, key: str, ttl):
        return True

    async def script_load(self, script: str):
        sha = f"sha:{len(self.scripts)+1}"
        self.scripts[sha] = script
        return sha

    async def evalsha(self, sha, keys=None, args=None):
        if not keys or not args:
            return None
        key = keys[0]
        bucket = self.hash_store.get(key)
        if not bucket or len(args) < 6:
            return None
        # quota_deduct.lua 模拟
        def _get_num(field, default=0.0):
            raw = bucket.get(field if isinstance(field, bytes) else str(field).encode())
            if raw is None:
                return default
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode()
            try:
                return float(raw)
            except Exception:
                return default

        def _get_str(field, default=""):
            raw = bucket.get(field if isinstance(field, bytes) else str(field).encode())
            if raw is None:
                return default
            if isinstance(raw, (bytes, bytearray)):
                return raw.decode()
            return str(raw)

        balance = _get_num("balance", 0.0)
        credit_limit = _get_num("credit_limit", 0.0)
        daily_quota = int(_get_num("daily_quota", 0))
        daily_used = int(_get_num("daily_used", 0))
        daily_date = _get_str("daily_date", "")
        monthly_quota = int(_get_num("monthly_quota", 0))
        monthly_used = int(_get_num("monthly_used", 0))
        monthly_month = _get_str("monthly_month", "")
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
        if new_daily_used > daily_quota:
            return [0, "DAILY_QUOTA_EXCEEDED", daily_quota, daily_used]

        if monthly_month != month:
            monthly_used = 0
            monthly_month = month
        new_monthly_used = monthly_used + monthly_requests
        if new_monthly_used > monthly_quota:
            return [0, "MONTHLY_QUOTA_EXCEEDED", monthly_quota, monthly_used]

        new_balance = balance - amount
        bucket[b"balance"] = str(new_balance)
        bucket[b"daily_used"] = str(new_daily_used)
        bucket[b"daily_date"] = daily_date
        bucket[b"monthly_used"] = str(new_monthly_used)
        bucket[b"monthly_month"] = monthly_month
        bucket[b"version"] = str(version + 1)
        return [1, "OK", new_balance, new_daily_used, new_monthly_used, version + 1]

    async def eval(self, script, numkeys, *keys_and_args):
        keys = list(keys_and_args[:numkeys])
        args = list(keys_and_args[numkeys:])
        if "HGET" in script or "HSET" in script:
            if not keys or not args:
                return 0
            key = keys[0]
            bucket = self.hash_store.get(key)
            if not bucket:
                return 0
            balance_raw = bucket.get(b"balance")
            if balance_raw is None:
                return 0
            if isinstance(balance_raw, (bytes, bytearray)):
                try:
                    balance_val = float(balance_raw.decode())
                except Exception:
                    balance_val = 0.0
            else:
                try:
                    balance_val = float(balance_raw)
                except Exception:
                    balance_val = 0.0
            try:
                diff = float(args[0])
            except Exception:
                diff = 0.0
            new_balance = balance_val - diff
            bucket[b"balance"] = str(new_balance)
            version_raw = bucket.get(b"version")
            if version_raw is not None:
                if isinstance(version_raw, (bytes, bytearray)):
                    try:
                        version_val = int(float(version_raw.decode()))
                    except Exception:
                        version_val = 0
                else:
                    try:
                        version_val = int(float(version_raw))
                    except Exception:
                        version_val = 0
                bucket[b"version"] = str(version_val + 1)
            return 1

        if not keys:
            return 0
        key = keys[0]
        if "expire" in script:
            if len(args) < 2:
                return 0
            lock_val = str(args[0])
            stored = self.store.get(key)
            if stored is None:
                return 0
            stored_val = stored.decode() if isinstance(stored, (bytes, bytearray)) else str(stored)
            if stored_val != lock_val:
                return 0
            return 1

        if not args:
            return 0
        lock_val = str(args[0])
        stored = self.store.get(key)
        if stored is None:
            return 0
        stored_val = stored.decode() if isinstance(stored, (bytes, bytearray)) else str(stored)
        if stored_val != lock_val:
            return 0
        await self.delete(key)
        return 1

    async def zremrangebyscore(self, key: str, min_score, max_score):
        items = self.zset_store.get(key, [])
        self.zset_store[key] = [(m, s) for (m, s) in items if s < min_score or s > max_score]
        return True

    async def zcard(self, key: str):
        return len(self.zset_store.get(key, []))

    async def zadd(self, key: str, mapping: dict[str, float]):
        items = self.zset_store.setdefault(key, [])
        filtered = [(m, s) for (m, s) in items if m not in mapping]
        for member, score in mapping.items():
            filtered.append((member, float(score)))
        self.zset_store[key] = filtered
        return True

    async def hset(self, key: str, mapping: dict):
        bucket = self.hash_store.setdefault(key, {})
        for k, v in mapping.items():
            bucket[k if isinstance(k, bytes) else str(k).encode()] = v
        return True

    async def rpush(self, key: str, *values):
        lst = self.store.setdefault(key, [])
        if not isinstance(lst, list):
            lst = []
        lst.extend(values)
        self.store[key] = lst
        return len(lst)

    async def lrange(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return []
        # emulate Redis end inclusive
        if end == -1:
            end = len(lst) - 1
        return lst[start : end + 1]

    async def ltrim(self, key: str, start: int, end: int):
        lst = self.store.get(key, [])
        if not isinstance(lst, list):
            return True
        if end == -1:
            end = len(lst) - 1
        self.store[key] = lst[start : end + 1]
        return True

    async def hgetall(self, key: str):
        return self.hash_store.get(key, {}).copy()

    async def hget(self, key: str, field: str):
        bucket = self.hash_store.get(key, {})
        return bucket.get(field if isinstance(field, bytes) else str(field).encode())

# 将 CacheService 指向内存 Redis
cache._redis = DummyRedis()  # type: ignore[attr-defined]
BANNED_USER_ID: str | None = None
_SEEDED = False


import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def _reset_dummy_redis():
    """每个测试前清空内存 Redis，避免状态串扰（如封禁标记影响刷新）。"""
    if hasattr(cache, "_redis") and hasattr(cache._redis, "flushall"):
        await cache._redis.flushall()  # type: ignore[attr-defined]
    yield

# ---- 内存 SQLite 引擎 ----

engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


@pytest.fixture(name="AsyncSessionLocal")
def _async_session_local_fixture():
    return AsyncSessionLocal


async def _init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _seed_users():
    """种子用户：管理员、普通用户、未激活用户、封禁用户"""
    global BANNED_USER_ID, _SEEDED
    if _SEEDED:
        return
    async with AsyncSessionLocal() as session:
        def add_user(email, username, password, is_active=True, is_superuser=False):
            user = User(
                id=uuid4(),
                email=email,
                username=username,
                hashed_password=get_password_hash(password),
                is_active=is_active,
                is_superuser=is_superuser,
            )
            session.add(user)
            return user

        admin = add_user("admin@example.com", "Admin", "testPassword123", True, True)
        test_user = add_user("testuser@example.com", "Test User", "testPassword123", True, False)
        inactive = add_user("inactive@example.com", "Inactive", "testPassword123", False, False)
        banned = add_user("banned@example.com", "Banned", "testPassword123", True, False)
        pending = add_user("pending@example.com", "Pending", "testPassword123", False, False)
        reset_user = add_user("resetuser@example.com", "ResetUser", "testPassword123", True, False)

        await session.commit()

        # 预置验证码
        await cache.set(CacheKeys.verify_code("pending@example.com", "activate"), "123456", ex=600)
        await cache.set(CacheKeys.verify_code("resetuser@example.com", "reset_password"), "654321", ex=600)
        # 统一登录验证码，便于测试
        for email in [
            "admin@example.com",
            "testuser@example.com",
            "inactive@example.com",
            "banned@example.com",
            "pending@example.com",
            "resetuser@example.com",
        ]:
            await cache.set(CacheKeys.verify_code(email, "login"), "123456", ex=600)

        # 预置封禁
        BANNED_USER_ID = str(banned.id)
        await cache.set(f"auth:ban:{BANNED_USER_ID}", {"reason": "banned"}, ex=None)
        _SEEDED = True


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture(scope="session")
def event_loop():
    """独立事件循环，避免与 pytest 默认循环冲突"""
    loop = asyncio.new_event_loop()
    yield loop
    try:
        try:
            loop.run_until_complete(asyncio.wait_for(engine.dispose(), timeout=5))
        except Exception:
            pass
        # 关闭缓存连接（若为 redis asyncio 客户端）
        try:
            loop.run_until_complete(asyncio.wait_for(cache.close(), timeout=5))
        except Exception:
            pass
        # 确保异步生成器与后台任务优雅收尾，避免 pytest 卡住退出
        try:
            loop.run_until_complete(asyncio.wait_for(loop.shutdown_asyncgens(), timeout=5))
        except Exception:
            pass
    finally:
        asyncio.set_event_loop(None)
        loop.close()


def pytest_sessionfinish(session, exitstatus):  # type: ignore[unused-argument]
    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(asyncio.wait_for(engine.dispose(), timeout=5))
        loop.close()
    except Exception:
        pass


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_db():
    await _init_db()
    await _seed_users()
    # 覆盖依赖
    app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture
async def client(setup_db) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ============ Fixtures ============#

@pytest_asyncio.fixture
async def admin_tokens(client: AsyncClient) -> dict:
    await client.post(
        "/api/v1/auth/login/code",
        json={"email": "admin@example.com"},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "code": "123456"},
    )
    assert resp.status_code == 200
    data = resp.json()
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}


@pytest_asyncio.fixture
async def auth_tokens(client: AsyncClient) -> dict:
    await client.post(
        "/api/v1/auth/login/code",
        json={"email": "testuser@example.com"},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "testuser@example.com", "code": "123456"},
    )
    assert resp.status_code == 200
    data = resp.json()
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}


@pytest_asyncio.fixture
async def test_user() -> dict:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(User).where(User.email == "testuser@example.com"))
        user = res.scalar_one_or_none()
        return {"id": str(user.id) if user else None, "email": "testuser@example.com", "password": "testPassword123"}


@pytest_asyncio.fixture
async def inactive_user() -> dict:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(User).where(User.email == "inactive@example.com"))
        user = res.scalar_one_or_none()
        return {"id": str(user.id) if user else None, "email": "inactive@example.com", "password": "testPassword123"}


@pytest_asyncio.fixture
async def banned_user() -> dict:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(User).where(User.email == "banned@example.com"))
        user = res.scalar_one_or_none()
        return {"id": str(user.id) if user else None, "email": "banned@example.com", "password": "testPassword123"}


@pytest_asyncio.fixture
async def banned_user_tokens(client: AsyncClient, banned_user: dict) -> dict:
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": banned_user["email"], "code": "123456"},
    )
    data = resp.json() if resp.status_code == 200 else {}
    return {"access_token": data.get("access_token", ""), "refresh_token": data.get("refresh_token", "")}


@pytest_asyncio.fixture(autouse=True)
async def reset_cache_between_tests():
    # 清除缓存，重置封禁、验证码等状态
    if isinstance(cache._redis, DummyRedis):  # type: ignore[attr-defined]
        cache._redis.store.clear()  # type: ignore[attr-defined]
    # 重新放入默认封禁
    if BANNED_USER_ID:
        await cache.set(f"auth:ban:{BANNED_USER_ID}", {"reason": "banned"}, ex=None)
    await cache.set(CacheKeys.verify_code("pending@example.com", "activate"), "123456", ex=600)
    await cache.set(CacheKeys.verify_code("resetuser@example.com", "reset_password"), "654321", ex=600)
    for email in [
        "admin@example.com",
        "testuser@example.com",
        "inactive@example.com",
        "banned@example.com",
        "pending@example.com",
        "resetuser@example.com",
    ]:
        await cache.set(CacheKeys.verify_code(email, "login"), "123456", ex=600)


@pytest_asyncio.fixture
async def pending_activation_user() -> dict:
    return {"email": "pending@example.com", "activation_code": "123456", "password": "testPassword123"}


@pytest_asyncio.fixture
async def user_with_reset_code() -> dict:
    return {"email": "resetuser@example.com", "reset_code": "654321", "password": "testPassword123"}


@pytest_asyncio.fixture
async def user_with_role(test_role: dict) -> dict:
    async with AsyncSessionLocal() as session:
        # 拿到已存在的 role
        from uuid import UUID

        from app.models import Role, UserRole
        res_role = await session.execute(select(Role).where(Role.id == UUID(test_role["id"])))
        role = res_role.scalar_one()
        # 创建/获取用户
        res_user = await session.execute(select(User).where(User.email == "withrole@example.com"))
        user = res_user.scalar_one_or_none()
        if not user:
            user = User(
                id=uuid4(),
                email="withrole@example.com",
                username="WithRole",
                hashed_password=get_password_hash("testPassword123"),
                is_active=True,
                is_superuser=False,
            )
            session.add(user)
            await session.flush()
        # 绑定角色（若未绑定）
        res_link = await session.execute(
            select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role.id)
        )
        if not res_link.scalar_one_or_none():
            session.add(UserRole(user_id=user.id, role_id=UUID(test_role["id"])))
        await session.commit()
        return {"id": str(user.id), "email": "withrole@example.com", "password": "testPassword123"}


@pytest_asyncio.fixture
async def test_role() -> dict:
    async with AsyncSessionLocal() as session:
        from app.models import Role
        # 若已存在同名角色，直接返回该记录
        res = await session.execute(select(Role).where(Role.name == "Test Role"))
        role = res.scalar_one_or_none()
        if not role:
            role = Role(id=uuid4(), name="Test Role", description="A test role")
            session.add(role)
            await session.commit()
        return {"id": str(role.id), "name": role.name, "description": role.description or "A test role"}
