"""
集成测试专用 fixture

- 复用 API 测试的内存 SQLite/Redis，避免依赖真实数据库
- 强制路由步骤使用兜底逻辑，避免因缺少预置上游导致流程中断
"""
from collections.abc import AsyncGenerator

import pytest_asyncio

from tests.api.conftest import (
    AsyncSessionLocal,
    _init_db,
    _seed_users,
    _override_get_db,
)
from app.core.database import get_db
from app.services.workflow.steps.routing import RoutingStep
from app.services.workflow.steps.quota_check import QuotaCheckStep
from app.services.workflow.steps.base import StepResult, StepStatus
from main import app


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _init_integration_db():
    await _init_db()
    await _seed_users()
    app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(autouse=True)
async def _force_routing_fallback(monkeypatch):
    """
    集成测试不关心真实上游路由，强制走 fallback，避免 NoAvailableUpstream。
    """

    async def fake_execute(self: RoutingStep, ctx) -> StepResult:
        ctx.set("routing", "allow_fallback", True)
        return self._fallback(ctx)

    monkeypatch.setattr(RoutingStep, "execute", fake_execute)

    async def quota_skip(self: QuotaCheckStep, ctx):
        return StepResult(status=StepStatus.SUCCESS)

    monkeypatch.setattr(QuotaCheckStep, "execute", quota_skip)
    yield
