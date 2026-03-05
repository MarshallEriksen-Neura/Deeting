import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.models.provider_instance import ProviderModel
from app.schemas.provider_instance import (
    AdminProviderInstanceCreate,
    AdminProviderInstancePublishUpdate,
    ProviderInstanceResponse,
    ProviderModelResponse,
    ProviderModelsUpsertRequest,
    ProviderModelUpdate,
    ProviderVerifyRequest,
    ProviderVerifyResponse,
)
from app.services.providers.health_monitor import HealthMonitorService
from app.services.providers.provider_instance_service import ProviderInstanceService

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


@router.post(
    "", response_model=ProviderInstanceResponse, status_code=status.HTTP_201_CREATED
)
async def create_instance(
    payload: AdminProviderInstanceCreate,
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
            is_public=payload.is_public,
        )
    except ValueError as e:
        message = str(e)
        if message == "preset_not_found":
            raise HTTPException(status_code=404, detail="preset not found")
        if message == "secret_key_not_configured":
            raise HTTPException(status_code=400, detail="SECRET_KEY not configured")
        if message == "plaintext_secret_ref_forbidden":
            raise HTTPException(
                status_code=400,
                detail="credentials_ref must be a reference, not a raw key",
            )
        raise HTTPException(status_code=400, detail=message)
    return instance


@router.get("", response_model=list[ProviderInstanceResponse])
async def list_instances(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    svc = ProviderInstanceService(db)
    instances = await svc.list_instances(
        user_id=getattr(user, "id", None), include_public=True
    )

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


@router.patch("/{instance_id}", response_model=ProviderInstanceResponse)
async def update_instance_visibility(
    instance_id: str,
    payload: AdminProviderInstancePublishUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        updated = await svc.update_instance(
            instance_uuid,
            None,  # superuser bypass: 管理员可维护任意实例
            is_public=payload.is_public,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return updated


@router.post("/{instance_id}/models:sync", response_model=list[ProviderModelResponse])
async def sync_models(
    instance_id: str,
    payload: ProviderModelsUpsertRequest | None = Body(default=None),
    preserve_user_overrides: bool = Query(True, description="保留用户自定义字段"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        if payload and payload.models:
            model_objs = [
                ProviderModel(
                    id=uuid.uuid4(),
                    instance_id=instance_uuid,
                    capabilities=m.capabilities,
                    model_id=m.model_id,
                    unified_model_id=m.unified_model_id,
                    display_name=m.display_name,
                    upstream_path=m.upstream_path,
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
            results = await svc.upsert_models(
                instance_uuid, None, model_objs
            )
        else:
            results = await svc.sync_models_from_upstream(
                instance_uuid,
                None,
                preserve_user_overrides=preserve_user_overrides,
            )
    except ValueError as e:
        message = str(e)
        if message == "instance_not_found":
            raise HTTPException(status_code=404, detail="instance not found")
        if message == "preset_not_found":
            raise HTTPException(status_code=404, detail="preset not found")
        raise HTTPException(status_code=400, detail=message)
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return results


@router.get("/{instance_id}/models", response_model=list[ProviderModelResponse])
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
        models = await svc.list_models(instance_uuid, None)
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return models


@router.patch("/models/{model_id}", response_model=ProviderModelResponse)
async def update_model(
    model_id: str,
    payload: ProviderModelUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        model_uuid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid model_id")

    svc = ProviderInstanceService(db)
    try:
        updated = await svc.update_model(
            model_uuid,
            None,
            **payload.model_dump(exclude_none=True)
        )
    except ValueError as e:
        message = str(e)
        if message == "model_not_found":
            raise HTTPException(status_code=404, detail="model not found")
        raise HTTPException(status_code=400, detail=message)
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return updated
