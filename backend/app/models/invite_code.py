import enum
import uuid
from datetime import datetime

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InviteCodeStatus(str, enum.Enum):
    UNUSED = "unused"
    RESERVED = "reserved"
    USED = "used"
    REVOKED = "revoked"


class InviteCode(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """注册邀请码，与注册窗口绑定，用于控制注册名额。"""

    __tablename__ = "invite_codes"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True, comment="邀请码")
    status: Mapped[InviteCodeStatus] = mapped_column(
        Enum(
            InviteCodeStatus,
            name="invitecodestatus",
            native_enum=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=InviteCodeStatus.UNUSED,
    )
    window_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("registration_windows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属注册窗口",
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="过期时间")
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="预占时间")
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="使用时间")
    used_by: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="使用该邀请码的用户",
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="备注")

    window: Mapped["RegistrationWindow"] = relationship("RegistrationWindow")


__all__ = ["InviteCode", "InviteCodeStatus"]
