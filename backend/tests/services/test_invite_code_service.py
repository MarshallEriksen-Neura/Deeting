import asyncio
import pytest
import pytest_asyncio
from datetime import datetime, timedelta, UTC

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.invite_code import InviteCodeStatus
from app.services.users.invite_code_service import InviteCodeService
from app.repositories import InviteCodeRepository
from app.services.users.registration_window_service import create_registration_window


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


@pytest.mark.asyncio
async def test_invite_consume_and_finalize(async_session):
    now = datetime.now(UTC)
    window = await create_registration_window(
        async_session,
        start_time=now - timedelta(minutes=1),
        end_time=now + timedelta(hours=1),
        max_registrations=1,
        auto_activate=True,
    )
    repo = InviteCodeRepository(async_session)
    service = InviteCodeService(repo)
    codes = await service.issue(window.id, count=1, length=8)
    code = codes[0].code

    window_used = await service.consume(code)
    assert window_used.id == window.id

    await service.finalize(code, user_id=window.id)  # reuse window.id for UUID placeholder
    updated = await repo.get_by_code(code)
    assert updated.status == InviteCodeStatus.USED


@pytest.mark.asyncio
async def test_invite_expired(async_session):
    now = datetime.now(UTC)
    window = await create_registration_window(
        async_session,
        start_time=now - timedelta(minutes=1),
        end_time=now + timedelta(hours=1),
        max_registrations=1,
        auto_activate=True,
    )
    repo = InviteCodeRepository(async_session)
    service = InviteCodeService(repo)
    codes = await service.issue(window.id, count=1, length=8, expires_at=now - timedelta(seconds=10))
    code = codes[0].code

    with pytest.raises(Exception):
        await service.consume(code)


@pytest.mark.asyncio
async def test_invite_quota_exhaust(async_session):
    now = datetime.now(UTC)
    window = await create_registration_window(
        async_session,
        start_time=now - timedelta(minutes=1),
        end_time=now + timedelta(hours=1),
        max_registrations=1,
        auto_activate=True,
    )
    repo = InviteCodeRepository(async_session)
    service = InviteCodeService(repo)
    codes = await service.issue(window.id, count=2, length=8)

    # consume first
    await service.consume(codes[0].code)
    # window quota now 0, second should fail
    with pytest.raises(Exception):
        await service.consume(codes[1].code)
