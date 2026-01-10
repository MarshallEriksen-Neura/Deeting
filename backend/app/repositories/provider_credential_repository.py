import uuid
from collections import defaultdict
from typing import Dict, List

from sqlalchemy import select

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.models.provider_instance import ProviderCredential

from .base import BaseRepository


class ProviderCredentialRepository(BaseRepository[ProviderCredential]):
    model = ProviderCredential

    async def get_by_instance_ids(self, instance_ids: list[str]) -> Dict[str, List[ProviderCredential]]:
        """
        获取指定实例的全部启用凭证，按 instance_id 归组。
        """
        if not instance_ids:
            return {}

        instance_uuid = []
        for iid in instance_ids:
            try:
                instance_uuid.append(uuid.UUID(str(iid)))
            except Exception:
                continue

        if not instance_uuid:
            return {}

        async def load_for_instance(iid: uuid.UUID) -> List[ProviderCredential]:
            stmt = select(ProviderCredential).where(
                ProviderCredential.instance_id == iid,
                ProviderCredential.is_active == True,  # noqa: E712
            )
            result = await self.session.execute(stmt)
            return list(result.scalars().all())

        grouped: Dict[str, List[ProviderCredential]] = defaultdict(list)
        for iid in instance_uuid:
            key = CacheKeys.provider_credentials(str(iid))
            rows = await cache.get_or_set_singleflight(
                key,
                loader=lambda iid=iid: load_for_instance(iid),
                ttl=cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
            )
            if rows:
                grouped[str(iid)].extend(rows)

        return grouped
