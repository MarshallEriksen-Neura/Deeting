from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.deps import get_db
from app.errors import bad_request, forbidden, not_found
from app.jwt_auth import AuthenticatedUser, require_jwt_token
from app.models import Permission, Role
from app.schemas import (
    PermissionResponse,
    RoleCreateRequest,
    RolePermissionsResponse,
    RolePermissionsUpdateRequest,
    RoleResponse,
    RoleUpdateRequest,
    UserRolesUpdateRequest,
)
from app.services.role_service import (
    RoleCodeAlreadyExistsError,
    RoleService,
    UnknownPermissionCodeError,
    UnknownRoleIdError,
)
from app.services.user_service import get_user_by_id

router = APIRouter(
    tags=["admin-roles"],
    dependencies=[Depends(require_jwt_token)],
)


def _ensure_admin(current_user: AuthenticatedUser) -> None:
    if not current_user.is_superuser:
        raise forbidden("需要管理员权限")


def _get_role_or_404(session: Session, role_id: UUID) -> Role:
    role = session.get(Role, role_id)
    if role is None:
        raise not_found(f"Role {role_id} not found")
    return role


@router.get(
    "/admin/permissions",
    response_model=list[PermissionResponse],
)
def list_permissions_endpoint(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> list[PermissionResponse]:
    """列出系统中所有可用的权限定义（Permission.code）。"""

    _ensure_admin(current_user)
    stmt: Select[tuple[Permission]] = select(Permission).order_by(Permission.code)
    permissions = list(db.execute(stmt).scalars().all())
    return [PermissionResponse.model_validate(p) for p in permissions]


@router.get(
    "/admin/roles",
    response_model=list[RoleResponse],
)
def list_roles_endpoint(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> list[RoleResponse]:
    """列出所有角色。"""

    _ensure_admin(current_user)
    service = RoleService(db)
    roles = service.list_roles()
    return [RoleResponse.model_validate(r) for r in roles]


@router.post(
    "/admin/roles",
    response_model=RoleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_role_endpoint(
    payload: RoleCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> RoleResponse:
    """创建一个新角色。"""

    _ensure_admin(current_user)
    service = RoleService(db)
    try:
        role = service.create_role(
            code=payload.code,
            name=payload.name,
            description=payload.description,
        )
    except RoleCodeAlreadyExistsError:
        raise bad_request("角色编码已存在")

    return RoleResponse.model_validate(role)


@router.put(
    "/admin/roles/{role_id}",
    response_model=RoleResponse,
)
def update_role_endpoint(
    role_id: UUID,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> RoleResponse:
    """更新角色的名称和描述。"""

    _ensure_admin(current_user)
    role = _get_role_or_404(db, role_id)

    service = RoleService(db)
    # 这里只允许更新 name/description，code 视为稳定主键
    updated = service.update_role(
        role,
        name=payload.name,
        description=payload.description,
    )
    return RoleResponse.model_validate(updated)


@router.delete(
    "/admin/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_role_endpoint(
    role_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> None:
    """删除角色，会级联删除角色权限和用户角色。"""

    _ensure_admin(current_user)
    role = _get_role_or_404(db, role_id)
    service = RoleService(db)
    service.delete_role(role)


@router.get(
    "/admin/roles/{role_id}/permissions",
    response_model=RolePermissionsResponse,
)
def get_role_permissions_endpoint(
    role_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> RolePermissionsResponse:
    """查看指定角色当前绑定的权限 code 列表。"""

    _ensure_admin(current_user)
    role = _get_role_or_404(db, role_id)
    service = RoleService(db)
    codes = service.get_role_permission_codes(role)
    return RolePermissionsResponse(
        role_id=role.id,
        role_code=role.code,
        permission_codes=codes,
    )


@router.put(
    "/admin/roles/{role_id}/permissions",
    response_model=RolePermissionsResponse,
)
@router.post(
    "/admin/roles/{role_id}/permissions",
    response_model=RolePermissionsResponse,
)
def set_role_permissions_endpoint(
    role_id: UUID,
    payload: RolePermissionsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> RolePermissionsResponse:
    """设置角色的权限列表（全量覆盖）。"""

    _ensure_admin(current_user)
    role = _get_role_or_404(db, role_id)
    service = RoleService(db)
    try:
        codes = service.set_role_permissions(role, payload.permission_codes)
    except UnknownPermissionCodeError as exc:
        raise bad_request(
            "存在无效的权限编码",
            details={"missing_permission_codes": sorted(exc.missing_codes)},
        )

    return RolePermissionsResponse(
        role_id=role.id,
        role_code=role.code,
        permission_codes=codes,
    )


@router.get(
    "/admin/users/{user_id}/roles",
    response_model=list[RoleResponse],
)
def get_user_roles_endpoint(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> list[RoleResponse]:
    """查看指定用户当前拥有的角色列表。"""

    _ensure_admin(current_user)
    user = get_user_by_id(db, user_id)
    if user is None:
        raise not_found(f"User {user_id} not found")

    service = RoleService(db)
    roles = service.get_user_roles(user.id)
    return [RoleResponse.model_validate(r) for r in roles]


@router.put(
    "/admin/users/{user_id}/roles",
    response_model=list[RoleResponse],
)
@router.post(
    "/admin/users/{user_id}/roles",
    response_model=list[RoleResponse],
)
def set_user_roles_endpoint(
    user_id: UUID,
    payload: UserRolesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_jwt_token),
) -> list[RoleResponse]:
    """为用户设置角色列表（全量覆盖）。"""

    _ensure_admin(current_user)
    user = get_user_by_id(db, user_id)
    if user is None:
        raise not_found(f"User {user_id} not found")

    service = RoleService(db)
    try:
        roles = service.set_user_roles(user.id, payload.role_ids)
    except UnknownRoleIdError as exc:
        raise bad_request(
            "存在无效的角色 ID",
            details={"missing_role_ids": [str(i) for i in sorted(exc.missing_ids, key=str)]},
        )

    return [RoleResponse.model_validate(r) for r in roles]


__all__ = ["router"]
