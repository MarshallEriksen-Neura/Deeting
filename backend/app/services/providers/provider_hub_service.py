import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.logging import logger
from app.repositories.provider_instance_repository import ProviderInstanceRepository
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.schemas.provider_hub import (
    ProviderCard,
    ProviderHubResponse,
    ProviderHubStats,
    ProviderInstanceSummary,
)
from app.services.providers.health_monitor import HealthMonitorService


DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "provider_presets.json"


class ProviderHubService:
    """
    聚合系统模板 + 用户实例，输出给前端 Hub/Drawer。
    """

    _preset_cache: list[dict[str, Any]] | None = None

    def __init__(self, session: AsyncSession):
        self.session = session
        self.preset_repo = ProviderPresetRepository(session)
        self.instance_repo = ProviderInstanceRepository(session)
        self.health_svc = HealthMonitorService(cache.redis)

    @classmethod
    def _load_presets(cls) -> list[dict[str, Any]]:
        if cls._preset_cache is not None:
            return cls._preset_cache
        try:
            with DATA_FILE.open("r", encoding="utf-8") as f:
                cls._preset_cache = json.load(f)
        except FileNotFoundError:
            logger.warning("provider_presets_fixture_missing", extra={"path": str(DATA_FILE)})
            cls._preset_cache = []
        except Exception as exc:
            logger.error("provider_presets_fixture_load_failed", extra={"error": str(exc)})
            cls._preset_cache = []
        return cls._preset_cache

    async def _merge_presets(self) -> list[dict[str, Any]]:
        """
        将数据库活跃模板与本地 fixture 合并（以 DB 为主，缺失字段由 fixture 填充）。
        """
        fixtures = {item["slug"]: item for item in self._load_presets()}
        db_presets = await self.preset_repo.get_active_presets()
        merged: list[dict[str, Any]] = []

        if db_presets:
            for preset in db_presets:
                base = fixtures.get(preset.slug, {})
                merged.append(
                    {
                        "slug": preset.slug,
                        "name": preset.name,
                        "provider": preset.provider,
                        "category": preset.category or base.get("category", ""),
                        "description": base.get("description"),
                        "icon": preset.icon or base.get("icon"),
                        "theme_color": preset.theme_color or base.get("theme_color"),
                        "base_url": preset.base_url,
                        "url_template": preset.url_template or base.get("url_template"),
                        "auth_type": base.get("auth_type"),
                        "auth_config": base.get("auth_config", {}),
                        "default_headers": base.get("default_headers", {}),
                        "default_params": base.get("default_params", {}),
                        "tags": base.get("tags", []),
                        "capabilities": base.get("capabilities", []),
                        "is_popular": base.get("is_popular", False),
                        "sort_order": base.get("sort_order", 0),
                    }
                )
        else:
            merged = list(fixtures.values())

        return merged

    async def hub(
        self,
        user_id: Optional[str],
        category: Optional[str] = None,
        q: Optional[str] = None,
        include_public: bool = True,
    ) -> ProviderHubResponse:
        presets = await self._merge_presets()
        instances = await self.instance_repo.get_available_instances(user_id=user_id, include_public=include_public)

        health_cache: Dict[str, dict] = {}
        cards: List[ProviderCard] = []
        category_lower = category.lower() if category else None
        q_lower = q.lower().strip() if q else None

        for preset in sorted(presets, key=lambda x: x.get("sort_order", 0)):
            if category_lower and category_lower != "all":
                if (preset.get("category") or "").lower() != category_lower:
                    continue

            if q_lower:
                haystack = " ".join(
                    [preset.get("name", ""), preset.get("slug", ""), preset.get("description", "")]
                ).lower()
                if q_lower not in haystack:
                    continue

            # 关联实例
            related_instances = [inst for inst in instances if inst.preset_slug == preset.get("slug")]
            summaries: List[ProviderInstanceSummary] = []
            for inst in related_instances:
                try:
                    health = health_cache.get(str(inst.id))
                    if health is None:
                        health = await self.health_svc.get_health_status(str(inst.id))
                        health_cache[str(inst.id)] = health or {}
                    summary = ProviderInstanceSummary(
                        id=inst.id,
                        name=inst.name,
                        is_enabled=inst.is_enabled,
                        health_status=health.get("status", "unknown") if isinstance(health, dict) else "unknown",
                        latency_ms=health.get("latency", 0) if isinstance(health, dict) else 0,
                    )
                    summaries.append(summary)
                except Exception:
                    summaries.append(
                        ProviderInstanceSummary(
                            id=inst.id,
                            name=inst.name,
                            is_enabled=inst.is_enabled,
                            health_status="unknown",
                            latency_ms=0,
                        )
                    )

            card = ProviderCard(
                slug=preset["slug"],
                name=preset["name"],
                provider=preset.get("provider", preset["slug"]),
                category=preset.get("category", "Cloud API"),
                description=preset.get("description"),
                icon=preset.get("icon"),
                theme_color=preset.get("theme_color"),
                base_url=preset.get("base_url"),
                url_template=preset.get("url_template"),
                tags=preset.get("tags", []),
                capabilities=preset.get("capabilities", []),
                is_popular=bool(preset.get("is_popular", False)),
                sort_order=preset.get("sort_order", 0),
                connected=len(summaries) > 0,
                instances=summaries,
            )
            cards.append(card)

        stats = self._build_stats(cards)
        return ProviderHubResponse(providers=cards, stats=stats)

    def _build_stats(self, cards: List[ProviderCard]) -> ProviderHubStats:
        total = len(cards)
        connected = sum(1 for c in cards if c.connected)
        by_category: Dict[str, int] = {}
        for c in cards:
            key = (c.category or "unknown").lower()
            by_category[key] = by_category.get(key, 0) + 1
        return ProviderHubStats(total=total, connected=connected, by_category=by_category)

    async def detail(
        self,
        slug: str,
        user_id: Optional[str],
        include_public: bool = True,
    ) -> Optional[ProviderCard]:
        resp = await self.hub(user_id=user_id, include_public=include_public)
        for item in resp.providers:
            if item.slug == slug:
                return item
        return None
