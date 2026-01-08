"""
管理员注册窗口控制 API (/api/v1/admin/registration)

能力：
- 创建注册窗口
- 查询当前有效窗口
- 手动关闭窗口
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import require_permissions
from app.schemas.registration import RegistrationWindowCreate, RegistrationWindowRead
from app.schemas.invite import InviteIssueRequest, InviteListResponse
from app.repositories import InviteCodeRepository
from app.services.users.invite_code_service import InviteCodeService
from app.services.users.registration_window_service import (
    close_window_by_id,
    create_registration_window,
    get_active_registration_window,
)

router = APIRouter(prefix="/admin/registration", tags=["Admin - Registration"])


@router.post(
    "/windows",
    response_model=RegistrationWindowRead,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def create_window(
    payload: RegistrationWindowCreate,
    db: AsyncSession = Depends(get_db),
):
    window = await create_registration_window(
        db,
        start_time=payload.start_time,
        end_time=payload.end_time,
        max_registrations=payload.max_registrations,
        auto_activate=payload.auto_activate,
    )
    return window


@router.get(
    "/windows/active",
    response_model=RegistrationWindowRead | None,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def active_window(
    db: AsyncSession = Depends(get_db),
):
    window = await get_active_registration_window(db, now=datetime.now())
    if not window:
        return None
    return window


@router.post(
    "/windows/{window_id}/close",
    response_model=RegistrationWindowRead,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def close_window(
    window_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    window = await close_window_by_id(db, window_id)
    if not window:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="window not found")
    return window


@router.post(
    "/windows/{window_id}/invites",
    response_model=list[str],
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def issue_invites(
    window_id: UUID,
    payload: InviteIssueRequest,
    db: AsyncSession = Depends(get_db),
):
    service = InviteCodeService(InviteCodeRepository(db))
    invites = await service.issue(
        window_id=window_id,
        count=payload.count,
        length=payload.length,
        prefix=payload.prefix,
        expires_at=payload.expires_at,
        note=payload.note,
    )
    return [inv.code for inv in invites]


@router.get(
    "/windows/{window_id}/invites",
    response_model=InviteListResponse,
    dependencies=[Depends(require_permissions(["user.manage"]))],
)
async def list_invites(
    window_id: UUID,
    status: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    service = InviteCodeService(InviteCodeRepository(db))
    from app.models import InviteCodeStatus

    status_enum = InviteCodeStatus(status) if status else None
    items, total = await service.list_by_window(window_id, status=status_enum, limit=limit, offset=skip)
    return InviteListResponse(
        items=[
            {
                "code": item.code,
                "status": item.status,
                "expires_at": item.expires_at,
                "used_by": item.used_by,
                "used_at": item.used_at,
                "reserved_at": item.reserved_at,
            }
            for item in items
        ],
        total=total,
        skip=skip,
        limit=limit,
    )
