from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Identity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """外部身份映射（用于 OAuth 绑定）。"""

    __tablename__ = "identity"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_identity_provider_external"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
        comment="关联的用户 ID",
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False, comment="身份提供方")
    external_id: Mapped[str] = mapped_column(String(255), nullable=False, comment="提供方的用户唯一标识")
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="提供方展示名")

    user = relationship("User", back_populates="identities")


__all__ = ["Identity"]
