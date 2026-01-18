import uuid
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin

class UserSecretary(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    User's Personal Secretary Instance.
    One-to-One relationship with User.
    """
    __tablename__ = "user_secretary"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_account.id"),
        unique=True,
        nullable=False,
        comment="Owner User ID",
    )

    name: Mapped[str] = mapped_column(
        String(50),
        default="deeting",
        nullable=False,
        comment="Secretary Name",
    )
    model_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="秘书使用的模型名称",
    )

    def __repr__(self) -> str:
        return f"<UserSecretary(user_id={self.user_id}, model_name={self.model_name})>"
