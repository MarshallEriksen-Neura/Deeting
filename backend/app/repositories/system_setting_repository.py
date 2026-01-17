from typing import Any

from sqlalchemy import select

from app.models.system_setting import SystemSetting
from app.repositories.base import BaseRepository


class SystemSettingRepository(BaseRepository[SystemSetting]):
    model = SystemSetting

    async def get_by_key(self, key: str) -> SystemSetting | None:
        result = await self.session.execute(
            select(SystemSetting).where(SystemSetting.key == key)
        )
        return result.scalars().first()

    async def upsert(self, key: str, value: dict[str, Any]) -> SystemSetting:
        existing = await self.get_by_key(key)
        if existing:
            return await self.update(existing, {"value": value})
        return await self.create({"key": key, "value": value})
