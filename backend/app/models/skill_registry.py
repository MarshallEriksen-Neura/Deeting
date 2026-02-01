from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SkillRegistry(Base, TimestampMixin):
    __tablename__ = "skill_registry"

    id: Mapped[str] = mapped_column(
        String(120),
        primary_key=True,
        comment="技能唯一标识（如 core.tools.crawler）",
    )
    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="技能名称",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="draft",
        server_default="draft",
        comment="技能状态: draft/active/disabled",
    )

    def __repr__(self) -> str:
        return f"<SkillRegistry(id={self.id}, name={self.name})>"
