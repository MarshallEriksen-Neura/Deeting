from typing import List, Optional
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.schemas.provider_hub import ProviderHubResponse, ProviderCard
from app.schemas.provider_instance import (
    ProviderInstanceCreate,
    ProviderInstanceUpdate,
    ProviderInstanceResponse,
    ProviderModelResponse,
    ProviderModelsUpsertRequest,
    ProviderModelsQuickAddRequest,
    ProviderModelUpdate,
    ProviderModelTestRequest,
    ProviderModelTestResponse,
    ProviderVerifyRequest,
    ProviderVerifyResponse,
)
from app.services.providers.provider_hub_service import ProviderHubService
from app.services.providers.provider_instance_service import ProviderInstanceService
from app.models.provider_instance import ProviderModel

router = APIRouter(prefix="/providers", tags=["Providers"])


@router.get("/hub", response_model=ProviderHubResponse)
async def list_provider_hub(
    category: Optional[str] = Query(None, description="cloud/local/custom/all"),
    q: Optional[str] = Query(None, description="搜索关键字"),
    include_public: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderHubService(db)
    return await svc.hub(
        user_id=str(getattr(user, "id", None)) if user else None,
        category=category,
        q=q,
        include_public=include_public,
    )


@router.get("/presets/{slug}", response_model=ProviderCard)
async def get_provider_detail(
    slug: str,
    include_public: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderHubService(db)
    detail = await svc.detail(
        slug=slug,
        user_id=str(getattr(user, "id", None)) if user else None,
        include_public=include_public,
    )
    if not detail:
        raise HTTPException(status_code=404, detail="provider not found")
    return detail


@router.post("/verify", response_model=ProviderVerifyResponse)
async def verify_provider(
    payload: ProviderVerifyRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderInstanceService(db)
    result = await svc.verify_credentials(
        preset_slug=payload.preset_slug,
        base_url=payload.base_url,
        api_key=payload.api_key,
        model=payload.model,
        protocol=payload.protocol,
        resource_name=payload.resource_name,
        deployment_name=payload.deployment_name,
        project_id=payload.project_id,
        region=payload.region,
        api_version=payload.api_version,
    )
    return result


@router.post("", response_model=ProviderInstanceResponse, status_code=status.HTTP_201_CREATED)
async def create_instance(
    payload: ProviderInstanceCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderInstanceService(db)
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
        priority=payload.priority,
        is_enabled=payload.is_enabled,
        resource_name=payload.resource_name,
        deployment_name=payload.deployment_name,
        api_version=payload.api_version,
        project_id=payload.project_id,
        region=payload.region,
    )
    return instance


@router.get("/instances", response_model=List[ProviderInstanceResponse])
async def list_instances(
    include_public: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderInstanceService(db)
    instances = await svc.list_instances(user_id=getattr(user, "id", None), include_public=include_public)
    return instances


@router.patch("/instances/{instance_id}", response_model=ProviderInstanceResponse)
async def update_instance(
    instance_id: str,
    payload: ProviderInstanceUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        updated = await svc.update_instance(instance_uuid, getattr(user, "id", None), **payload.model_dump(exclude_none=True))
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return updated


@router.delete("/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instance(
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        await svc.delete_instance(instance_uuid, getattr(user, "id", None))
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return None


@router.get("/instances/{instance_id}/models", response_model=List[ProviderModelResponse])
async def list_models(
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
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


@router.patch("/models/{model_id}", response_model=ProviderModelResponse)
async def update_model(
    model_id: str,
    payload: ProviderModelUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        model_uuid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid model_id")

    svc = ProviderInstanceService(db)
    try:
        updated = await svc.update_model(model_uuid, getattr(user, "id", None), **payload.model_dump(exclude_none=True))
    except ValueError as e:
        if str(e) == "model_not_found":
            raise HTTPException(status_code=404, detail="model not found")
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return updated


@router.post("/models/{model_id}/test", response_model=ProviderModelTestResponse)
async def test_model(
    model_id: str,
    payload: ProviderModelTestRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        model_uuid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid model_id")

    svc = ProviderInstanceService(db)
    prompt = (payload.prompt if payload else "ping")
    try:
        result = await svc.test_model(model_uuid, getattr(user, "id", None), prompt=prompt)
    except ValueError as e:
        message = str(e)
        if message == "model_not_found":
            raise HTTPException(status_code=404, detail="model not found")
        if message == "secret_not_found":
            raise HTTPException(status_code=400, detail="secret not configured")
        raise HTTPException(status_code=400, detail=message)
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return ProviderModelTestResponse(**result)


@router.post("/instances/{instance_id}/models:sync", response_model=List[ProviderModelResponse])
async def sync_models(
    instance_id: str,
    payload: ProviderModelsUpsertRequest | None = Body(default=None),
    preserve_user_overrides: bool = Query(True, description="保留用户自定义字段"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
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
        else:
            results = await svc.sync_models_from_upstream(
                instance_uuid, getattr(user, "id", None), preserve_user_overrides=preserve_user_overrides
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


@router.post("/instances/{instance_id}/models:quick-add", response_model=List[ProviderModelResponse])
async def quick_add_models(
    instance_id: str,
    payload: ProviderModelsQuickAddRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        results = await svc.quick_add_models(
            instance_uuid,
            getattr(user, "id", None),
            model_ids=payload.models,
            capability=payload.capability,
        )
    except ValueError as e:
        message = str(e)
        if message == "empty_models":
            raise HTTPException(status_code=400, detail="models_required")
        raise HTTPException(status_code=400, detail=message)
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return results
