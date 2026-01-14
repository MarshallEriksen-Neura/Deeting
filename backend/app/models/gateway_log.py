import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, Integer, String, text
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings

from .base import Base, UUIDPrimaryKeyMixin


class GatewayLog(Base, UUIDPrimaryKeyMixin):
    """
    Gateway Log (网关日志 - 真源表)
    存储所有 API 调用的详细记录
    """
    __tablename__ = "gateway_log"

    user_id: Mapped[uuid.UUID | None] = mapped_column(SA_UUID(as_uuid=True), index=True, comment="调用者用户 ID")
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(SA_UUID(as_uuid=True), index=True, comment="调用使用的 API Key ID")
    preset_id: Mapped[uuid.UUID | None] = mapped_column(SA_UUID(as_uuid=True), index=True, comment="命中的预设 ID")

    model: Mapped[str] = mapped_column(String(128), nullable=False, comment="请求的上游模型名称")
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, index=True, comment="响应状态码")

    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, comment="总耗时(ms)")
    ttft_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="首包时间(ms)")

    # 上游信息
    upstream_url: Mapped[str | None] = mapped_column(String(512), nullable=True, comment="上游地址")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="重试次数")

    # Token 统计
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # 计费统计
    cost_upstream: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0.0", comment="上游成本")
    cost_user: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0.0", comment="用户扣费")

    is_cached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="统一错误码")

    # 扩展元数据 (请求摘要、选路结果、计费详情等)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, comment="扩展元数据")

    # 时间戳 (使用 BRIN 索引优化的创建时间)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        comment="创建时间"
    )

    __table_args__ = (
        Index(
            "idx_gateway_log_created_at",
            created_at,
            **({"postgresql_using": "brin"} if settings.DATABASE_URL.startswith("postgresql") else {}),
        ),
    )

    def __repr__(self) -> str:
        return f"<GatewayLog(id={self.id}, model={self.model}, status={self.status_code})>"
