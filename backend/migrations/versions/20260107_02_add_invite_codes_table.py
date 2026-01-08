"""add invite codes table

Revision ID: 20260107_02
Revises: 20260107_01_create_agent_plugin_table
Create Date: 2026-01-07 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260107_02'
down_revision = '20260107_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 创建注册窗口表（若不存在）
    # 先确保枚举类型干净存在
    op.execute("DROP TYPE IF EXISTS registrationwindowstatus")
    op.execute(
        """
        CREATE TYPE registrationwindowstatus AS ENUM ('scheduled','active','closed');
        """
    )
    registration_status = postgresql.ENUM(
        "scheduled",
        "active",
        "closed",
        name="registrationwindowstatus",
        create_type=False,
    )

    op.create_table(
        'registration_windows',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('max_registrations', sa.Integer(), nullable=False),
        sa.Column('registered_count', sa.Integer(), nullable=False, server_default="0"),
        sa.Column('auto_activate', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('status', registration_status, nullable=False, server_default='scheduled'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_registration_windows_start_end'), 'registration_windows', ['start_time', 'end_time'])

    op.create_table(
        'invite_codes',
        sa.Column('code', sa.String(length=64), nullable=False, comment='邀请码'),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('window_id', sa.UUID(), nullable=False, comment='所属注册窗口'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True, comment='过期时间'),
        sa.Column('reserved_at', sa.DateTime(timezone=True), nullable=True, comment='预占时间'),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True, comment='使用时间'),
        sa.Column('used_by', sa.UUID(), nullable=True, comment='使用者'),
        sa.Column('note', sa.String(length=255), nullable=True, comment='备注'),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['used_by'], ['user_account.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['window_id'], ['registration_windows.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_invite_codes_code'), 'invite_codes', ['code'], unique=True)
    op.create_index(op.f('ix_invite_codes_window_id'), 'invite_codes', ['window_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_invite_codes_window_id'), table_name='invite_codes')
    op.drop_index(op.f('ix_invite_codes_code'), table_name='invite_codes')
    op.drop_table('invite_codes')

    op.drop_index(op.f('ix_registration_windows_start_end'), table_name='registration_windows')
    op.drop_table('registration_windows')
    registration_status = sa.Enum(name="registrationwindowstatus")
    registration_status.drop(op.get_bind(), checkfirst=True)
