"""
Auth/ACL 依赖与策略函数

认证模式（优先级从高到低）：
1. JWT Bearer Token: Authorization: Bearer <token>
2. X-User-Id Header: 向后兼容模式（将逐步废弃）

依赖使用：
- get_current_user: 获取当前用户（支持 JWT 和 X-User-Id）
- get_current_active_user: 确保用户已激活
- require_permissions: 校验用户是否具备指定权限 code

策略函数：
- can_use_item / assert_can_use_item: 校验 ProviderPresetItem 的可见性规则
"""
import uuid
from collections.abc import Callable, Iterable

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.database import get_db
from app.core.logging import logger
from app.models import ProviderPresetItem, User
from app.repositories import UserRepository
from app.utils.security import decode_token

# 项目可在此集中声明"前端关心的权限列表"，用于输出 0/1 标记。
KNOWN_PERMISSION_CODES: tuple[str, ...] = (
    "user.manage",
    "role.manage",
    "role.view",
)


async def _get_user_from_jwt(
    token: str,
    db: AsyncSession,
) -> User:
    """从 JWT token 解析并验证用户"""
    try:
        payload = decode_token(token)
    except ValueError as e:
        logger.warning("jwt_decode_failed", extra={"error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 验证 token 类型
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    jti = payload.get("jti")
    user_id_str = payload.get("sub")
    token_version = payload.get("version")

    if not jti or not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查 token 是否在黑名单中
    blacklist_key = f"auth:access:{jti}"
    if await cache.get(blacklist_key):
        logger.warning("token_blacklisted", extra={"jti": jti})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 获取用户
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user id in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(user_uuid)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # token_version 校验，确保密码变更/强制登出后旧 token 失效
    if token_version is not None and token_version != user.token_version:
        logger.warning(
            "token_version_mismatch_access",
            extra={"user_id": str(user.id), "token_version": token_version, "current": user.token_version},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired, please login again",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # 针对老版本 token（无 version 字段），当用户版本已提升时也视为失效
    if token_version is None and user.token_version > 0:
        logger.warning(
            "token_version_missing_legacy",
            extra={"user_id": str(user.id), "current": user.token_version},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired, please login again",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查用户是否被封禁
    ban_key = f"auth:ban:{user.id}"
    ban_data = await cache.get(ban_key)
    if ban_data:
        logger.warning("user_banned_access_attempt", extra={"user_id": str(user.id)})
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is banned: {ban_data.get('reason', 'No reason provided')}",
        )

    return user


async def _get_user_from_header(
    x_user_id: str,
    db: AsyncSession,
) -> User:
    """从 X-User-Id 头获取用户（向后兼容）"""
    logger.warning(
        "deprecated_auth_method",
        extra={"method": "X-User-Id", "user_id": x_user_id},
    )

    try:
        user_uuid = uuid.UUID(x_user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user id format",
        )

    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(user_uuid)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # 检查用户是否被封禁
    ban_key = f"auth:ban:{user.id}"
    ban_data = await cache.get(ban_key)
    if ban_data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is banned: {ban_data.get('reason', 'No reason provided')}",
        )

    return user


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> User:
    """
    获取当前用户（双模式认证）

    优先级：
    1. Authorization: Bearer <token> (JWT)
    2. X-User-Id: <uuid> (向后兼容，将逐步废弃)
    """
    # 优先使用 JWT Bearer Token
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]  # 移除 "Bearer " 前缀
        return await _get_user_from_jwt(token, db)

    # 回退到 X-User-Id（向后兼容）
    if x_user_id:
        return await _get_user_from_header(x_user_id, db)

    # 两者都没有
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_active_user(
    user: User = Depends(get_current_user),
) -> User:
    """确保用户已激活"""
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not activated",
        )
    return user


async def get_current_user_optional(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> User | None:
    """可选认证：有凭据则返回用户，无凭据返回 None"""
    if not authorization and not x_user_id:
        return None

    try:
        return await get_current_user(db, authorization, x_user_id)
    except HTTPException:
        return None


async def _fetch_permission_codes(db: AsyncSession, user: User) -> set[str]:
    """获取用户权限码（带缓存）"""
    # 超级用户拥有所有权限
    if user.is_superuser:
        return set(KNOWN_PERMISSION_CODES) if KNOWN_PERMISSION_CODES else set()

    # 尝试从缓存获取
    cache_key = f"acl:perm:{user.id}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return set(cached)

    # 从数据库获取并缓存
    user_repo = UserRepository(db)
    codes = await user_repo.permission_codes(user.id)

    # 缓存 5 分钟
    await cache.set(cache_key, list(codes), ttl=300)

    return codes


def require_permissions(codes: Iterable[str]) -> Callable:
    """
    生成 FastAPI 依赖，校验用户是否拥有指定权限 code。
    """
    codes_set = set(codes)

    async def _dep(
        user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if user.is_superuser:
            return user

        user_codes = await _fetch_permission_codes(db, user)
        missing = codes_set - user_codes

        if missing:
            logger.warning(
                "permission_denied",
                extra={
                    "user_id": str(user.id),
                    "required": list(codes_set),
                    "missing": list(missing),
                },
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(sorted(missing))}",
            )
        return user

    return _dep


def can_use_item(user: User, item: ProviderPresetItem) -> bool:
    """
    可见性判定：
    - public: 任何活跃用户可用
    - private: 仅 owner 或超管
    - shared: 根据 shared_scope/shared_targets 判定（若未配置 targets，则拒绝）
    """
    if not item.is_active:
        return False
    if user.is_superuser:
        return True

    vis = (item.visibility or "private").lower()
    if vis == "public":
        return True
    if vis == "private":
        return item.owner_user_id == user.id
    if vis == "shared":
        targets = item.shared_targets or []
        return str(user.id) in {str(t) for t in targets}
    return False


def assert_can_use_item(user: User, item: ProviderPresetItem) -> None:
    """断言用户可以使用该 item，否则抛出 403"""
    if not can_use_item(user, item):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied for this preset item",
        )


async def get_permission_flags(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """
    将用户权限封装为 {can_xxx: 0/1} 结构，便于前端直接判断。
    """
    codes = await _fetch_permission_codes(db, user)

    def _flag_name(code: str) -> str:
        return "can_" + code.replace(".", "_").replace(":", "_")

    if KNOWN_PERMISSION_CODES:
        flags = {_flag_name(code): 0 for code in KNOWN_PERMISSION_CODES}
        for code in codes:
            key = _flag_name(code)
            if key in flags:
                flags[key] = 1
        # 超级用户所有权限为 1
        if user.is_superuser:
            flags = {k: 1 for k in flags}
        return flags

    # 只返回拥有的权限
    return {_flag_name(code): 1 for code in codes}


async def clear_permission_cache(user_id: uuid.UUID) -> None:
    """清除用户权限缓存（角色变更时调用）"""
    cache_key = f"acl:perm:{user_id}"
    await cache.delete(cache_key)
    logger.info("permission_cache_cleared", extra={"user_id": str(user_id)})
