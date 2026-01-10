from datetime import datetime, timedelta
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


class ApiKeyCreateRequest(BaseModel):
  name: str
  expiration: Literal["never", "7d", "30d", "90d", "custom"]
  expires_at: Optional[datetime] = None
  budget_limit: Optional[float] = None
  allowed_models: list[str] = []
  rate_limit: Optional[int] = None
  allowed_ips: list[str] = []
  enable_logging: bool = True

  @field_validator("expires_at")
  @classmethod
  def validate_expiration(cls, v, info):
    exp = info.data.get("expiration")
    if exp == "custom":
      return v
    return v  # handled in route


class ApiKeyResponse(BaseModel):
  id: UUID
  user_id: UUID | None
  name: str
  prefix: str
  budget_limit: float | None
  budget_used: float
  allowed_models: list[str]
  rate_limit: int | None
  allowed_ips: list[str]
  enable_logging: bool
  status: str
  last_used_at: datetime | None
  expires_at: datetime | None
  created_at: datetime
  updated_at: datetime


class ApiKeyCreateResponse(BaseModel):
  api_key: ApiKeyResponse
  secret: str


class ApiKeyListResponse(BaseModel):
  items: list[ApiKeyResponse]
  total: int
  page: int
  page_size: int
