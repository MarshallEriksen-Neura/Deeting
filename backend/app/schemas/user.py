"""
用户相关 Pydantic Schema
"""
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.base import BaseSchema, IDSchema, TimestampSchema


class UserBase(BaseSchema):
    """用户基础信息"""
    email: EmailStr = Field(..., description="邮箱（登录名）")
    username: str | None = Field(None, max_length=100, description="展示名")


class UserCreate(BaseSchema):
    """用户注册请求"""
    email: EmailStr = Field(..., description="邮箱")
    password: str = Field(..., min_length=8, max_length=128, description="密码")
    username: str | None = Field(None, max_length=100, description="展示名")
    invite_code: str | None = Field(None, max_length=64, description="邀请码")


class UserUpdate(BaseSchema):
    """用户更新请求（自助修改）"""
    username: str | None = Field(None, max_length=100, description="展示名")
    avatar_url: str | None = Field(None, max_length=512, description="头像 URL")


class UserRead(IDSchema, TimestampSchema):
    """用户读取响应（排除敏感字段）"""
    email: str = Field(..., description="邮箱")
    username: str | None = Field(None, description="展示名")
    avatar_url: str | None = Field(None, description="头像 URL")
    is_active: bool = Field(..., description="是否启用")
    is_superuser: bool = Field(..., description="是否超级管理员")


class RoleRead(IDSchema):
    """角色读取响应"""
    name: str = Field(..., description="角色名称")
    description: str | None = Field(None, description="角色描述")


class PermissionRead(IDSchema):
    """权限读取响应"""
    code: str = Field(..., description="权限代码")
    description: str | None = Field(None, description="权限描述")


class UserWithRoles(UserRead):
    """用户信息（含角色）"""
    roles: list[RoleRead] = Field(default_factory=list, description="用户角色列表")


class UserWithPermissions(UserRead):
    """用户信息（含权限标记）"""
    permission_flags: dict[str, int] = Field(default_factory=dict, description="权限标记 {can_xxx: 0/1}")


class UserAdminUpdate(BaseSchema):
    """管理员更新用户请求"""
    is_active: bool | None = Field(None, description="是否启用")
    is_superuser: bool | None = Field(None, description="是否超级管理员")
    username: str | None = Field(None, max_length=100, description="展示名")
    avatar_url: str | None = Field(None, max_length=512, description="头像 URL")


class UserListResponse(BaseSchema):
    """用户列表响应"""
    items: list[UserRead] = Field(..., description="用户列表")
    total: int = Field(..., description="总数")
    skip: int = Field(..., description="跳过数量")
    limit: int = Field(..., description="每页数量")


class RoleAssignment(BaseSchema):
    """角色分配请求"""
    role_ids: list[UUID] = Field(..., description="角色 ID 列表")
    action: str = Field("add", pattern="^(add|remove)$", description="操作: add 或 remove")


class BanRequest(BaseSchema):
    """封禁用户请求"""
    reason: str = Field(..., min_length=1, max_length=500, description="封禁原因")
    duration_hours: int | None = Field(None, ge=1, description="封禁时长（小时），不填为永久")
