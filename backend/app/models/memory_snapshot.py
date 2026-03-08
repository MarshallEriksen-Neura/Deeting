import uuid

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class MemorySnapshot(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Memory audit trail snapshot.

    Records changes (update/delete/rollback) to user memories stored in Qdrant,
    enabling rollback and audit capabilities.
    """

    __tablename__ = "memory_snapshots"

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Owner user ID",
    )

    memory_point_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="Qdrant point ID of the memory",
    )

    action: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Action type: update, delete, rollback",
    )

    old_content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Content before the change",
    )

    new_content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Content after the change",
    )

    old_metadata: Mapped[dict | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="Payload metadata before the change",
    )

    new_metadata: Mapped[dict | None] = mapped_column(
        JSONBCompat,
        nullable=True,
        comment="Payload metadata after the change",
    )
