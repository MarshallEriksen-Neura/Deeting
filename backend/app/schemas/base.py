from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BaseSchema(BaseModel):
    """
    基础 Schema
    配置:
    - strict=True: 严格类型检查 (Pydantic V2)
    - from_attributes=True: 允许从 ORM 对象读取 (替代 V1 的 orm_mode)
    """
    model_config = ConfigDict(from_attributes=True, strict=False, populate_by_name=True, extra="ignore")

class IDSchema(BaseSchema):
    id: UUID

class TimestampSchema(BaseSchema):
    created_at: datetime
    updated_at: datetime
