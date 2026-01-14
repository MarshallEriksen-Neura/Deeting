"""
注册窗口控制（异步版）

功能：
- 创建/关闭注册窗口
- 查询当前可用窗口
- 申请/回滚注册名额（用于自动注册流程）
"""
from __future__ import annotations

from datetime import UTC, datetime
from app.utils.time_utils import Datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import RegistrationWindow, RegistrationWindowStatus


class RegistrationWindowError(Exception):
    """Base error for registration window operations."""


class RegistrationWindowNotFoundError(RegistrationWindowError):
    """Raised when no active window exists."""


class RegistrationWindowClosedError(RegistrationWindowError):
    """Raised when the window is already closed or expired."""


class RegistrationQuotaExceededError(RegistrationWindowError):
    """Raised when no remaining slots are available."""


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _now(now: datetime | None = None) -> datetime:
    return _ensure_utc(now or Datetime.now())


def _select_active_window_stmt(now: datetime) -> Select[tuple[RegistrationWindow]]:
    return (
        select(RegistrationWindow)
        .where(RegistrationWindow.status == RegistrationWindowStatus.ACTIVE)
        .where(RegistrationWindow.start_time <= now)
        .where(RegistrationWindow.end_time >= now)
        .where(RegistrationWindow.registered_count < RegistrationWindow.max_registrations)
        .order_by(RegistrationWindow.start_time)
        .limit(1)
    )


async def _sync_window_states(session: AsyncSession, *, now: datetime) -> None:
    """将应激活/应关闭的窗口状态纠正。"""
    now = _ensure_utc(now)

    activate_stmt = (
        update(RegistrationWindow)
        .where(RegistrationWindow.status == RegistrationWindowStatus.SCHEDULED)
        .where(RegistrationWindow.start_time <= now)
        .where(RegistrationWindow.end_time >= now)
        .values(status=RegistrationWindowStatus.ACTIVE)
        .execution_options(synchronize_session=False)
    )
    close_stmt = (
        update(RegistrationWindow)
        .where(RegistrationWindow.status == RegistrationWindowStatus.ACTIVE)
        .where(RegistrationWindow.end_time < now)
        .values(status=RegistrationWindowStatus.CLOSED)
        .execution_options(synchronize_session=False)
    )
    result_activate = await session.execute(activate_stmt)
    result_close = await session.execute(close_stmt)
    if result_activate.rowcount or result_close.rowcount:
        await session.commit()


async def create_registration_window(
    session: AsyncSession,
    *,
    start_time: datetime,
    end_time: datetime,
    max_registrations: int,
    auto_activate: bool = True,
) -> RegistrationWindow:
    start_time = _ensure_utc(start_time)
    end_time = _ensure_utc(end_time)

    if max_registrations <= 0:
        raise ValueError("max_registrations must be greater than zero")
    if end_time <= start_time:
        raise ValueError("end_time must be later than start_time")

    window = RegistrationWindow(
        start_time=start_time,
        end_time=end_time,
        max_registrations=max_registrations,
        auto_activate=auto_activate,
        status=RegistrationWindowStatus.ACTIVE
        if start_time <= _now()
        else RegistrationWindowStatus.SCHEDULED,
    )
    session.add(window)
    await session.commit()
    await session.refresh(window)
    return window


async def get_active_registration_window(
    session: AsyncSession, *, now: datetime | None = None
) -> RegistrationWindow | None:
    current_time = _now(now)
    await _sync_window_states(session, now=current_time)
    res = await session.execute(_select_active_window_stmt(current_time))
    return res.scalar_one_or_none()


async def activate_window_by_id(session: AsyncSession, window_id: UUID) -> RegistrationWindow | None:
    window = await session.get(RegistrationWindow, window_id)
    if not window:
        return None
    if window.status == RegistrationWindowStatus.CLOSED:
        return window

    now = _now()
    if window.start_time <= now <= window.end_time:
        window.status = RegistrationWindowStatus.ACTIVE
    elif window.end_time < now:
        window.status = RegistrationWindowStatus.CLOSED
    await session.commit()
    await session.refresh(window)
    return window


async def close_window_by_id(session: AsyncSession, window_id: UUID) -> RegistrationWindow | None:
    window = await session.get(RegistrationWindow, window_id)
    if not window:
        return None
    if window.status == RegistrationWindowStatus.CLOSED:
        return window
    window.status = RegistrationWindowStatus.CLOSED
    await session.commit()
    await session.refresh(window)
    return window


async def claim_registration_slot(
    session: AsyncSession, *, now: datetime | None = None
) -> RegistrationWindow:
    current_time = _now(now)
    await _sync_window_states(session, now=current_time)
    res = await session.execute(_select_active_window_stmt(current_time))
    window = res.scalar_one_or_none()
    if window is None:
        raise RegistrationWindowNotFoundError("当前未开放注册窗口")

    if window.end_time < current_time:
        window.status = RegistrationWindowStatus.CLOSED
        await session.commit()
        raise RegistrationWindowClosedError("注册时间已结束")

    if window.registered_count >= window.max_registrations:
        window.status = RegistrationWindowStatus.CLOSED
        await session.commit()
        raise RegistrationQuotaExceededError("注册名额已满")

    window.registered_count += 1
    if window.registered_count >= window.max_registrations:
        window.status = RegistrationWindowStatus.CLOSED
    await session.commit()
    await session.refresh(window)
    return window


async def claim_registration_slot_for_window(
    session: AsyncSession,
    window_id: UUID,
    *,
    now: datetime | None = None,
) -> RegistrationWindow:
    """按指定窗口占用名额。"""
    current_time = _now(now)
    await _sync_window_states(session, now=current_time)
    window = await session.get(RegistrationWindow, window_id)
    if not window:
        raise RegistrationWindowNotFoundError("指定注册窗口不存在")

    if window.status != RegistrationWindowStatus.ACTIVE:
        raise RegistrationWindowClosedError("注册窗口未激活或已关闭")

    start = _ensure_utc(window.start_time)
    end = _ensure_utc(window.end_time)
    if not (start <= current_time <= end):
        raise RegistrationWindowClosedError("注册时间不在有效范围内")
    if window.registered_count >= window.max_registrations:
        window.status = RegistrationWindowStatus.CLOSED
        await session.commit()
        raise RegistrationQuotaExceededError("注册名额已满")

    window.registered_count += 1
    if window.registered_count >= window.max_registrations:
        window.status = RegistrationWindowStatus.CLOSED
    await session.commit()
    await session.refresh(window)
    return window


async def rollback_registration_slot(
    session: AsyncSession, window_id: UUID, *, now: datetime | None = None
) -> None:
    window = await session.get(RegistrationWindow, window_id)
    if not window:
        return
    current_time = _now(now)
    if window.registered_count > 0:
        window.registered_count -= 1
    if (
        window.status == RegistrationWindowStatus.CLOSED
        and window.registered_count < window.max_registrations
        and window.start_time <= current_time <= window.end_time
    ):
        window.status = RegistrationWindowStatus.ACTIVE
    await session.commit()


async def list_windows(session: AsyncSession) -> Iterable[RegistrationWindow]:
    res = await session.execute(select(RegistrationWindow).order_by(RegistrationWindow.start_time))
    return res.scalars().all()


__all__ = [
    "RegistrationQuotaExceededError",
    "RegistrationWindowClosedError",
    "RegistrationWindowError",
    "RegistrationWindowNotFoundError",
    "activate_window_by_id",
    "claim_registration_slot",
    "claim_registration_slot_for_window",
    "close_window_by_id",
    "create_registration_window",
    "get_active_registration_window",
    "list_windows",
    "rollback_registration_slot",
]
