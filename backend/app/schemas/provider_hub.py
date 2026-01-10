from typing import List, Optional, Dict
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class ProviderInstanceSummary(BaseModel):
    id: UUID
    name: str
    is_enabled: bool
    health_status: str | None = "unknown"
    latency_ms: int | None = 0

    model_config = ConfigDict(from_attributes=True)


class ProviderCard(BaseModel):
    slug: str
    name: str
    provider: str
    category: str
    description: Optional[str] = None
    icon: Optional[str] = None
    theme_color: Optional[str] = None
    base_url: Optional[str] = None
    url_template: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    capabilities: List[str] = Field(default_factory=list)
    is_popular: bool = False
    sort_order: int = 0

    connected: bool = False
    instances: List[ProviderInstanceSummary] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ProviderHubStats(BaseModel):
    total: int
    connected: int
    by_category: Dict[str, int] = Field(default_factory=dict)


class ProviderHubResponse(BaseModel):
    providers: List[ProviderCard]
    stats: ProviderHubStats
