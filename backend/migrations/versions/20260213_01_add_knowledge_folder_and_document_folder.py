"""add knowledge folder table and user document folder link

Revision ID: 20260213_01_add_knowledge_folder_and_document_folder
Revises: 20260212_01_update_integration_specialist_skills
Create Date: 2026-02-13 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260213_01_add_knowledge_folder_and_document_folder"
down_revision: str | Sequence[str] | None = "20260212_01_update_integration_specialist_skills"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_folder",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False, comment="文件夹名称"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["knowledge_folder.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "parent_id",
            "name",
            name="uq_knowledge_folder_user_parent_name",
        ),
    )
    op.create_index("ix_knowledge_folder_user_id", "knowledge_folder", ["user_id"], unique=False)
    op.create_index(
        "ix_knowledge_folder_parent_id",
        "knowledge_folder",
        ["parent_id"],
        unique=False,
    )
    op.create_index(
        "uq_knowledge_folder_user_root_name",
        "knowledge_folder",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
        sqlite_where=sa.text("parent_id IS NULL"),
    )

    op.add_column("user_document", sa.Column("folder_id", sa.UUID(), nullable=True))
    op.create_index("ix_user_document_folder_id", "user_document", ["folder_id"], unique=False)
    op.create_foreign_key(
        "fk_user_document_folder_id_knowledge_folder",
        "user_document",
        "knowledge_folder",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_user_document_folder_id_knowledge_folder",
        "user_document",
        type_="foreignkey",
    )
    op.drop_index("ix_user_document_folder_id", table_name="user_document")
    op.drop_column("user_document", "folder_id")

    op.drop_index("ix_knowledge_folder_parent_id", table_name="knowledge_folder")
    op.drop_index("ix_knowledge_folder_user_id", table_name="knowledge_folder")
    op.drop_index("uq_knowledge_folder_user_root_name", table_name="knowledge_folder")
    op.drop_table("knowledge_folder")
