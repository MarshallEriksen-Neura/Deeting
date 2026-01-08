
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.provider_preset import ProviderPreset, ProviderPresetItem

from .base import BaseRepository


class ProviderPresetRepository(BaseRepository[ProviderPreset]):
    model = ProviderPreset

    async def get_by_slug(self, slug: str) -> ProviderPreset | None:
        result = await self.session.execute(
            select(ProviderPreset).where(ProviderPreset.slug == slug)
        )
        return result.scalars().first()

    async def get_with_items(self, slug: str) -> ProviderPreset | None:
        """获取预设及其所有子项"""
        result = await self.session.execute(
            select(ProviderPreset)
            .options(selectinload(ProviderPreset.items))
            .where(ProviderPreset.slug == slug)
        )
        return result.scalars().first()

    async def get_active_presets(self) -> list[ProviderPreset]:
        result = await self.session.execute(
            select(ProviderPreset).where(ProviderPreset.is_active == True)
        )
        return list(result.scalars().all())


class ProviderPresetItemRepository(BaseRepository[ProviderPresetItem]):
    model = ProviderPresetItem

    async def get_by_capability(
        self,
        preset_id: str,
        capability: str,
        model: str | None = None,
        unified_model_id: str | None = None,
        channel: str | None = None,
    ) -> list[ProviderPresetItem]:
        """
        根据 capability 查找路由项
        支持可选的 model 与 channel 过滤
        """
        stmt = select(ProviderPresetItem).where(
            ProviderPresetItem.preset_id == preset_id,
            ProviderPresetItem.capability == capability,
            ProviderPresetItem.is_active == True,
        )

        if model:
            stmt = stmt.where(ProviderPresetItem.model == model)

        if unified_model_id:
            stmt = stmt.where(ProviderPresetItem.unified_model_id == unified_model_id)

        if channel:
            # channel=external 允许 external / both；internal 允许 internal / both
            if channel == "external":
                stmt = stmt.where(ProviderPresetItem.channel.in_(["external", "both"]))
            elif channel == "internal":
                stmt = stmt.where(ProviderPresetItem.channel.in_(["internal", "both"]))

        # 按优先级降序、权重降序排列
        stmt = stmt.order_by(
            ProviderPresetItem.priority.desc(),
            ProviderPresetItem.weight.desc(),
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().all())
