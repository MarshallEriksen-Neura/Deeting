"""sync permissions registry (add user role)

Revision ID: 20260109_04
Revises: 20260109_03
Create Date: 2026-01-09
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.constants.permissions import DEFAULT_ROLES, PERMISSION_REGISTRY

# revision identifiers, used by Alembic.
revision = "20260109_04"
down_revision = "20260109_03"
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


def _ensure_permissions(conn):
    existing = dict(conn.execute(sa.select(permission_table.c.code, permission_table.c.id)).fetchall())
    for perm in PERMISSION_REGISTRY:
        if perm.code in existing:
            conn.execute(
                sa.update(permission_table)
                .where(permission_table.c.code == perm.code)
                .values(description=perm.description)
            )
            continue
        perm_id = uuid.uuid4()
        conn.execute(
            sa.insert(permission_table).values(
                id=perm_id,
                code=perm.code,
                description=perm.description,
            )
        )
        existing[perm.code] = perm_id
    return existing


def _ensure_roles(conn):
    existing = dict(conn.execute(sa.select(role_table.c.name, role_table.c.id)).fetchall())
    for name, desc in DEFAULT_ROLES.items():
        if name in existing:
            conn.execute(
                sa.update(role_table)
                .where(role_table.c.name == name)
                .values(description=desc)
            )
            continue
        role_id = uuid.uuid4()
        conn.execute(
            sa.insert(role_table).values(
                id=role_id,
                name=name,
                description=desc,
            )
        )
        existing[name] = role_id
    return existing


def _bind_role_permissions(conn, role_ids, perm_ids):
    for perm in PERMISSION_REGISTRY:
        for role_name in perm.default_roles:
            role_id = role_ids.get(role_name)
            perm_id = perm_ids.get(perm.code)
            if not role_id or not perm_id:
                continue
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


def upgrade() -> None:
    conn = op.get_bind()
    perm_ids = _ensure_permissions(conn)
    role_ids = _ensure_roles(conn)
    _bind_role_permissions(conn, role_ids, perm_ids)


def downgrade() -> None:
    conn = op.get_bind()
    registry_codes = [p.code for p in PERMISSION_REGISTRY]
    registry_roles = list(DEFAULT_ROLES.keys())

    if registry_codes and registry_roles:
        role_ids = [
            r[0]
            for r in conn.execute(
                sa.select(role_table.c.id).where(role_table.c.name.in_(registry_roles))
            ).fetchall()
        ]
        perm_ids = [
            p[0]
            for p in conn.execute(
                sa.select(permission_table.c.id).where(permission_table.c.code.in_(registry_codes))
            ).fetchall()
        ]
        if role_ids and perm_ids:
            conn.execute(
                sa.delete(role_permission_table).where(
                    role_permission_table.c.role_id.in_(role_ids),
                    role_permission_table.c.permission_id.in_(perm_ids),
                )
            )

    if registry_roles:
        conn.execute(sa.delete(role_table).where(role_table.c.name.in_(registry_roles)))

    if registry_codes:
        conn.execute(sa.delete(permission_table).where(permission_table.c.code.in_(registry_codes)))
