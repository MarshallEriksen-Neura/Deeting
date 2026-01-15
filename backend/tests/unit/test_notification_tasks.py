import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.notification import Notification, NotificationReceipt, NotificationLevel, NotificationType
from app.models.user import User
from app.tasks import notification as notification_tasks
from app.tasks.notification import (
    publish_notification_to_all_users_task,
    publish_notification_to_user_task,
)


@pytest.fixture()
def sync_session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    try:
        yield SessionLocal
    finally:
        engine.dispose()


def _seed_user(session: Session, email: str, is_active: bool = True) -> User:
    user = User(
        email=email,
        username="tester",
        hashed_password="hashed",
        is_active=is_active,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _seed_notification(session: Session) -> Notification:
    notification = Notification(
        type=NotificationType.SYSTEM,
        level=NotificationLevel.INFO,
        title="Test",
        content="Hello",
        payload={},
        is_active=True,
    )
    session.add(notification)
    session.commit()
    session.refresh(notification)
    return notification


def test_publish_notification_to_user_task(sync_session_factory, monkeypatch):
    SessionLocal = sync_session_factory
    seed_session = SessionLocal()
    user = _seed_user(seed_session, "task_user@example.com")
    notification = _seed_notification(seed_session)
    seed_session.close()

    task_session = SessionLocal()
    monkeypatch.setattr(notification_tasks, "get_sync_db", lambda: iter([task_session]))

    result = publish_notification_to_user_task(str(notification.id), str(user.id))
    assert "Inserted receipts" in result

    check_session = SessionLocal()
    count = check_session.execute(select(NotificationReceipt)).scalars().all()
    assert len(count) == 1
    check_session.close()


def test_publish_notification_to_all_users_task(sync_session_factory, monkeypatch):
    SessionLocal = sync_session_factory
    seed_session = SessionLocal()
    _seed_user(seed_session, "task_user_active@example.com", is_active=True)
    _seed_user(seed_session, "task_user_inactive@example.com", is_active=False)
    notification = _seed_notification(seed_session)
    seed_session.close()

    task_session = SessionLocal()
    monkeypatch.setattr(notification_tasks, "get_sync_db", lambda: iter([task_session]))

    result = publish_notification_to_all_users_task(str(notification.id), True, 200)
    assert "Inserted receipts" in result

    check_session = SessionLocal()
    rows = check_session.execute(select(NotificationReceipt)).scalars().all()
    assert len(rows) == 1
    check_session.close()
