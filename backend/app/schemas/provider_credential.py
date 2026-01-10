from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ProviderCredentialCreate(BaseModel):
    alias: str = Field(..., description="凭证别名")
    secret_ref_id: str = Field(..., description="密钥引用 ID/环境变量名")
    weight: int = Field(0, description="权重偏移")
    priority: int = Field(0, description="优先级偏移")
    is_active: bool = Field(True, description="是否启用")


class ProviderCredentialResponse(BaseModel):
    id: UUID
    instance_id: UUID
    alias: str
    weight: int
    priority: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
