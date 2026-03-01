import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import User
from app.models.user_notification_channel import NotificationChannel, UserNotificationChannel
from app.services.notifications.base import NotificationResult, NotificationSenderRegistry
from app.services.notifications.user_notification_service import UserNotificationService


@pytest_asyncio.fixture
async def async_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_local = async_sessionmaker(engine, expire_on_commit=False)
    async with session_local() as sess:
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
async def test_notify_user_respects_channel_ids_filter(
    async_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    user = await _create_user(async_session, "notify_filter@example.com")

    feishu = UserNotificationChannel(
        user_id=user.id,
        channel=NotificationChannel.FEISHU,
        config={"webhook_url": "https://hooks.feishu.test"},
        priority=1,
        is_active=True,
    )
    webhook = UserNotificationChannel(
        user_id=user.id,
        channel=NotificationChannel.WEBHOOK,
        config={"webhook_url": "https://hooks.webhook.test"},
        priority=2,
        is_active=True,
    )
    async_session.add_all([feishu, webhook])
    await async_session.commit()

    sent_channels: list[NotificationChannel] = []

    class _DummySender:
        def __init__(self, channel: NotificationChannel):
            self.channel = channel

        async def validate_config(self, config):
            return True, None

        async def send(self, user_channel_config, content):
            sent_channels.append(self.channel)
            return NotificationResult(success=True, channel=self.channel, message="ok")

    monkeypatch.setattr(
        NotificationSenderRegistry,
        "get_sender",
        classmethod(lambda cls, channel: _DummySender(channel)),
    )

    service = UserNotificationService(async_session)
    results = await service.notify_user(
        user_id=user.id,
        title="title",
        content="content",
        channel_ids=[webhook.id],
    )

    assert len(results) == 1
    assert results[0].success is True
    assert results[0].channel == NotificationChannel.WEBHOOK
    assert sent_channels == [NotificationChannel.WEBHOOK]


@pytest.mark.asyncio
async def test_notify_user_can_send_all_selected_channels(
    async_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    user = await _create_user(async_session, "notify_all_selected@example.com")

    feishu = UserNotificationChannel(
        user_id=user.id,
        channel=NotificationChannel.FEISHU,
        config={"webhook_url": "https://hooks.feishu.test"},
        priority=1,
        is_active=True,
    )
    webhook = UserNotificationChannel(
        user_id=user.id,
        channel=NotificationChannel.WEBHOOK,
        config={"webhook_url": "https://hooks.webhook.test"},
        priority=2,
        is_active=True,
    )
    async_session.add_all([feishu, webhook])
    await async_session.commit()

    sent_channels: list[NotificationChannel] = []

    class _DummySender:
        def __init__(self, channel: NotificationChannel):
            self.channel = channel

        async def validate_config(self, config):
            return True, None

        async def send(self, user_channel_config, content):
            sent_channels.append(self.channel)
            return NotificationResult(success=True, channel=self.channel, message="ok")

    monkeypatch.setattr(
        NotificationSenderRegistry,
        "get_sender",
        classmethod(lambda cls, channel: _DummySender(channel)),
    )

    service = UserNotificationService(async_session)
    results = await service.notify_user(
        user_id=user.id,
        title="title",
        content="content",
        channel_ids=[feishu.id, webhook.id],
        stop_on_success=False,
    )

    assert len(results) == 2
    assert [result.channel for result in results] == [
        NotificationChannel.FEISHU,
        NotificationChannel.WEBHOOK,
    ]
    assert sent_channels == [NotificationChannel.FEISHU, NotificationChannel.WEBHOOK]
