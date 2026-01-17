"""
会话与历史摘要模型

设计目标：
- conversation_session：会话主表，记录通道/租户/用户及活跃状态
- conversation_message：原始消息记录，按 turn_index 有序
- conversation_summary：摘要记录，带血缘（覆盖的消息/turn 范围）
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.utils.time_utils import Datetime


class ConversationChannel(str, enum.Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"


class ConversationStatus(str, enum.Enum):
    ACTIVE = "active"
    CLOSED = "closed"
    ARCHIVED = "archived"


class ConversationRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"
    FUNCTION = "function"


class ConversationSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    会话主表：承载通道/租户/用户归属与活跃状态
    """

    __tablename__ = "conversation_session"
    __table_args__ = (
        Index("ix_conversation_session_tenant_id", "tenant_id"),
        Index("ix_conversation_session_user_id", "user_id"),
        Index("ix_conversation_session_assistant_id", "assistant_id"),
        Index("ix_conversation_session_channel", "channel"),
        Index("ix_conversation_session_status", "status"),
        Index(
            "ix_conversation_session_last_active",
            "last_active_at",
            **(
                {"postgresql_using": "brin"}
                if settings.DATABASE_URL.startswith("postgresql")
                else {}
            ),
        ),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True), nullable=True, comment="租户 ID（外部通道）"
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="用户/服务账号 ID（内部通道）",
    )
    assistant_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="SET NULL"),
        nullable=True,
        comment="助手 ID（内部通道）",
    )
    channel: Mapped[ConversationChannel] = mapped_column(
        String(20),
        nullable=False,
        default=ConversationChannel.INTERNAL,
        server_default=ConversationChannel.INTERNAL.value,
        comment="会话通道 internal/external",
    )
    status: Mapped[ConversationStatus] = mapped_column(
        String(20),
        nullable=False,
        default=ConversationStatus.ACTIVE,
        server_default=ConversationStatus.ACTIVE.value,
        comment="会话状态 active/closed",
    )
    preset_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        nullable=True,
        comment="最后命中的 provider preset ID（可选）",
    )
    title: Mapped[str | None] = mapped_column(
        String(200), nullable=True, comment="会话标题或主题"
    )
    message_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0", comment="累计消息数"
    )
    last_summary_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0", comment="最近一次摘要版本"
    )
    first_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="首条消息时间",
    )
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=Datetime.now,
        server_default=text("CURRENT_TIMESTAMP"),
        comment="最近活跃时间",
    )


class ConversationMessage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    会话消息表：存储原始对话轮次
    """

    __tablename__ = "conversation_message"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "turn_index",
            name="uq_conversation_message_turn",
        ),
        Index("ix_conversation_message_session_id", "session_id"),
        Index(
            "ix_conversation_message_created_at",
            "created_at",
            **(
                {"postgresql_using": "brin"}
                if settings.DATABASE_URL.startswith("postgresql")
                else {}
            ),
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("conversation_session.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联会话 ID",
    )
    turn_index: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="会话内的顺序（从 1 开始）"
    )
    role: Mapped[ConversationRole] = mapped_column(
        String(32), nullable=False, comment="消息角色 user/assistant/system/tool"
    )
    name: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="可选：tool/function 名称"
    )
    content: Mapped[str] = mapped_column(
        Text, nullable=False, comment="消息内容"
    )
    token_estimate: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0", comment="估算 token 数（用于窗口判定）"
    )
    is_truncated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", comment="是否为截断内容"
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否被用户删除（软删除，保留审计）",
    )
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("conversation_message.id", ondelete="SET NULL"),
        nullable=True,
        comment="源消息 ID（用于重新生成/引用）",
    )


class ConversationSummary(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    会话摘要表：记录压缩后的摘要与覆盖范围（血缘）
    """

    __tablename__ = "conversation_summary"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "version",
            name="uq_conversation_summary_version",
        ),
        Index("ix_conversation_summary_session_id", "session_id"),
        Index("ix_conversation_summary_covered_to", "covered_to_turn"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("conversation_session.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联会话 ID",
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="摘要版本号（递增）"
    )
    summary_text: Mapped[str] = mapped_column(
        Text, nullable=False, comment="摘要内容"
    )
    covered_from_turn: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="摘要覆盖的起始 turn"
    )
    covered_to_turn: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="摘要覆盖的结束 turn"
    )
    start_message_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("conversation_message.id", ondelete="SET NULL"),
        nullable=True,
        comment="摘要覆盖的首条消息 ID",
    )
    end_message_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("conversation_message.id", ondelete="SET NULL"),
        nullable=True,
        comment="摘要覆盖的末条消息 ID",
    )
    token_estimate: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0", comment="摘要的估算 token 数"
    )
    summarizer_model: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="生成摘要的模型名称"
    )
    summarizer_preset_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True), nullable=True, comment="生成摘要所用 preset ID"
    )
