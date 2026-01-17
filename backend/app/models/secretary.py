import uuid
from sqlalchemy import Boolean, ForeignKey, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship, backref

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin

class SecretaryPhase(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Definition of Secretary Capabilities/Stages.
    Acts as a Feature Flag set or Configuration Profile.
    Example records: "Onboarding", "Standard", "Pro-With-Memory"
    """
    __tablename__ = "secretary_phase"

    name: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False, comment="Phase Name (e.g. 'alpha', 'v1')")
    description: Mapped[str | None] = mapped_column(Text, comment="Internal description")

    # Capability Switches
    enable_retrieval: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Enable RAG/Qdrant Retrieval")
    enable_ingest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Enable Memory Ingestion")
    enable_compression: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Enable History Compression")

    # Detailed Policies (JSONB)
    # Structure:
    # {
    #   "whitelist": { "allow_domains": [...], "deny_topics": [...] },
    #   "vector_policy": { "collection": "agent_memory", "min_score": 0.7 },
    #   "compression_policy": { "strategy": "summary", "trigger_tokens": 4000 }
    # }
    policy_config: Mapped[dict] = mapped_column(JSON, default={}, nullable=False, comment="Detailed Policy Configuration")


class UserSecretary(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    User's Personal Secretary Instance.
    One-to-One relationship with User.
    """
    __tablename__ = "user_secretary"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user_account.id"), unique=True, nullable=False, comment="Owner User ID")
    
    # State / Configuration
    current_phase_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("secretary_phase.id"), nullable=False, comment="Current Capability Phase")
    
    # Persona / Customization
    name: Mapped[str] = mapped_column(String(50), default="My Secretary", nullable=False, comment="Secretary Name")
    custom_instructions: Mapped[str | None] = mapped_column(Text, comment="User-defined system prompt additions")
    model_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="秘书使用的模型名称",
    )
    embedding_model: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="秘书向量使用的 embedding 模型名称",
    )
    topic_naming_model: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="话题自动命名使用的模型名称",
    )
    
    # Metadata for UI or Extensions
    ui_preferences: Mapped[dict | None] = mapped_column(JSON, comment="UI specific settings (avatar, theme)")

    # Relationships
    # user = relationship("User", backref=backref("secretary", uselist=False)) # Already defined in user.py if backref used there, otherwise here.
    phase: Mapped["SecretaryPhase"] = relationship("SecretaryPhase")

    def __repr__(self) -> str:
        return f"<UserSecretary(user_id={self.user_id}, phase={self.current_phase_id})>"
