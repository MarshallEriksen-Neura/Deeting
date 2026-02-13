from __future__ import annotations

import uuid

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class KnowledgeFolder(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """用户知识库文件夹。"""

    __tablename__ = "knowledge_folder"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "parent_id",
            "name",
            name="uq_knowledge_folder_user_parent_name",
        ),
        Index(
            "uq_knowledge_folder_user_root_name",
            "user_id",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
            sqlite_where=text("parent_id IS NULL"),
        ),
        Index("ix_knowledge_folder_user_id", "user_id"),
        Index("ix_knowledge_folder_parent_id", "parent_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="归属用户",
    )

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("knowledge_folder.id", ondelete="CASCADE"),
        nullable=True,
        comment="父级目录 ID，根目录为 null",
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="文件夹名称",
    )

    parent: Mapped["KnowledgeFolder | None"] = relationship(
        "KnowledgeFolder",
        remote_side="KnowledgeFolder.id",
        backref="children",
    )

    def __repr__(self) -> str:
        return (
            f"<KnowledgeFolder(id={self.id}, user_id={self.user_id}, "
            f"parent_id={self.parent_id}, name={self.name})>"
        )
