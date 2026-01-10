import uuid
from datetime import datetime
from typing import Iterable, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.provider_instance import ProviderInstance, ProviderModel, ProviderCredential
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_credential_repository import ProviderCredentialRepository
from app.core.cache_invalidation import CacheInvalidator


class ProviderInstanceService:
    """封装 ProviderInstance / ProviderModel 业务，避免 API 直接操作 ORM。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.instance_repo = ProviderInstanceRepository(session)
        self.model_repo = ProviderModelRepository(session)
        self.credential_repo = ProviderCredentialRepository(session)
        self._invalidator = CacheInvalidator()

    async def create_instance(
        self,
        user_id: uuid.UUID | None,
        preset_slug: str,
        name: str,
        base_url: str,
        icon: str | None,
        credentials_ref: str,
        channel: str = "external",
        priority: int = 0,
        is_enabled: bool = True,
    ) -> ProviderInstance:
        instance = ProviderInstance(
            id=uuid.uuid4(),
            user_id=user_id,
            preset_slug=preset_slug,
            name=name,
            base_url=base_url,
            icon=icon,
            credentials_ref=credentials_ref,
            channel=channel,
            priority=priority,
            is_enabled=is_enabled,
        )
        self.session.add(instance)
        await self.session.commit()
        await self.session.refresh(instance)
        await self._invalidator.on_provider_instance_changed(str(user_id) if user_id else None)
        return instance

    async def list_instances(
        self,
        user_id: uuid.UUID | None,
        include_public: bool = True,
    ) -> List[ProviderInstance]:
        return await self.instance_repo.get_available_instances(
            user_id=str(user_id) if user_id else None,
            include_public=include_public,
        )

    async def assert_instance_access(self, instance_id: uuid.UUID, user_id: uuid.UUID | None) -> ProviderInstance:
        instance = await self.session.get(ProviderInstance, instance_id)
        if not instance:
            raise ValueError("instance_not_found")
        if instance.user_id and instance.user_id != user_id:
            raise PermissionError("forbidden")
        return instance

    async def upsert_models(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        models: Iterable[ProviderModel],
    ) -> List[ProviderModel]:
        instance = await self.assert_instance_access(instance_id, user_id)
        now = datetime.utcnow()
        results: list[ProviderModel] = []

        for payload in models:
            existing = await self.session.execute(
                ProviderModel.__table__.select().where(
                    ProviderModel.instance_id == instance_id,
                    ProviderModel.capability == payload.capability,
                    ProviderModel.model_id == payload.model_id,
                    ProviderModel.upstream_path == payload.upstream_path,
                )
            )
            row = existing.mappings().first()
            if row:
                model_obj = await self.session.get(ProviderModel, row["id"])
                model_obj.display_name = payload.display_name
                model_obj.unified_model_id = payload.unified_model_id
                model_obj.template_engine = payload.template_engine
                model_obj.request_template = payload.request_template
                model_obj.response_transform = payload.response_transform
                model_obj.pricing_config = payload.pricing_config
                model_obj.limit_config = payload.limit_config
                model_obj.tokenizer_config = payload.tokenizer_config
                model_obj.routing_config = payload.routing_config
                model_obj.source = payload.source
                model_obj.extra_meta = payload.extra_meta
                model_obj.weight = payload.weight
                model_obj.priority = payload.priority
                model_obj.is_active = payload.is_active
                model_obj.synced_at = now
                results.append(model_obj)
            else:
                model_obj = ProviderModel(
                    id=uuid.uuid4(),
                    instance_id=instance_id,
                    capability=payload.capability,
                    model_id=payload.model_id,
                    unified_model_id=payload.unified_model_id,
                    display_name=payload.display_name,
                    upstream_path=payload.upstream_path,
                    template_engine=payload.template_engine,
                    request_template=payload.request_template,
                    response_transform=payload.response_transform,
                    pricing_config=payload.pricing_config,
                    limit_config=payload.limit_config,
                    tokenizer_config=payload.tokenizer_config,
                    routing_config=payload.routing_config,
                    source=payload.source,
                    extra_meta=payload.extra_meta,
                    weight=payload.weight,
                    priority=payload.priority,
                    is_active=payload.is_active,
                    synced_at=now,
                )
                self.session.add(model_obj)
                results.append(model_obj)

        await self.session.commit()
        for r in results:
            await self.session.refresh(r)
        await self._invalidator.on_provider_model_changed(str(instance_id))
        return results

    async def list_models(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> List[ProviderModel]:
        await self.assert_instance_access(instance_id, user_id)
        models = await self.model_repo.list()
        return [m for m in models if m.instance_id == instance_id]

    async def list_credentials(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> List[ProviderCredential]:
        await self.assert_instance_access(instance_id, user_id)
        grouped = await self.credential_repo.get_by_instance_ids([str(instance_id)])
        return grouped.get(str(instance_id), [])

    async def create_credential(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        alias: str,
        secret_ref_id: str,
        weight: int = 0,
        priority: int = 0,
        is_active: bool = True,
    ) -> ProviderCredential:
        await self.assert_instance_access(instance_id, user_id)
        # 唯一性校验
        exists = await self.session.execute(
            select(ProviderCredential).where(
                and_(ProviderCredential.instance_id == instance_id, ProviderCredential.alias == alias)
            )
        )
        if exists.scalars().first():
            raise ValueError("alias_exists")

        cred = ProviderCredential(
            id=uuid.uuid4(),
            instance_id=instance_id,
            alias=alias,
            secret_ref_id=secret_ref_id,
            weight=weight,
            priority=priority,
            is_active=is_active,
        )
        self.session.add(cred)
        await self.session.commit()
        await self.session.refresh(cred)
        await self._invalidator.on_provider_credentials_changed(str(instance_id))
        return cred

    async def delete_credential(
        self,
        instance_id: uuid.UUID,
        credential_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        await self.assert_instance_access(instance_id, user_id)
        cred = await self.session.get(ProviderCredential, credential_id)
        if not cred or cred.instance_id != instance_id:
            raise ValueError("credential_not_found")
        await self.session.delete(cred)
        await self.session.commit()
        await self._invalidator.on_provider_credentials_changed(str(instance_id))
