import uuid
from datetime import datetime

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import DateTime, MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.utils.time_utils import Datetime

# 统一的 Metadata 命名约定
# 方便 Alembic 自动生成有意义的约束名
POSTGRES_NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

class Base(DeclarativeBase):
    """SQLAlchemy 2.0 声明式基类"""
    metadata = MetaData(naming_convention=POSTGRES_NAMING_CONVENTION)

class UUIDPrimaryKeyMixin:
    """UUID 主键 Mixin"""
    id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="主键 ID"
    )

class TimestampMixin:
    """
    时间戳 Mixin
    使用 app.utils.time_utils.Datetime 确保时区一致性
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=Datetime.now,
        nullable=False,
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=Datetime.now,
        onupdate=Datetime.now,
        nullable=False,
        comment="更新时间"
    )
