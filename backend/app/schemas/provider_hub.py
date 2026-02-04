from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    description: str | None = None
    icon: str | None = None
    theme_color: str | None = None
    base_url: str | None = None
    url_template: str | None = None
    tags: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    is_popular: bool = False
    sort_order: int = 0

    connected: bool = False
    instances: list[ProviderInstanceSummary] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ProviderHubStats(BaseModel):
    total: int
    connected: int
    by_category: dict[str, int] = Field(default_factory=dict)


class ProviderHubResponse(BaseModel):
    providers: list[ProviderCard]
    stats: ProviderHubStats
