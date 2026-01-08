from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

# 转换 DATABASE_URL 为同步驱动
# 例如: postgresql+asyncpg -> postgresql+psycopg2
# 或者 sqlite+aiosqlite -> sqlite
sync_database_url = settings.DATABASE_URL
if "postgresql+asyncpg" in sync_database_url:
    sync_database_url = sync_database_url.replace("postgresql+asyncpg", "postgresql+psycopg2")
elif "sqlite+aiosqlite" in sync_database_url:
    sync_database_url = sync_database_url.replace("sqlite+aiosqlite", "sqlite")
elif "+asyncpg" in sync_database_url: # Generic fallback for other variations
    sync_database_url = sync_database_url.replace("+asyncpg", "")

# 创建同步引擎
# 注意：Celery worker 是多进程模型，每个进程会创建自己的 Engine
engine = create_engine(
    sync_database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=False, # Celery 日志中尽量少打 SQL
)

# 创建同步 Session 工厂
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)

def get_sync_db() -> Generator[Session, None, None]:
    """
    获取同步数据库 Session (用于 Celery 任务)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
