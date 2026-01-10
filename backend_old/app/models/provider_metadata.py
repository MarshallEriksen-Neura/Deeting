from __future__ import annotations

from sqlalchemy import Column, String, JSON, Boolean
from .base import Base, UUIDPrimaryKeyMixin, TimestampMixin

class ProviderMetadata(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    Stores AI-generated or manually curated metadata for a Provider.
    This drives the UniversalAdapter.
    """
    __tablename__ = "provider_metadata"

    provider_slug = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=True)
    
    # Basic Config
    base_url = Column(String(1024), nullable=False)
    # e.g. {"type": "bearer", "header": "Authorization", "value_template": "Bearer {api_key}"}
    auth_config = Column(JSON, nullable=False)
    
    # Capability Rules (JMESPath/Regex mappings)
    # e.g. {"chat": {"endpoint": "/v1/chat", "input_map": {...}, "output_map": {...}}}
    endpoints_config = Column(JSON, nullable=True) 
    
    # Rule to fetch/parse /models endpoint
    # e.g. {"endpoint": "/models", "selector": "data[*]", "fields": {"id": "id"}}
    model_list_config = Column(JSON, nullable=True) 
    
    is_active = Column(Boolean, default=True)
    version = Column(String(50), default="1.0.0")
    
    # Validation status
    last_verified_at = Column(String(50), nullable=True) # ISO timestamp

__all__ = ["ProviderMetadata"]
