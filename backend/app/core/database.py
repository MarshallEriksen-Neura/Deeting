from collections.abc import AsyncGenerator, Generator
from contextlib import contextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db_sync import SessionLocal as SyncSessionLocal

# 创建异步引擎
_db_url = settings.DATABASE_URL
_engine_kwargs = {
    "echo": settings.DEBUG,
    "future": True,
    # 连接池配置（仅非 sqlite 场景启用）
    "pool_pre_ping": True,
}
if not _db_url.startswith("sqlite"):
    _engine_kwargs.update(pool_size=20, max_overflow=10)

engine = create_async_engine(_db_url, **_engine_kwargs)

# 创建异步 Session 工厂
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI 依赖项: 获取数据库 Session
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


@contextmanager
def get_sync_session() -> Generator[Session, None, None]:
    """
    获取同步数据库 Session (用于 Celery 任务)
    """
    session = SyncSessionLocal()
    try:
        yield session
    finally:
        session.close()
