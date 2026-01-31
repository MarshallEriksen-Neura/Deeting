"""create_knowledge_ingestion_tables

Revision ID: 6c16a8399765
Revises: 6ab7db9d7159
Create Date: 2026-01-31 06:35:20.922681
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '6c16a8399765'
down_revision = '6ab7db9d7159'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create knowledge_artifact table
    op.create_table(
        'knowledge_artifact',
        sa.Column('id', sa.UUID(), nullable=False, comment='主键 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, comment='更新时间'),
        sa.Column('source_url', sa.String(length=1024), nullable=False, comment='来源 URL'),
        sa.Column('title', sa.String(length=255), nullable=True, comment='网页标题'),
        sa.Column('raw_content', sa.Text(), nullable=False, comment='原始爬取内容 (Markdown)'),
        sa.Column('content_hash', sa.String(length=64), nullable=False, comment='内容哈希，用于检测变更'),
        sa.Column('artifact_type', sa.String(length=50), server_default='documentation', nullable=False, comment='知识类型: documentation, assistant, provider_spec'),
        sa.Column('status', sa.String(length=24), server_default='pending', nullable=False, comment='状态: pending, processing, indexed, failed'),
        sa.Column('embedding_model', sa.String(length=100), nullable=True, comment='索引使用的 Embedding 模型名称'),
        sa.Column('meta_info', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False, comment='灵活的元数据'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_knowledge_artifact'))
    )
    op.create_index('ix_knowledge_artifact_source_url', 'knowledge_artifact', ['source_url'], unique=True)
    op.create_index('ix_knowledge_artifact_status', 'knowledge_artifact', ['status'], unique=False)
    op.create_index('ix_knowledge_artifact_type', 'knowledge_artifact', ['artifact_type'], unique=False)

    # 2. Create knowledge_chunk table
    op.create_table(
        'knowledge_chunk',
        sa.Column('id', sa.UUID(), nullable=False, comment='主键 ID'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, comment='创建时间'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, comment='更新时间'),
        sa.Column('artifact_id', sa.UUID(), nullable=False, comment='关联的原件 ID'),
        sa.Column('chunk_index', sa.Integer(), nullable=False, comment='在原文中的顺序索引'),
        sa.Column('text_content', sa.Text(), nullable=False, comment='清洗后的切片文本'),
        sa.Column('metadata_summary', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False, comment='切片特定的元数据'),
        sa.Column('embedding_id', sa.UUID(), nullable=True, comment='对应向量库 (Qdrant) 中的 ID'),
        sa.ForeignKeyConstraint(['artifact_id'], ['knowledge_artifact.id'], name=op.f('fk_knowledge_chunk_artifact_id_knowledge_artifact'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_knowledge_chunk'))
    )
    op.create_index('ix_knowledge_chunk_artifact_id', 'knowledge_chunk', ['artifact_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_knowledge_chunk_artifact_id', table_name='knowledge_chunk')
    op.drop_table('knowledge_chunk')
    op.drop_index('ix_knowledge_artifact_type', table_name='knowledge_artifact')
    op.drop_index('ix_knowledge_artifact_status', table_name='knowledge_artifact')
    op.drop_index('ix_knowledge_artifact_source_url', table_name='knowledge_artifact')
    op.drop_table('knowledge_artifact')