from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SkillDependency(Base):
    """
    技能依赖声明
    """

    __tablename__ = "skill_dependency"

    skill_id: Mapped[str] = mapped_column(
        String(120),
        ForeignKey("skill_registry.id", ondelete="CASCADE"),
        primary_key=True,
        comment="技能 ID",
    )
    value: Mapped[str] = mapped_column(
        String(128),
        primary_key=True,
        comment="依赖技能标识",
    )

    def __repr__(self) -> str:
        return f"<SkillDependency(skill_id={self.skill_id}, value={self.value})>"
