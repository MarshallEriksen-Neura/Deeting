import hashlib
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models.provider_instance import ProviderModel
from app.repositories import (
    BillingRepository,
    ProviderModelEntitlementRepository,
    ProviderModelRepository,
)
from app.repositories.billing_repository import (
    DuplicateTransactionError,
    InsufficientBalanceError,
)
from app.schemas.provider_hub import ProviderCard, ProviderHubResponse
from app.schemas.provider_instance import (
    ProviderInstanceCreate,
    ProviderInstanceResponse,
    ProviderInstanceUpdate,
    ProviderModelPurchaseStatusResponse,
    ProviderModelResponse,
    ProviderModelsQuickAddRequest,
    ProviderModelsUpsertRequest,
    ProviderModelTestRequest,
    ProviderModelTestResponse,
    ProviderModelUpdate,
    ProviderVerifyRequest,
    ProviderVerifyResponse,
)
from app.services.providers.provider_hub_service import ProviderHubService
from app.services.providers.health_monitor import HealthMonitorService
from app.services.providers.provider_instance_service import ProviderInstanceService
from app.utils.provider_model_access import (
    parse_unlock_price_credits,
    requires_model_purchase,
)

router = APIRouter(prefix="/providers", tags=["Providers"])


def _build_model_purchase_trace_id(user_id: uuid.UUID, model_id: uuid.UUID) -> str:
    payload = f"{user_id}:{model_id}".encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:40]
    return f"model-purchase-{digest}"


async def _resolve_purchase_status(
    *,
    db: AsyncSession,
    model_uuid: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[ProviderModel, ProviderModelPurchaseStatusResponse]:
    model_repo = ProviderModelRepository(db)
    entitlement_repo = ProviderModelEntitlementRepository(db)
    instance_svc = ProviderInstanceService(db)

    model = await model_repo.get(model_uuid)
    if not model:
        raise ValueError("model_not_found")

    instance = await instance_svc.assert_instance_read_access(model.instance_id, user_id)
    unlock_price = parse_unlock_price_credits(model.pricing_config or {})
    purchase_required = requires_model_purchase(
        instance_owner_id=instance.user_id,
        user_id=user_id,
        unlock_price_credits=unlock_price,
    )
    is_purchased = True
    if purchase_required:
        is_purchased = await entitlement_repo.has_entitlement(
            user_id=user_id,
            provider_model_id=model.id,
        )

    return model, ProviderModelPurchaseStatusResponse(
        model_id=model.id,
        unlock_price_credits=(float(unlock_price) if unlock_price is not None else None),
        currency="credits",
        is_purchased=is_purchased,
        is_locked=(purchase_required and not is_purchased),
    )


@router.get("/hub", response_model=ProviderHubResponse)
async def list_provider_hub(
    category: str | None = Query(None, description="cloud/local/custom/all"),
    q: str | None = Query(None, description="搜索关键字"),
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
        auto_append_v1=payload.auto_append_v1,
        resource_name=payload.resource_name,
        deployment_name=payload.deployment_name,
        project_id=payload.project_id,
        region=payload.region,
        api_version=payload.api_version,
    )
    return result


@router.post(
    "", response_model=ProviderInstanceResponse, status_code=status.HTTP_201_CREATED
)
async def create_instance(
    payload: ProviderInstanceCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
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
            resource_name=payload.resource_name,
            deployment_name=payload.deployment_name,
            api_version=payload.api_version,
            project_id=payload.project_id,
            region=payload.region,
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


@router.get("/instances", response_model=list[ProviderInstanceResponse])
async def list_instances(
    include_public: bool = True,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    svc = ProviderInstanceService(db)
    instances = await svc.list_instances(
        user_id=getattr(user, "id", None), include_public=include_public
    )

    health_svc = HealthMonitorService(cache.redis)
    response_list: list[ProviderInstanceResponse] = []

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
        updated = await svc.update_instance(
            instance_uuid,
            getattr(user, "id", None),
            **payload.model_dump(exclude_none=True)
        )
    except ValueError as e:
        if str(e) == "secret_key_not_configured":
            raise HTTPException(status_code=400, detail="SECRET_KEY not configured")
        if str(e) == "plaintext_secret_ref_forbidden":
            raise HTTPException(
                status_code=400,
                detail="credentials_ref must be a reference, not a raw key",
            )
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


@router.get(
    "/instances/{instance_id}/models", response_model=list[ProviderModelResponse]
)
async def list_models(
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    user_id = getattr(user, "id", None)
    if not isinstance(user_id, uuid.UUID):
        raise HTTPException(status_code=401, detail="unauthorized")

    svc = ProviderInstanceService(db)
    try:
        models = await svc.list_models(instance_uuid, user_id)
        instance = await svc.assert_instance_read_access(instance_uuid, user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")

    entitlement_repo = ProviderModelEntitlementRepository(db)
    lockable_model_ids: list[str] = []
    unlock_price_by_model_id: dict[str, float] = {}

    for model in models:
        unlock_price = parse_unlock_price_credits(model.pricing_config or {})
        if requires_model_purchase(
            instance_owner_id=instance.user_id,
            user_id=user_id,
            unlock_price_credits=unlock_price,
        ):
            lockable_model_ids.append(str(model.id))
            if unlock_price is not None:
                unlock_price_by_model_id[str(model.id)] = float(unlock_price)

    purchased_model_ids = await entitlement_repo.list_purchased_model_ids(
        user_id=user_id,
        provider_model_ids=lockable_model_ids,
    )

    response_models: list[ProviderModelResponse] = []
    for model in models:
        model_id = str(model.id)
        is_lockable = model_id in lockable_model_ids
        is_purchased = (not is_lockable) or model_id in purchased_model_ids
        dto = ProviderModelResponse.model_validate(model)
        dto.unlock_price_credits = unlock_price_by_model_id.get(model_id)
        dto.currency = "credits"
        dto.is_purchased = is_purchased
        dto.is_locked = is_lockable and not is_purchased
        response_models.append(dto)
    return response_models


@router.get(
    "/models/{model_id}/purchase-status",
    response_model=ProviderModelPurchaseStatusResponse,
)
async def get_model_purchase_status(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        model_uuid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid model_id")

    user_id = getattr(user, "id", None)
    if not isinstance(user_id, uuid.UUID):
        raise HTTPException(status_code=401, detail="unauthorized")

    try:
        _model, status_payload = await _resolve_purchase_status(
            db=db,
            model_uuid=model_uuid,
            user_id=user_id,
        )
        return status_payload
    except ValueError as exc:
        if str(exc) == "model_not_found":
            raise HTTPException(status_code=404, detail="model not found")
        raise HTTPException(status_code=400, detail=str(exc))
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")


@router.post(
    "/models/{model_id}/purchase",
    response_model=ProviderModelPurchaseStatusResponse,
)
async def purchase_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        model_uuid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid model_id")

    user_id = getattr(user, "id", None)
    if not isinstance(user_id, uuid.UUID):
        raise HTTPException(status_code=401, detail="unauthorized")

    try:
        model, status_payload = await _resolve_purchase_status(
            db=db,
            model_uuid=model_uuid,
            user_id=user_id,
        )
        if not status_payload.is_locked:
            return status_payload

        unlock_price = parse_unlock_price_credits(model.pricing_config or {})
        if unlock_price is None or unlock_price <= 0:
            return status_payload

        trace_id = _build_model_purchase_trace_id(user_id=user_id, model_id=model.id)
        billing_repo = BillingRepository(db)
        entitlement_repo = ProviderModelEntitlementRepository(db)

        try:
            await billing_repo.deduct(
                tenant_id=user_id,
                amount=unlock_price,
                trace_id=trace_id,
                provider="model_market",
                model=model.model_id,
                preset_item_id=model.id,
                description=f"Model unlock purchase model_id={model.model_id}",
                allow_negative=False,
            )
        except DuplicateTransactionError:
            pass

        await entitlement_repo.create_if_absent(
            user_id=user_id,
            provider_model_id=model.id,
            purchase_price=unlock_price,
            currency="credits",
            source_tx_trace_id=trace_id,
        )
        await db.commit()

        _model, refreshed = await _resolve_purchase_status(
            db=db,
            model_uuid=model_uuid,
            user_id=user_id,
        )
        return refreshed
    except InsufficientBalanceError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=402,
            detail={
                "code": "INSUFFICIENT_BALANCE",
                "required": float(exc.required),
                "available": float(exc.available),
            },
        )
    except ValueError as exc:
        await db.rollback()
        if str(exc) == "model_not_found":
            raise HTTPException(status_code=404, detail="model not found")
        raise HTTPException(status_code=400, detail=str(exc))
    except PermissionError:
        await db.rollback()
        raise HTTPException(status_code=403, detail="forbidden")


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
        updated = await svc.update_model(
            model_uuid,
            getattr(user, "id", None),
            **payload.model_dump(exclude_none=True)
        )
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
    prompt = payload.prompt if payload else "ping"
    try:
        result = await svc.test_model(
            model_uuid, getattr(user, "id", None), prompt=prompt
        )
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


@router.post(
    "/instances/{instance_id}/models:sync", response_model=list[ProviderModelResponse]
)
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
                instance_uuid, getattr(user, "id", None), model_objs
            )
        else:
            results = await svc.sync_models_from_upstream(
                instance_uuid,
                getattr(user, "id", None),
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


@router.post(
    "/instances/{instance_id}/models:quick-add",
    response_model=list[ProviderModelResponse],
)
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
