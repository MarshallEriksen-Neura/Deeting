from datetime import datetime

from pydantic import Field

from app.schemas.base import BaseSchema
from app.models.invite_code import InviteCodeStatus


class InviteIssueRequest(BaseSchema):
    count: int = Field(..., gt=0, le=1000, description="生成邀请码数量")
    length: int = Field(12, ge=6, le=32, description="邀请码长度")
    prefix: str | None = Field(None, max_length=8, description="可选前缀")
    expires_at: datetime | None = Field(None, description="过期时间，可为空")
    note: str | None = Field(None, max_length=255, description="备注")


class InviteListItem(BaseSchema):
    code: str
    status: InviteCodeStatus
    expires_at: datetime | None
    used_by: str | None
    used_at: datetime | None
    reserved_at: datetime | None


class InviteListResponse(BaseSchema):
    items: list[InviteListItem]
    total: int
    skip: int
    limit: int


__all__ = ["InviteIssueRequest", "InviteListResponse", "InviteListItem"]
