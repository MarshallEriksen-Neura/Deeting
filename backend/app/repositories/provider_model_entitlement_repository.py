from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Iterable

from sqlalchemy import select

from app.models.provider_instance import ProviderModelEntitlement

from .base import BaseRepository


class ProviderModelEntitlementRepository(BaseRepository[ProviderModelEntitlement]):
    model = ProviderModelEntitlement

    async def get_by_user_and_model(
        self,
        user_id: str | uuid.UUID,
        provider_model_id: str | uuid.UUID,
    ) -> ProviderModelEntitlement | None:
        if isinstance(user_id, str):
            user_id = uuid.UUID(str(user_id))
        if isinstance(provider_model_id, str):
            provider_model_id = uuid.UUID(str(provider_model_id))

        stmt = select(ProviderModelEntitlement).where(
            ProviderModelEntitlement.user_id == user_id,
            ProviderModelEntitlement.provider_model_id == provider_model_id,
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def has_entitlement(
        self,
        user_id: str | uuid.UUID,
        provider_model_id: str | uuid.UUID,
    ) -> bool:
        return (
            await self.get_by_user_and_model(
                user_id=user_id,
                provider_model_id=provider_model_id,
            )
        ) is not None

    async def list_purchased_model_ids(
        self,
        user_id: str | uuid.UUID,
        provider_model_ids: Iterable[str | uuid.UUID],
    ) -> set[str]:
        if isinstance(user_id, str):
            user_id = uuid.UUID(str(user_id))

        model_uuid_list: list[uuid.UUID] = []
        for item in provider_model_ids:
            if isinstance(item, uuid.UUID):
                model_uuid_list.append(item)
                continue
            try:
                model_uuid_list.append(uuid.UUID(str(item)))
            except Exception:
                continue

        if not model_uuid_list:
            return set()

        stmt = select(ProviderModelEntitlement.provider_model_id).where(
            ProviderModelEntitlement.user_id == user_id,
            ProviderModelEntitlement.provider_model_id.in_(model_uuid_list),
        )
        result = await self.session.execute(stmt)
        return {str(row[0]) for row in result.all()}

    async def create_if_absent(
        self,
        *,
        user_id: str | uuid.UUID,
        provider_model_id: str | uuid.UUID,
        purchase_price: Decimal | float,
        currency: str = "credits",
        source_tx_trace_id: str | None = None,
    ) -> ProviderModelEntitlement:
        existing = await self.get_by_user_and_model(
            user_id=user_id,
            provider_model_id=provider_model_id,
        )
        if existing:
            return existing

        if isinstance(user_id, str):
            user_id = uuid.UUID(str(user_id))
        if isinstance(provider_model_id, str):
            provider_model_id = uuid.UUID(str(provider_model_id))

        entitlement = ProviderModelEntitlement(
            id=uuid.uuid4(),
            user_id=user_id,
            provider_model_id=provider_model_id,
            purchase_price=Decimal(str(purchase_price)),
            currency=currency,
            source_tx_trace_id=source_tx_trace_id,
        )
        self.session.add(entitlement)
        await self.session.flush()
        return entitlement
