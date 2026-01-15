"""
助手与版本模型

支持可见性/发布状态、版本化，以及当前激活版本引用。
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    UUID as SA_UUID,
)
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Float,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class AssistantVisibility(str, enum.Enum):
    PRIVATE = "private"
    UNLISTED = "unlisted"
    PUBLIC = "public"


class AssistantStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Assistant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    助手主表：归属、可见性、发布状态以及当前激活版本
    """

    __tablename__ = "assistant"
    __table_args__ = (
        UniqueConstraint("share_slug", name="uq_assistant_share_slug"),
        Index("ix_assistant_owner", "owner_user_id"),
        Index("ix_assistant_visibility_status", "visibility", "status"),
        Index("ix_assistant_published_at", "published_at"),
    )

    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
        comment="拥有者用户 ID",
    )
    visibility: Mapped[AssistantVisibility] = mapped_column(
        String(20),
        nullable=False,
        default=AssistantVisibility.PRIVATE,
        server_default=AssistantVisibility.PRIVATE.value,
        comment="可见性: private/unlisted/public",
    )
    status: Mapped[AssistantStatus] = mapped_column(
        String(20),
        nullable=False,
        default=AssistantStatus.DRAFT,
        server_default=AssistantStatus.DRAFT.value,
        comment="发布状态: draft/published/archived",
    )
    share_slug: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="分享访问标识（unlisted/public 使用）",
    )
    summary: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        comment="助手简介（两行展示）",
    )
    icon_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="助手图标 ID（如 lucide:bot）",
    )
    install_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="安装量",
    )
    rating_avg: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0.0",
        comment="评分均值",
    )
    rating_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="评分数量",
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant_version.id", ondelete="SET NULL"),
        nullable=True,
        comment="当前激活版本 ID",
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="发布时间",
    )

    # 关系
    versions: Mapped[list["AssistantVersion"]] = relationship(
        "AssistantVersion",
        back_populates="assistant",
        foreign_keys="AssistantVersion.assistant_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AssistantVersion.created_at",
    )
    current_version: Mapped[AssistantVersion | None] = relationship(
        "AssistantVersion",
        foreign_keys="Assistant.current_version_id",
        post_update=True,
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<Assistant(id={self.id}, visibility={self.visibility}, status={self.status})>"


class AssistantVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    助手版本表：承载名称、描述、提示词、模型/技能配置等版本化内容
    """

    __tablename__ = "assistant_version"
    __table_args__ = (
        UniqueConstraint("assistant_id", "version", name="uq_assistant_version_semver"),
        Index("ix_assistant_version_assistant", "assistant_id"),
    )

    assistant_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("assistant.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属助手 ID",
    )
    version: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="语义化版本号，例如 0.1.0",
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="版本名称/展示名",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="描述/用途说明",
    )
    system_prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="系统提示词内容",
    )
    model_config: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="模型与参数配置",
    )
    skill_refs: Mapped[list] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="依赖的技能列表，元素含 skill_id/version 等",
    )
    tags: Mapped[list] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="标签列表",
    )
    changelog: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="版本变更说明",
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="该版本发布时间（与主表状态一致时填写）",
    )

    assistant: Mapped["Assistant"] = relationship(
        "Assistant",
        back_populates="versions",
        foreign_keys="AssistantVersion.assistant_id",
    )

    def __repr__(self) -> str:
        return f"<AssistantVersion(assistant_id={self.assistant_id}, version={self.version})>"
