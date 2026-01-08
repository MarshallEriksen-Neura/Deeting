import uuid
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .user import User

class AgentPlugin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "agent_plugin"

    # Basic Info
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False, comment="Plugin unique identifier (e.g. 'official/weather')")
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True, comment="Display name")
    version: Mapped[str] = mapped_column(String(50), default="0.1.0", nullable=False, comment="Semantic version")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="Function description (for vector retrieval)")
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="Icon URL")
    
    # Code/Execution Reference
    module_path: Mapped[str] = mapped_column(String(500), nullable=False, comment="Python module import path or code reference")
    config_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True, comment="Configuration JSON Schema")
    capabilities: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, comment="Capability tags list (e.g. ['search', 'image'])")

    # Permissions and Ownership
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id"), nullable=True, comment="Owner ID (Empty for System plugins)")
    visibility: Mapped[str] = mapped_column(String(20), default="PRIVATE", nullable=False, comment="Visibility: PUBLIC, PRIVATE, SHARED")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Is system built-in")
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Is approved (Only for Public)")

    # Relationships
    owner: Mapped["User"] = relationship("User", backref="owned_plugins", foreign_keys=[owner_id])

    def __repr__(self) -> str:
        return f"<AgentPlugin(name={self.name}, version={self.version})>"
