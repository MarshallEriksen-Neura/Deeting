import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.cache import cache
from app.models.provider_instance import ProviderModel
from app.schemas.provider_instance import (
    ProviderInstanceCreate,
    ProviderInstanceResponse,
    ProviderModelResponse,
    ProviderModelsUpsertRequest,
    ProviderVerifyRequest,
    ProviderVerifyResponse,
)
from app.deps.superuser import get_current_superuser
from app.services.providers.provider_instance_service import ProviderInstanceService
from app.services.providers.health_monitor import HealthMonitorService

router = APIRouter(prefix="/admin/provider-instances", tags=["ProviderInstances"])


@router.post("/verify", response_model=ProviderVerifyResponse)
async def verify_provider(
    payload: ProviderVerifyRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """验证 Provider 凭证并尝试发现模型。"""
    svc = ProviderInstanceService(db)
    result = await svc.verify_credentials(
        preset_slug=payload.preset_slug,
        base_url=payload.base_url,
        api_key=payload.api_key,
        model=payload.model,
        protocol=payload.protocol,
        auto_append_v1=payload.auto_append_v1,
        resource_name=payload.resource_name,
        deployment_name=payload.deployment_name,
        project_id=payload.project_id,
        region=payload.region,
    )
    return result


@router.post("", response_model=ProviderInstanceResponse, status_code=status.HTTP_201_CREATED)
async def create_instance(
    payload: ProviderInstanceCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    svc = ProviderInstanceService(db)
    try:
        instance = await svc.create_instance(
            user_id=getattr(user, "id", None),
            preset_slug=payload.preset_slug,
            name=payload.name,
            description=payload.description,
            base_url=payload.base_url,
            icon=payload.icon,
            credentials_ref=payload.credentials_ref,
            api_key=payload.api_key,
            protocol=payload.protocol,
            model_prefix=payload.model_prefix,
            auto_append_v1=payload.auto_append_v1,
            priority=payload.priority,
            is_enabled=payload.is_enabled,
        )
    except ValueError as e:
        message = str(e)
        if message == "preset_not_found":
            raise HTTPException(status_code=404, detail="preset not found")
        if message == "secret_key_not_configured":
            raise HTTPException(status_code=400, detail="SECRET_KEY not configured")
        if message == "plaintext_secret_ref_forbidden":
            raise HTTPException(status_code=400, detail="credentials_ref must be a reference, not a raw key")
        raise HTTPException(status_code=400, detail=message)
    return instance


@router.get("", response_model=List[ProviderInstanceResponse])
async def list_instances(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    svc = ProviderInstanceService(db)
    instances = await svc.list_instances(user_id=getattr(user, "id", None), include_public=True)

    # Inject Health Data
    health_svc = HealthMonitorService(cache.redis)
    response_list = []
    
    for inst in instances:
        dto = ProviderInstanceResponse.model_validate(inst)
        try:
            health = await health_svc.get_health_status(str(inst.id))
            dto.health_status = health.get("status", "unknown")
            dto.latency_ms = health.get("latency", 0)
            dto.sparkline = await health_svc.get_sparkline(str(inst.id))
        except Exception:
            # Redis unavailable or init error
            pass
        response_list.append(dto)
        
    return response_list


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
