from __future__ import annotations

from app.core.config import settings


def meilisearch_is_configured() -> bool:
    url = str(getattr(settings, "MEILISEARCH_URL", "") or "").strip()
    return bool(url)
