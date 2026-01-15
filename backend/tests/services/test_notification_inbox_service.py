import asyncio

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import User
from app.services.notifications.notification_inbox_service import NotificationInboxService
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


async def _create_user(session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        username="tester",
        hashed_password="hashed",
        is_active=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_inbox_snapshot_and_read_flow(async_session: AsyncSession):
    user = await _create_user(async_session, "inbox_user@example.com")
    publisher = NotificationService(async_session)
    inbox = NotificationInboxService(async_session)

    await publisher.publish_to_user(
        user_id=user.id,
        title="Welcome",
        content="Hello",
        enqueue=False,
    )
    await publisher.publish_to_user(
        user_id=user.id,
        title="Second",
        content="World",
        enqueue=False,
    )

    items, unread_count, last_seen_at = await inbox.fetch_snapshot(user.id, limit=10)
    assert len(items) == 2
    assert unread_count == 2
    assert last_seen_at is not None

    updated = await inbox.mark_read(user.id, items[0].notification_id)
    assert updated == 1
    unread_count = await inbox.get_unread_count(user.id)
    assert unread_count == 1


@pytest.mark.asyncio
async def test_inbox_since_and_clear(async_session: AsyncSession):
    user = await _create_user(async_session, "inbox_clear@example.com")
    publisher = NotificationService(async_session)
    inbox = NotificationInboxService(async_session)

    await publisher.publish_to_user(
        user_id=user.id,
        title="First",
        content="One",
        enqueue=False,
    )
    snapshot, _, last_seen_at = await inbox.fetch_snapshot(user.id, limit=10)
    assert len(snapshot) == 1
    assert last_seen_at is not None

    await publisher.publish_to_user(
        user_id=user.id,
        title="Second",
        content="Two",
        enqueue=False,
    )

    new_items, new_last_seen = await inbox.fetch_since(
        user.id,
        since=last_seen_at,
        limit=10,
    )
    assert len(new_items) == 1
    assert new_last_seen is not None

    cleared = await inbox.clear_all(user.id)
    assert cleared >= 1
    items, unread_count, _ = await inbox.fetch_snapshot(user.id, limit=10)
    assert items == []
    assert unread_count == 0
