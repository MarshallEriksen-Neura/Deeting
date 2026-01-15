import asyncio
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import User
from app.services.notifications.notification_service import NotificationService


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="module")
async def async_session() -> AsyncSession:
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


async def _create_user(session: AsyncSession, email: str, is_active: bool = True) -> User:
    user = User(
        email=email,
        username="tester",
        hashed_password="hashed",
        is_active=is_active,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_publish_to_user_schedules_task(async_session: AsyncSession):
    user = await _create_user(async_session, "notify_user@example.com")
    service = NotificationService(async_session)

    with patch("app.tasks.notification.publish_notification_to_user_task.delay") as mock_delay:
        notification = await service.publish_to_user(
            user_id=user.id,
            title="Test",
            content="Hello",
        )

    assert notification.id is not None
    assert mock_delay.called
    args, _ = mock_delay.call_args
    assert args[0] == str(notification.id)
    assert args[1] == str(user.id)


@pytest.mark.asyncio
async def test_publish_to_all_schedules_task(async_session: AsyncSession):
    await _create_user(async_session, "notify_all@example.com")
    service = NotificationService(async_session)

    with patch("app.tasks.notification.publish_notification_to_all_users_task.delay") as mock_delay:
        notification = await service.publish_to_all(
            title="Global",
            content="All users",
        )

    assert notification.id is not None
    assert mock_delay.called
    args, _ = mock_delay.call_args
    assert args[0] == str(notification.id)
    assert args[1] is True
