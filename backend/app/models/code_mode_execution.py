from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.provider_preset import JSONBCompat
from app.utils.time_utils import Datetime

from .base import Base, UUIDPrimaryKeyMixin


class CodeModeExecution(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "code_mode_execution"

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="执行所属用户",
    )
    session_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="业务会话 ID",
    )
    execution_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="运行时 execution_id（runtime.execution_id）",
    )
    trace_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment="trace ID",
    )
    language: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="python",
        server_default="python",
        comment="执行语言",
    )
    code: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="执行代码",
    )
    status: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        index=True,
        comment="success/failed/dry_run",
    )
    format_version: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="响应格式版本",
    )
    runtime_protocol_version: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="运行时协议版本",
    )
    runtime_context: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="runtime 元信息快照",
    )
    tool_plan_results: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="tool_plan 执行摘要与步骤",
    )
    runtime_tool_calls: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="运行时工具调用轨迹",
    )
    render_blocks: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="渲染块快照",
    )
    error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="错误信息",
    )
    error_code: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
        comment="错误码",
    )
    duration_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="执行耗时（毫秒）",
    )
    request_meta: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="请求元信息（如 code_chars/tool_plan_steps）",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=Datetime.now,
        nullable=False,
        server_default=text("now()"),
        comment="创建时间",
    )

    __table_args__ = (
        Index("ix_code_mode_execution_created_at", "created_at"),
        Index("ix_code_mode_execution_user_created", "user_id", "created_at"),
    )


__all__ = ["CodeModeExecution"]
