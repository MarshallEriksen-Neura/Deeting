from __future__ import annotations

import uuid
from typing import Any, Dict

from sqlalchemy import (
    Column,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import UUID as SA_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider_preset import JSONBCompat

class KnowledgeArtifact(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Knowledge Artifact (知识原件)
    存储从 Scout 爬取回来的原始知识，作为 RAG 和 自动化配置的源头。
    """
    __tablename__ = "knowledge_artifact"
    __table_args__ = (
        Index("ix_knowledge_artifact_source_url", "source_url", unique=True),
        Index("ix_knowledge_artifact_status", "status"),
        Index("ix_knowledge_artifact_type", "artifact_type"),
    )

    source_url: Mapped[str] = mapped_column(String(1024), nullable=False, comment="来源 URL")
    title: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="网页标题")
    
    raw_content: Mapped[str] = mapped_column(Text, nullable=False, comment="原始爬取内容 (Markdown)")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, comment="内容哈希，用于检测变更")
    
    artifact_type: Mapped[str] = mapped_column(
        String(50), 
        nullable=False, 
        default="documentation", 
        server_default="'documentation'",
        comment="知识类型: documentation, assistant, provider_spec"
    )
    
    status: Mapped[str] = mapped_column(
        String(24), 
        nullable=False, 
        default="pending", 
        server_default="'pending'",
        comment="状态: pending, processing, indexed, failed"
    )
    
    meta_info: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat, 
        nullable=False, 
        default=dict, 
        server_default="{}", 
        comment="灵活的元数据 (如深度、父级、媒体信息等)"
    )

    # 关系映射
    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        "KnowledgeChunk", back_populates="artifact", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<KnowledgeArtifact(url={self.source_url}, type={self.artifact_type}, status={self.status})>"


class KnowledgeChunk(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Knowledge Chunk (知识切片)
    原始知识经过精炼、清洗后的原子块，通常对应 Qdrant 中的一个 Point。
    """
    __tablename__ = "knowledge_chunk"
    __table_args__ = (
        Index("ix_knowledge_chunk_artifact_id", "artifact_id"),
    )

    artifact_id: Mapped[uuid.UUID] = mapped_column(
        SA_UUID(as_uuid=True),
        ForeignKey("knowledge_artifact.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联的原件 ID"
    )
    
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, comment="在原文中的顺序索引")
    
    text_content: Mapped[str] = mapped_column(Text, nullable=False, comment="清洗后的切片文本")
    
    metadata_summary: Mapped[Dict[str, Any]] = mapped_column(
        JSONBCompat, 
        nullable=False, 
        default=dict, 
        server_default="{}", 
        comment="切片特定的元数据 (如对应的 Header, 代码语言等)"
    )
    
    embedding_id: Mapped[uuid.UUID | None] = mapped_column(
        SA_UUID(as_uuid=True), 
        nullable=True, 
        comment="对应向量库 (Qdrant) 中的 ID"
    )

    # 关系映射
    artifact: Mapped["KnowledgeArtifact"] = relationship("KnowledgeArtifact", back_populates="chunks")

    def __repr__(self) -> str:
        return f"<KnowledgeChunk(artifact={self.artifact_id}, index={self.chunk_index})>"
