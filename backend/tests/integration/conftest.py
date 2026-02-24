import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from app.models import Base, User

# 1. 建立集成测试专用引擎
engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    future=True,
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)

@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_integration_db(monkeypatch_session):
    # 强制将全局 database 工厂替换为测试用的
    import app.core.database
    import app.services.tools.tool_sync_service
    
    # 注意：这里需要替换 service 内部可能引用的地方
    monkeypatch_session.setattr("app.core.database.AsyncSessionLocal", AsyncSessionLocal)
    # tool_sync_service 内部直接 import 了 AsyncSessionLocal
    monkeypatch_session.setattr("app.services.tools.tool_sync_service.AsyncSessionLocal", AsyncSessionLocal)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Seed
    async with AsyncSessionLocal() as session:
        user = User(
            email="testuser@example.com",
            username="testuser",
            hashed_password="...",
            is_active=True
        )
        session.add(user)
        await session.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture(scope="module")
def monkeypatch_session():
    from _pytest.monkeypatch import MonkeyPatch
    m = MonkeyPatch()
    yield m
    m.undo()

@pytest_asyncio.fixture
async def db_session():
    async with AsyncSessionLocal() as session:
        yield session

@pytest_asyncio.fixture
async def current_user_obj(db_session):
    res = await db_session.execute(
        select(User).where(User.email == "testuser@example.com")
    )
    return res.scalar_one()
