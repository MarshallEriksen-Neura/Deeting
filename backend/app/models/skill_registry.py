from __future__ import annotations

from typing import Any

from sqlalchemy import Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.provider_preset import JSONBCompat


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
    type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="SKILL",
        server_default="SKILL",
        comment="资源类型: SKILL",
    )
    runtime: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
        comment="运行时类型（如 opensandbox）",
    )
    version: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="语义化版本号",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="技能描述",
    )
    source_repo: Mapped[str | None] = mapped_column(
        String(1024),
        nullable=True,
        comment="源码仓库地址",
    )
    source_subdir: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="源码子目录",
    )
    source_revision: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="源码版本/提交",
    )
    risk_level: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        comment="风险等级",
    )
    complexity_score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="复杂度评分",
    )
    manifest_json: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="技能清单/Manifest",
    )
    env_requirements: Mapped[dict[str, Any]] = mapped_column(
        JSONBCompat,
        nullable=False,
        default=dict,
        server_default="{}",
        comment="运行环境依赖",
    )
    vector_id: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="向量索引 ID",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="draft",
        server_default="draft",
        comment="技能状态: draft/active/disabled",
    )

    def __init__(self, **kwargs: Any) -> None:
        if kwargs.get("type") is None:
            kwargs["type"] = "SKILL"
        if kwargs.get("status") is None:
            kwargs["status"] = "draft"
        if kwargs.get("manifest_json") is None:
            kwargs["manifest_json"] = {}
        if kwargs.get("env_requirements") is None:
            kwargs["env_requirements"] = {}
        super().__init__(**kwargs)

    def __repr__(self) -> str:
        return f"<SkillRegistry(id={self.id}, name={self.name})>"
