import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RegistrationWindowStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    CLOSED = "closed"


class RegistrationWindow(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """注册窗口配置，用于控制是否开放注册以及容量。"""

    __tablename__ = "registration_windows"

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_registrations: Mapped[int] = mapped_column(Integer, nullable=False)
    registered_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    auto_activate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[RegistrationWindowStatus] = mapped_column(
        Enum(
            RegistrationWindowStatus,
            name="registrationwindowstatus",
            native_enum=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=RegistrationWindowStatus.SCHEDULED,
    )


__all__ = ["RegistrationWindow", "RegistrationWindowStatus"]
