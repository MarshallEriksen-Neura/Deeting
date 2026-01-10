"""
API Key 管理 API 路由 (/api/v1/admin/api-keys)

端点:
- POST /admin/api-keys - 创建 API Key [权限: api_key.manage]
- GET /admin/api-keys - 列出 API Key [权限: api_key.view]
- GET /admin/api-keys/{id} - 获取详情 [权限: api_key.view]
- PATCH /admin/api-keys/{id} - 更新配置 [权限: api_key.manage]
- DELETE /admin/api-keys/{id} - 删除 Key [权限: api_key.manage]
- POST /admin/api-keys/{id}/revoke - 吊销 Key [权限: api_key.manage]
- POST /admin/api-keys/{id}/rotate - 轮换 Key [权限: api_key.manage]
- GET /admin/api-keys/{id}/usage - 使用统计 [权限: api_key.view]

遵循 AGENTS.md 最佳实践:
- 路由"瘦身"：只做入参校验、鉴权/依赖注入、调用 Service
- 业务逻辑封装在 Service 层
- 禁止在路由中直接操作 ORM/Session
"""
from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.deps.auth import get_current_user, require_permissions
from app.models import User
from app.models.api_key import ApiKeyStatus, ApiKeyType, QuotaType, ScopeType
from app.repositories.api_key import ApiKeyRepository
from app.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreatedResponse,
    ApiKeyListResponse,
    ApiKeyRead,
    ApiKeyRevokeRequest,
    ApiKeyRotateResponse,
    ApiKeyUpdate,
    ApiKeyUsageRead,
    ApiKeyUsageStatsResponse,
)
from app.schemas.auth import MessageResponse
from app.services.providers.api_key import ApiKeyService

router = APIRouter(prefix="/admin/api-keys", tags=["Admin - API Keys"])


# ============================================================
# 依赖注入
# ============================================================

async def get_api_key_service(db: AsyncSession = Depends(get_db)) -> ApiKeyService:
    """获取 ApiKeyService 实例"""
    repository = ApiKeyRepository(db)
    return ApiKeyService(
        repository=repository,
        redis_client=None,  # TODO: 注入 Redis 客户端
        secret_key=settings.SECRET_KEY,
    )


# ============================================================
# 路由
# ============================================================

@router.post(
    "",
    response_model=ApiKeyCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def create_api_key(
    data: ApiKeyCreate,
    current_user: User = Depends(get_current_user),
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyCreatedResponse:
    """
    创建 API Key

    - **name**: Key 名称
    - **type**: internal（内部）或 external（外部）
    - **tenant_id**: 外部 Key 绑定的租户 ID
    - **user_id**: 内部 Key 绑定的用户 ID
    - **expires_at**: 过期时间（可选）
    - **scopes**: 权限范围（可选）
    - **rate_limit**: 限流配置（可选）
    - **quotas**: 配额配置（可选）
    - **ip_whitelist**: IP 白名单（可选）

    返回完整的 API Key（仅此一次可见，请妥善保管）
    """
    # 转换枚举
    key_type = ApiKeyType(data.type.value)

    # 转换 scopes
    scopes = None
    if data.scopes:
        scopes = [
            {
                "type": ScopeType(s.scope_type.value),
                "value": s.scope_value,
                "permission": s.permission.value,
            }
            for s in data.scopes
        ]

    # 转换 rate_limit
    rate_limit = None
    if data.rate_limit:
        rate_limit = data.rate_limit.model_dump(exclude_none=True)

    # 转换 quotas
    quotas = None
    if data.quotas:
        quotas = [
            {
                "type": QuotaType(q.quota_type.value),
                "total": q.total_quota,
                "reset_period": q.reset_period.value,
            }
            for q in data.quotas
        ]

    api_key, raw_key = await service.generate_key(
        key_type=key_type,
        name=data.name,
        created_by=current_user.id,
        tenant_id=data.tenant_id,
        user_id=data.user_id,
        expires_at=data.expires_at,
        scopes=scopes,
        rate_limit=rate_limit,
        quotas=quotas,
        ip_whitelist=data.ip_whitelist,
    )

    return ApiKeyCreatedResponse(
        api_key=ApiKeyRead.model_validate(api_key),
        raw_key=raw_key,
    )


@router.get(
    "",
    response_model=ApiKeyListResponse,
    dependencies=[Depends(require_permissions(["api_key.view"]))],
)
async def list_api_keys(
    skip: int = Query(0, ge=0, description="跳过数量"),
    limit: int = Query(20, ge=1, le=100, description="每页数量"),
    type: str | None = Query(None, description="Key 类型筛选"),
    status: str | None = Query(None, description="状态筛选"),
    tenant_id: UUID | None = Query(None, description="租户 ID 筛选"),
    user_id: UUID | None = Query(None, description="用户 ID 筛选"),
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyListResponse:
    """
    列出 API Key

    支持按类型、状态、租户、用户筛选
    """
    # TODO: 实现分页和筛选
    status_enum = ApiKeyStatus(status) if status else None

    if tenant_id:
        keys = await service.list_keys(tenant_id=tenant_id, status=status_enum)
    elif user_id:
        keys = await service.list_keys(user_id=user_id, status=status_enum)
    else:
        keys = await service.list_keys(status=status_enum)

    # 简单分页
    total = len(keys)
    items = keys[skip:skip + limit]

    return ApiKeyListResponse(
        items=[ApiKeyRead.model_validate(k) for k in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/{api_key_id}",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.view"]))],
)
async def get_api_key(
    api_key_id: UUID,
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyRead:
    """获取 API Key 详情"""
    api_key = await service.get_key_info(api_key_id)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )
    return ApiKeyRead.model_validate(api_key)


@router.patch(
    "/{api_key_id}",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def update_api_key(
    api_key_id: UUID,
    data: ApiKeyUpdate,
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyRead:
    """
    更新 API Key 配置

    可更新: name, description, expires_at
    """
    update_data = data.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update",
        )

    api_key = await service.update_key(api_key_id, update_data)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )
    return ApiKeyRead.model_validate(api_key)


@router.delete(
    "/{api_key_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def delete_api_key(
    api_key_id: UUID,
    service: ApiKeyService = Depends(get_api_key_service),
) -> MessageResponse:
    """删除 API Key"""
    success = await service.delete_key(api_key_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )
    return MessageResponse(message="API Key deleted successfully")


@router.post(
    "/{api_key_id}/revoke",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def revoke_api_key(
    api_key_id: UUID,
    data: ApiKeyRevokeRequest,
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyRead:
    """
    吊销 API Key

    立即生效，Key 将无法再使用
    """
    api_key = await service.revoke_key(api_key_id, data.reason)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )
    return ApiKeyRead.model_validate(api_key)


@router.post(
    "/{api_key_id}/rotate",
    response_model=ApiKeyRotateResponse,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def rotate_api_key(
    api_key_id: UUID,
    grace_period_hours: int = Query(24, ge=1, le=168, description="旧 Key 宽限期（小时）"),
    service: ApiKeyService = Depends(get_api_key_service),
) -> ApiKeyRotateResponse:
    """
    轮换 API Key

    生成新 Key，旧 Key 在宽限期后过期
    """
    new_key, raw_key = await service.rotate_key(api_key_id, grace_period_hours)
    if not new_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )

    old_key_expires_at = datetime.utcnow() + timedelta(hours=grace_period_hours)

    return ApiKeyRotateResponse(
        new_key=ApiKeyRead.model_validate(new_key),
        raw_key=raw_key,
        old_key_expires_at=old_key_expires_at,
    )


@router.get(
    "/{api_key_id}/usage",
    response_model=ApiKeyUsageStatsResponse,
    dependencies=[Depends(require_permissions(["api_key.view"]))],
)
async def get_api_key_usage(
    api_key_id: UUID,
    start_date: date = Query(..., description="开始日期"),
    end_date: date = Query(..., description="结束日期"),
    service: ApiKeyService = Depends(get_api_key_service),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyUsageStatsResponse:
    """
    获取 API Key 使用统计

    返回指定日期范围内的使用量
    """
    # 验证 API Key 存在
    api_key = await service.get_key_info(api_key_id)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found",
        )

    # 获取统计数据
    repository = ApiKeyRepository(db)
    usage_stats = await repository.get_usage_stats(api_key_id, start_date, end_date)

    # 聚合统计
    total_requests = sum(s.request_count for s in usage_stats)
    total_tokens = sum(s.token_count for s in usage_stats)
    total_cost = sum(s.cost for s in usage_stats)
    total_errors = sum(s.error_count for s in usage_stats)

    return ApiKeyUsageStatsResponse(
        api_key_id=api_key_id,
        start_date=datetime.combine(start_date, datetime.min.time()),
        end_date=datetime.combine(end_date, datetime.max.time()),
        total_requests=total_requests,
        total_tokens=total_tokens,
        total_cost=total_cost,
        total_errors=total_errors,
        hourly_stats=[ApiKeyUsageRead.model_validate(s) for s in usage_stats],
    )


# ============================================================
# Scope 管理
# ============================================================

@router.post(
    "/{api_key_id}/scopes",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def add_api_key_scope(
    api_key_id: UUID,
    scope_type: str = Query(..., description="范围类型: capability/model/endpoint"),
    scope_value: str = Query(..., description="具体值"),
    permission: str = Query("allow", description="权限类型: allow/deny"),
    service: ApiKeyService = Depends(get_api_key_service),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyRead:
    """添加权限范围"""
    repository = ApiKeyRepository(db)
    await repository.add_scope(
        api_key_id=api_key_id,
        scope_type=ScopeType(scope_type),
        scope_value=scope_value,
        permission=permission,
    )
    await db.commit()

    api_key = await service.get_key_info(api_key_id)
    return ApiKeyRead.model_validate(api_key)


@router.delete(
    "/{api_key_id}/scopes/{scope_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def remove_api_key_scope(
    api_key_id: UUID,
    scope_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """移除权限范围"""
    repository = ApiKeyRepository(db)
    success = await repository.remove_scope(api_key_id, scope_id)
    await db.commit()

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scope not found",
        )
    return MessageResponse(message="Scope removed successfully")


# ============================================================
# Rate Limit 管理
# ============================================================

@router.put(
    "/{api_key_id}/rate-limit",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def update_api_key_rate_limit(
    api_key_id: UUID,
    rpm: int | None = Query(None, ge=0, description="每分钟请求数"),
    tpm: int | None = Query(None, ge=0, description="每分钟 Token 数"),
    rpd: int | None = Query(None, ge=0, description="每日请求数"),
    tpd: int | None = Query(None, ge=0, description="每日 Token 数"),
    concurrent_limit: int | None = Query(None, ge=0, description="并发数"),
    burst_limit: int | None = Query(None, ge=0, description="突发上限"),
    is_whitelist: bool = Query(False, description="是否白名单"),
    service: ApiKeyService = Depends(get_api_key_service),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyRead:
    """更新限流配置"""
    data = {
        "rpm": rpm,
        "tpm": tpm,
        "rpd": rpd,
        "tpd": tpd,
        "concurrent_limit": concurrent_limit,
        "burst_limit": burst_limit,
        "is_whitelist": is_whitelist,
    }
    repository = ApiKeyRepository(db)
    await repository.update_rate_limit(api_key_id, data)
    await db.commit()

    api_key = await service.get_key_info(api_key_id)
    return ApiKeyRead.model_validate(api_key)


# ============================================================
# IP Whitelist 管理
# ============================================================

@router.post(
    "/{api_key_id}/ip-whitelist",
    response_model=ApiKeyRead,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def add_ip_whitelist(
    api_key_id: UUID,
    ip_pattern: str = Query(..., description="IP 或 CIDR"),
    description: str | None = Query(None, description="描述"),
    service: ApiKeyService = Depends(get_api_key_service),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyRead:
    """添加 IP 白名单"""
    repository = ApiKeyRepository(db)
    await repository.add_ip_whitelist(api_key_id, ip_pattern, description)
    await db.commit()

    api_key = await service.get_key_info(api_key_id)
    return ApiKeyRead.model_validate(api_key)


@router.delete(
    "/{api_key_id}/ip-whitelist/{ip_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_permissions(["api_key.manage"]))],
)
async def remove_ip_whitelist(
    api_key_id: UUID,
    ip_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """移除 IP 白名单"""
    repository = ApiKeyRepository(db)
    success = await repository.remove_ip_whitelist(api_key_id, ip_id)
    await db.commit()

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IP whitelist entry not found",
        )
    return MessageResponse(message="IP whitelist entry removed successfully")
