"""
测试配置与 fixtures（API 层）

- 使用内存 SQLite (aiosqlite) 运行真实业务逻辑
- 覆盖 get_db 依赖，避免连接真实 PostgreSQL
- 用内存 Redis 替身挂载到 CacheService
- 通过登录接口获取真实 JWT 作为测试 token
"""
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

from app.core.cache import cache
from app.core.database import get_db
from app.models import Base, User
from app.utils.security import get_password_hash
from main import app

# ---- 内存 Redis 替身 ----

class DummyRedis:
    def __init__(self):
        self.store: dict[str, bytes] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex=None):
        self.store[key] = value
        return True

    async def delete(self, *keys):
        cnt = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                cnt += 1
        return cnt

    async def keys(self, pattern: str):
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            return [k for k in self.store if k.startswith(prefix)]
        return [k for k in self.store if k == pattern]

    async def exists(self, *keys):
        return sum(1 for k in keys if k in self.store)

    async def flushall(self):
        self.store.clear()

# 将 CacheService 指向内存 Redis
cache._redis = DummyRedis()  # type: ignore[attr-defined]
BANNED_USER_ID: str | None = None


@pytest.fixture(autouse=True)
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


async def _init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _seed_users():
    """种子用户：管理员、普通用户、未激活用户、封禁用户"""
    global BANNED_USER_ID
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
        await cache.set("auth:verify:pending@example.com:activate", "123456", ex=600)
        await cache.set("auth:verify:resetuser@example.com:reset_password", "654321", ex=600)

        # 预置封禁
        BANNED_USER_ID = str(banned.id)
        await cache.set(f"auth:ban:{BANNED_USER_ID}", {"reason": "banned"}, ex=None)


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture(scope="session")
def event_loop():
    """独立事件循环，避免与 pytest 默认循环冲突"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


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
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "testPassword123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}


@pytest_asyncio.fixture
async def auth_tokens(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "testuser@example.com", "password": "testPassword123"},
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
        json={"email": banned_user["email"], "password": banned_user["password"]},
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
    await cache.set("auth:verify:pending@example.com:activate", "123456", ex=600)
    await cache.set("auth:verify:resetuser@example.com:reset_password", "654321", ex=600)


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
