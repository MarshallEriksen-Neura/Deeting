from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema
from app.models.registration_window import RegistrationWindowStatus


class RegistrationWindowCreate(BaseSchema):
    start_time: datetime = Field(..., description="开始时间 (UTC)")
    end_time: datetime = Field(..., description="结束时间 (UTC)")
    max_registrations: int = Field(..., gt=0, description="最大注册名额")
    auto_activate: bool = Field(True, description="是否自动激活新用户")


class RegistrationWindowRead(BaseSchema):
    id: UUID
    start_time: datetime
    end_time: datetime
    max_registrations: int
    registered_count: int
    auto_activate: bool
    status: RegistrationWindowStatus
