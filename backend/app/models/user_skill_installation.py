from __future__ import annotations

import uuid

from sqlalchemy import UUID as SA_UUID
from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.provider_preset import JSONBCompat


class UserSkillInstallation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_skill_installation"
    __table_args__ = (
        UniqueConstraint("user_id", "skill_id", name="uq_user_skill_installation_user"),
        Index("ix_user_skill_installation_user", "user_id"),
        Index("ix_user_skill_installation_skill", "skill_id"),
        Index("ix_user_skill_installation_enabled", "is_enabled"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属用户 ID",
    )
    skill_id: Mapped[str] = mapped_column(
        String(120),
        ForeignKey("skill_registry.id", ondelete="CASCADE"),
        nullable=False,
        comment="技能 ID",
    )
    alias: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="用户侧别名",
    )
    config_json: Mapped[dict] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="用户安装配置",
    )
    granted_permissions: Mapped[list[str]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=list,
        server_default="[]",
        comment="用户安装时同意的权限列表",
    )
    installed_revision: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="安装时绑定的源码版本",
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        comment="是否启用该安装项",
    )

    def __repr__(self) -> str:
        return (
            f"<UserSkillInstallation(user={self.user_id}, "
            f"skill={self.skill_id}, enabled={self.is_enabled})>"
        )
