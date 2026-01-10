"""add_user_token_version

Revision ID: bb8a5d94940c
Revises: 20260104_02
Create Date: 2026-01-05 01:00:29.586290
"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'bb8a5d94940c'
down_revision = '20260104_02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 token_version 字段到 user_account 表
    op.add_column(
        'user_account',
        sa.Column(
            'token_version',
            sa.Integer(),
            nullable=False,
            server_default='0',
            comment='Token 版本号,密码修改或强制登出时递增'
        )
    )

    # 添加 user_role 唯一约束
    op.create_unique_constraint(
        'uq_user_role',
        'user_role',
        ['user_id', 'role_id']
    )

    # 添加 role_permission 唯一约束
    op.create_unique_constraint(
        'uq_role_permission',
        'role_permission',
        ['role_id', 'permission_id']
    )


def downgrade() -> None:
    # 移除约束
    op.drop_constraint('uq_role_permission', 'role_permission', type_='unique')
    op.drop_constraint('uq_user_role', 'user_role', type_='unique')

    # 移除 token_version 字段
    op.drop_column('user_account', 'token_version')
