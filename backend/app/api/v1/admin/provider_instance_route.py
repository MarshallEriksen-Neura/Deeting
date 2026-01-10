import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.provider_instance import ProviderModel
from app.schemas.provider_instance import (
    ProviderInstanceCreate,
    ProviderInstanceResponse,
    ProviderModelResponse,
    ProviderModelsUpsertRequest,
)
from app.deps.superuser import get_current_superuser
from app.services.provider_instance_service import ProviderInstanceService

router = APIRouter(prefix="/admin/provider-instances", tags=["ProviderInstances"])


@router.post("", response_model=ProviderInstanceResponse, status_code=status.HTTP_201_CREATED)
async def create_instance(
    payload: ProviderInstanceCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    svc = ProviderInstanceService(db)
    instance = await svc.create_instance(
        user_id=getattr(user, "id", None),
        preset_slug=payload.preset_slug,
        name=payload.name,
        base_url=payload.base_url,
        icon=payload.icon,
        credentials_ref=payload.credentials_ref,
        channel=payload.channel,
        priority=payload.priority,
        is_enabled=payload.is_enabled,
    )
    return instance


@router.get("", response_model=List[ProviderInstanceResponse])
async def list_instances(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    svc = ProviderInstanceService(db)
    return await svc.list_instances(user_id=getattr(user, "id", None), include_public=True)


@router.post("/{instance_id}/models:sync", response_model=List[ProviderModelResponse])
async def sync_models(
    instance_id: str,
    payload: ProviderModelsUpsertRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """
    手动同步/上报模型列表（最小可用实现）：
    - 按 instance_id 和 capability/model_id/upstream_path 幂等 upsert
    - 未做自动探测，前端/Agent 可先探测再调用本接口写入
    """
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    results: list[ProviderModel] = []
    # 构造 ProviderModel 临时对象列表（不入库）
    model_objs = [
        ProviderModel(
            id=uuid.uuid4(),
            instance_id=instance_uuid,
            capability=m.capability,
            model_id=m.model_id,
            unified_model_id=m.unified_model_id,
            display_name=m.display_name,
            upstream_path=m.upstream_path,
            template_engine=m.template_engine,
            request_template=m.request_template,
            response_transform=m.response_transform,
            pricing_config=m.pricing_config,
            limit_config=m.limit_config,
            tokenizer_config=m.tokenizer_config,
            routing_config=m.routing_config,
            source=m.source,
            extra_meta=m.extra_meta,
            weight=m.weight,
            priority=m.priority,
            is_active=m.is_active,
        )
        for m in payload.models
    ]
    results = await svc.upsert_models(instance_uuid, getattr(user, "id", None), model_objs)
    return results


@router.get("/{instance_id}/models", response_model=List[ProviderModelResponse])
async def list_models(
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        models = await svc.list_models(instance_uuid, getattr(user, "id", None))
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return models
