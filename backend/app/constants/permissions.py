"""
权限注册表（单一真源）

新增/修改权限时仅需在此处维护，迁移/前端 flags 等从这里导出。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class PermissionItem:
    code: str
    description: str
    default_roles: tuple[str, ...] = ()


# 按功能模块分组便于后续维护
PERMISSION_REGISTRY: List[PermissionItem] = [
    PermissionItem("user.manage", "用户管理：增删改查用户、封禁/解封", ("admin",)),
    PermissionItem("role.manage", "角色管理：创建、更新、删除角色并分配权限", ("admin",)),
    PermissionItem("role.view", "角色查看：读取角色与权限列表", ("admin",)),
    PermissionItem("api_key.manage", "API Key 管理：创建/禁用/限流", ("admin",)),
    PermissionItem("api_key.view", "API Key 查看：读取密钥与配额", ("admin",)),
    PermissionItem("assistant.manage", "助手管理：创建/发布/更新助手", ("admin",)),
    PermissionItem("notification.manage", "通知管理：发布系统/业务通知", ("admin",)),
]

# 默认角色定义（需要可扩展可在此补充）
DEFAULT_USER_ROLE = "user"

DEFAULT_ROLES: dict[str, str] = {
    "admin": "系统管理员，默认持有全部后台权限",
    DEFAULT_USER_ROLE: "普通用户，基础访问角色",
}

PERMISSION_CODES: tuple[str, ...] = tuple(p.code for p in PERMISSION_REGISTRY)
