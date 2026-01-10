"""seed default roles and permissions

Revision ID: 20260109_02
Revises: 20260109_01
Create Date: 2026-01-09
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260109_02"
down_revision = "20260109_01"
branch_labels = None
depends_on = None


permission_table = sa.table(
    "permission",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("code", sa.String),
    sa.column("description", sa.Text),
)

role_table = sa.table(
    "role",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("name", sa.String),
    sa.column("description", sa.Text),
)

role_permission_table = sa.table(
    "role_permission",
    sa.column("role_id", postgresql.UUID(as_uuid=True)),
    sa.column("permission_id", postgresql.UUID(as_uuid=True)),
)


DEFAULT_PERMISSIONS: list[tuple[str, str]] = [
    ("user.manage", "用户管理：增删改查用户、封禁/解封"),
    ("role.manage", "角色管理：创建、更新、删除角色并分配权限"),
    ("role.view", "角色查看：读取角色与权限列表"),
    ("api_key.manage", "API Key 管理：创建/禁用/限流"),
    ("api_key.view", "API Key 查看：读取密钥与配额"),
    ("assistant.manage", "助手管理：创建/发布/更新助手"),
]

ADMIN_ROLE = {
    "name": "admin",
    "description": "系统管理员，默认持有全部后台权限",
}


def upgrade() -> None:
    conn = op.get_bind()

    # 1) 插入基础权限（幂等）
    existing_perms = dict(
        conn.execute(
            sa.select(permission_table.c.code, permission_table.c.id)
        ).fetchall()
    )

    for code, desc in DEFAULT_PERMISSIONS:
        if code in existing_perms:
            continue
        perm_id = uuid.uuid4()
        conn.execute(
            sa.insert(permission_table).values(
                id=perm_id,
                code=code,
                description=desc,
            )
        )
        existing_perms[code] = perm_id

    # 2) 创建 admin 角色（幂等）
    role_id = conn.execute(
        sa.select(role_table.c.id).where(role_table.c.name == ADMIN_ROLE["name"])
    ).scalar_one_or_none()

    if role_id is None:
        role_id = uuid.uuid4()
        conn.execute(
            sa.insert(role_table).values(
                id=role_id,
                name=ADMIN_ROLE["name"],
                description=ADMIN_ROLE["description"],
            )
        )

    # 3) 绑定角色与权限（幂等）
    for code, _ in DEFAULT_PERMISSIONS:
        perm_id = existing_perms[code]
        exists = conn.execute(
            sa.select(role_permission_table.c.role_id).where(
                role_permission_table.c.role_id == role_id,
                role_permission_table.c.permission_id == perm_id,
            )
        ).scalar_one_or_none()
        if exists:
            continue

        conn.execute(
            sa.insert(role_permission_table).values(
                role_id=role_id,
                permission_id=perm_id,
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    default_codes = [code for code, _ in DEFAULT_PERMISSIONS]

    # 找到 admin 角色
    role_id = conn.execute(
        sa.select(role_table.c.id).where(role_table.c.name == ADMIN_ROLE["name"])
    ).scalar_one_or_none()

    # 删除角色-权限绑定
    if role_id:
        perm_ids = [
            row[0]
            for row in conn.execute(
                sa.select(permission_table.c.id).where(
                    permission_table.c.code.in_(default_codes)
                )
            ).fetchall()
        ]
        if perm_ids:
            conn.execute(
                sa.delete(role_permission_table).where(
                    role_permission_table.c.role_id == role_id,
                    role_permission_table.c.permission_id.in_(perm_ids),
                )
            )
        conn.execute(sa.delete(role_table).where(role_table.c.id == role_id))

    # 删除权限
    conn.execute(
        sa.delete(permission_table).where(permission_table.c.code.in_(default_codes))
    )
