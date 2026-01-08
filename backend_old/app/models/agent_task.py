from __future__ import annotations

from enum import Enum
from sqlalchemy import Column, String, Integer, Text, ForeignKey, JSON, Boolean
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from .base import Base, UUIDPrimaryKeyMixin, TimestampMixin

class AgentTaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class AgentTaskType(str, Enum):
    CRAWL = "crawl"
    UPLOAD = "upload"
    RULE_GEN = "rule_gen"
    PRESET_DISCOVER = "preset_discover"

class AgentTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    Represents a background task performed by an internal agent (Crawler, Ingestor, RuleGen).
    """
    __tablename__ = "agent_tasks"

    task_type = Column(String(50), nullable=False) # crawl, upload, etc.
    status = Column(String(50), nullable=False, default=AgentTaskStatus.PENDING.value)
    
    # Inputs
    target_url = Column(String(2048), nullable=True) # For crawl
    target_file_path = Column(String(1024), nullable=True) # For upload (temp path)
    provider_slug = Column(String(255), nullable=True) # Related provider
    
    # Configuration
    depth = Column(Integer, default=1)
    max_pages = Column(Integer, default=10)
    tags = Column(JSON, nullable=True) # ["v1", "official"]
    config = Column(JSON, nullable=True) # JSON config for Playwright/Parser
    # Execution timeline & state
    steps = Column(JSON, nullable=True)  # [{"name": "...", "status": "...", "message": "...", "progress": 10, "started_at": "...", "ended_at": "...", "tool_call": {...}}]
    progress = Column(Integer, default=0)  # 0-100
    current_phase = Column(String(255), nullable=True)
    scratchpad = Column(JSON, nullable=True)  # LLM chain-of-thought / intermediate memory

    # Execution State
    celery_task_id = Column(String(255), nullable=True)
    worker_node = Column(String(255), nullable=True)
    
    # Outputs
    result_summary = Column(JSON, nullable=True) # {"pages": 5, "chunks": 20}
    error_message = Column(Text, nullable=True)
    logs = Column(JSON, nullable=True) # Structured logs
    
    # User Context
    created_by_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_by = relationship("User", foreign_keys=[created_by_id])

class IngestRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    Tracks individual chunks/documents ingested into Qdrant.
    Useful for "undo" or "overwrite" strategies.
    """
    __tablename__ = "ingest_records"
    
    agent_task_id = Column(PG_UUID(as_uuid=True), ForeignKey("agent_tasks.id"), nullable=False, index=True)
    
    qdrant_collection = Column(String(255), nullable=False)
    qdrant_point_id = Column(String(255), nullable=False) # UUID of the point
    
    chunk_hash = Column(String(64), nullable=True) # For dedupe
    doc_source_url = Column(String(2048), nullable=True)

__all__ = ["AgentTask", "IngestRecord", "AgentTaskStatus", "AgentTaskType"]
