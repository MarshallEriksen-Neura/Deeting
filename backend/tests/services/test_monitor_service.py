import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from uuid import uuid4

from app.models import Base
from app.models.monitor import MonitorExecutionLog, MonitorStatus, MonitorTask
from app.models.user import User
from app.repositories.monitor_repository import MonitorTaskRepository
from app.services.monitor_service import MonitorService
from app.utils.time_utils import Datetime


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
async def test_create_monitor_task(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user@example.com")
    service = MonitorService(async_session)

    result = await service.create_task(
        user_id=user.id,
        title="测试监控",
        objective="监控目标变化",
        cron_expr="0 */6 * * *",
    )

    assert result["title"] == "测试监控"
    assert result["status"] == "active"


@pytest.mark.asyncio
async def test_create_duplicate_title_fails(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user2@example.com")
    service = MonitorService(async_session)

    await service.create_task(
        user_id=user.id,
        title="唯一监控",
        objective="监控目标",
    )

    with pytest.raises(ValueError, match="已存在"):
        await service.create_task(
            user_id=user.id,
            title="唯一监控",
            objective="监控目标",
        )


@pytest.mark.asyncio
async def test_invalid_cron_fails(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user_cron@example.com")
    service = MonitorService(async_session)

    with pytest.raises(ValueError, match="Cron 表达式非法"):
        await service.create_task(
            user_id=user.id,
            title="非法 Cron",
            objective="监控目标",
            cron_expr="not-a-cron",
        )


@pytest.mark.asyncio
async def test_get_user_tasks(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user3@example.com")
    service = MonitorService(async_session)

    await service.create_task(user_id=user.id, title="监控1", objective="目标1")
    await service.create_task(user_id=user.id, title="监控2", objective="目标2")

    result = await service.get_user_tasks(user.id)
    assert result["total"] == 2
    assert len(result["items"]) == 2


@pytest.mark.asyncio
async def test_pause_and_resume_task(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user4@example.com")
    service = MonitorService(async_session)

    task = await service.create_task(
        user_id=user.id,
        title="暂停测试",
        objective="测试暂停",
    )

    task_id = task["id"]
    await service.pause_task(task_id, user.id)

    updated = await service.get_task(task_id)
    assert updated["status"] == "paused"

    await service.resume_task(task_id, user.id)
    updated = await service.get_task(task_id)
    assert updated["status"] == "active"


@pytest.mark.asyncio
async def test_delete_task(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user5@example.com")
    service = MonitorService(async_session)

    task = await service.create_task(
        user_id=user.id,
        title="删除测试",
        objective="测试删除",
    )

    task_id = task["id"]
    await service.delete_task(task_id, user.id)

    deleted = await service.get_task(task_id)
    assert deleted["is_active"] is False


@pytest.mark.asyncio
async def test_update_task(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user6@example.com")
    service = MonitorService(async_session)

    task = await service.create_task(
        user_id=user.id,
        title="更新测试",
        objective="原始目标",
    )

    task_id = task["id"]
    await service.update_task(
        task_id,
        user.id,
        title="新标题",
        objective="新目标",
    )

    updated = await service.get_task(task_id)
    assert updated["title"] == "新标题"
    assert updated["objective"] == "新目标"


@pytest.mark.asyncio
async def test_get_task_stats(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user7@example.com")
    service = MonitorService(async_session)

    await service.create_task(user_id=user.id, title="任务1", objective="目标1")
    await service.create_task(user_id=user.id, title="任务2", objective="目标2")

    task = await service.create_task(user_id=user.id, title="任务3", objective="目标3")
    await service.pause_task(task["id"], user.id)

    stats = await service.get_task_stats(user.id)
    assert stats["total_tasks"] == 3
    assert stats["active_tasks"] == 2
    assert stats["paused_tasks"] == 1


@pytest.mark.asyncio
async def test_get_task_stats_counts_execution_logs(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user_stats_logs@example.com")
    service = MonitorService(async_session)

    t1 = await service.create_task(user_id=user.id, title="日志任务1", objective="目标1")
    t2 = await service.create_task(user_id=user.id, title="日志任务2", objective="目标2")

    async_session.add(
        MonitorExecutionLog(
            task_id=t1["id"],
            triggered_at=Datetime.now(),
            status="success",
            tokens_used=10,
        )
    )
    async_session.add(
        MonitorExecutionLog(
            task_id=t2["id"],
            triggered_at=Datetime.now(),
            status="failure",
            tokens_used=0,
            error_message="boom",
        )
    )
    await async_session.commit()

    stats = await service.get_task_stats(user.id)
    assert stats["total_tasks"] == 2
    assert stats["total_executions"] == 2


@pytest.mark.asyncio
async def test_get_execution_logs_serializes_items(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_user_execution_logs@example.com")
    service = MonitorService(async_session)

    created = await service.create_task(user_id=user.id, title="日志序列化任务", objective="目标")
    task_id = created["id"]

    async_session.add(
        MonitorExecutionLog(
            task_id=task_id,
            triggered_at=Datetime.now(),
            status="success",
            input_data={"foo": "bar"},
            output_data={"summary": "ok"},
            tokens_used=12,
        )
    )
    await async_session.commit()

    result = await service.get_execution_logs(task_id, skip=0, limit=10)
    assert result["total"] == 1
    assert len(result["items"]) == 1
    assert isinstance(result["items"][0], dict)
    assert result["items"][0]["task_id"] == task_id
    assert result["items"][0]["status"] == "success"
    assert result["items"][0]["tokens_used"] == 12


@pytest.mark.asyncio
async def test_unauthorized_access_fails(async_session: AsyncSession):
    user1 = await _create_user(async_session, "user1@example.com")
    user2 = await _create_user(async_session, "user2@example.com")
    service = MonitorService(async_session)

    task = await service.create_task(
        user_id=user1.id,
        title="用户1的任务",
        objective="目标",
    )

    with pytest.raises(ValueError, match="无权限"):
        await service.pause_task(task["id"], user2.id)


@pytest.mark.asyncio
async def test_repository_get_active_tasks(async_session: AsyncSession):
    user = await _create_user(async_session, "repo_user@example.com")
    repo = MonitorTaskRepository(async_session)

    task1 = MonitorTask(
        user_id=user.id,
        title="活跃任务",
        objective="目标1",
        cron_expr="0 */6 * * *",
        status=MonitorStatus.ACTIVE,
    )
    task2 = MonitorTask(
        user_id=user.id,
        title="暂停任务",
        objective="目标2",
        cron_expr="0 */6 * * *",
        status=MonitorStatus.PAUSED,
    )
    async_session.add(task1)
    async_session.add(task2)
    await async_session.commit()

    active_tasks = await repo.get_active_tasks()
    active_titles = [t.title for t in active_tasks]
    assert "活跃任务" in active_titles


@pytest.mark.asyncio
async def test_create_task_encrypts_notify_config_and_redacts_in_response(
    async_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    user = await _create_user(async_session, "monitor_secure_notify@example.com")
    service = MonitorService(async_session)

    async def _fake_spawn(*args, **kwargs):
        return uuid4()

    async def _fake_store(provider: str, raw_secret: str, db_session):
        assert provider == "monitor_notify"
        assert raw_secret == "https://hooks.example.com/abc"
        return "db:monitor-secret-ref"

    monkeypatch.setattr(service, "_spawn_insight_assistant", _fake_spawn)
    monkeypatch.setattr(service.secret_manager, "store", _fake_store)

    created = await service.create_task(
        user_id=user.id,
        title="加密通知配置",
        objective="检查敏感配置是否加密",
        notify_config={
            "channel": "feishu",
            "webhook_url": "https://hooks.example.com/abc",
        },
    )

    task = await service.task_repo.get(created["id"])
    assert task is not None
    assert task.notify_config["webhook_url"] == "db:monitor-secret-ref"

    detail = await service.get_task(created["id"])
    assert detail is not None
    assert detail["notify_config"]["channel"] == "feishu"
    assert detail["notify_config"]["webhook_url"] == "***"


@pytest.mark.asyncio
async def test_create_task_rejects_invalid_allowed_tools(async_session: AsyncSession):
    user = await _create_user(async_session, "monitor_allowed_tools_invalid@example.com")
    service = MonitorService(async_session)

    with pytest.raises(ValueError, match="allowed_tools 含非法工具名"):
        await service.create_task(
            user_id=user.id,
            title="非法工具白名单",
            objective="测试白名单校验",
            allowed_tools=["valid_tool", "bad tool name"],
        )
