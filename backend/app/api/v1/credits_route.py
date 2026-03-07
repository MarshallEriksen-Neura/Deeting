import hashlib
import logging
import uuid
from decimal import Decimal
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import AlipayRechargeOrder, AlipayRechargeOrderStatus, User
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.protocols.canonical import CanonicalInputItem
from app.protocols.egress import render_chat_completion_response
from app.protocols.ingress import to_canonical_chat_request
from app.protocols.runtime import protocol_runtime_service
from app.protocols.runtime.profile_resolver import (
    build_protocol_profile_from_preset,
    load_protocol_profile_from_preset,
)
from app.protocols.runtime.response_decoders import decode_response
from app.repositories import (
    ProviderModelRepository,
    ProviderPresetRepository,
    SystemSettingRepository,
)
from app.repositories.billing_repository import DuplicateTransactionError
from app.schemas.credits import (
    CreditsAlipayOrderRequest,
    CreditsAlipayOrderResponse,
    CreditsAlipayOrderStatusResponse,
    CreditsBalanceResponse,
    CreditsConsumptionResponse,
    CreditsModelUsageResponse,
    CreditsPlatformModel,
    CreditsPlatformModelsResponse,
    CreditsRechargePolicyResponse,
    CreditsRechargeRequest,
    CreditsRechargeResponse,
    CreditsTransactionListResponse,
)
from app.services.billing_pipeline import (
    QuotaExceededError,
    estimate_cost,
    quota_precheck,
    record_and_adjust,
    wrap_stream_with_billing,
)
from app.services.credits import CreditsService
from app.services.payments import AlipayService
from app.services.secrets.manager import SecretManager
from app.services.system import SystemSettingsService
from app.utils.time_utils import Datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits", tags=["Credits"])

_secret_manager = SecretManager()


def get_credits_service(db: AsyncSession = Depends(get_db)) -> CreditsService:
    return CreditsService(db)


def get_system_settings_service(
    db: AsyncSession = Depends(get_db),
) -> SystemSettingsService:
    return SystemSettingsService(
        SystemSettingRepository(db),
        ProviderModelRepository(db),
    )


def get_alipay_service() -> AlipayService:
    return AlipayService(
        enabled=bool(settings.ALIPAY_ENABLED),
        app_id=str(settings.ALIPAY_APP_ID or ""),
        gateway=str(settings.ALIPAY_GATEWAY or ""),
        app_private_key=str(settings.ALIPAY_PRIVATE_KEY or ""),
        alipay_public_key=str(settings.ALIPAY_PUBLIC_KEY or ""),
        notify_url=str(settings.ALIPAY_NOTIFY_URL or ""),
        return_url=str(settings.ALIPAY_RETURN_URL or ""),
        timeout_express=str(settings.ALIPAY_TIMEOUT_EXPRESS or "15m"),
        seller_id=str(getattr(settings, "ALIPAY_SELLER_ID", "") or ""),
    )


def _build_alipay_trace_id(trade_no: str, out_trade_no: str) -> str:
    digest = hashlib.sha256(f"{trade_no}:{out_trade_no}".encode()).hexdigest()[:40]
    return f"alipay-recharge-{digest}"


def _map_alipay_order_status(trade_status: str | None) -> AlipayRechargeOrderStatus:
    normalized = (trade_status or "").strip().upper()
    if normalized in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
        return AlipayRechargeOrderStatus.SUCCESS
    if normalized in {"TRADE_CLOSED"}:
        return AlipayRechargeOrderStatus.FAILED
    return AlipayRechargeOrderStatus.PENDING


def _serialize_alipay_order_status(
    order: AlipayRechargeOrder,
    *,
    refreshed: bool,
) -> CreditsAlipayOrderStatusResponse:
    credited_amount = (
        float(order.expected_credited_amount)
        if order.status == AlipayRechargeOrderStatus.SUCCESS
        else 0.0
    )
    return CreditsAlipayOrderStatusResponse(
        out_trade_no=order.out_trade_no,
        status=order.status.value,
        trade_status=order.trade_status,
        trade_no=order.trade_no,
        amount=float(order.amount),
        currency=order.currency,
        expected_credited_amount=float(order.expected_credited_amount),
        credited_amount=credited_amount,
        refreshed=refreshed,
    )


async def _get_alipay_order_for_user(
    db: AsyncSession,
    *,
    out_trade_no: str,
    user_id: uuid.UUID,
) -> AlipayRechargeOrder | None:
    result = await db.execute(
        select(AlipayRechargeOrder).where(
            AlipayRechargeOrder.out_trade_no == out_trade_no,
            AlipayRechargeOrder.tenant_id == user_id,
        )
    )
    return result.scalar_one_or_none()


def _validate_alipay_seller_id(seller_id: str | None) -> bool:
    expected = str(getattr(settings, "ALIPAY_SELLER_ID", "") or "").strip()
    if not expected:
        return True
    return (seller_id or "").strip() == expected


async def _apply_alipay_order_update(
    *,
    db: AsyncSession,
    order: AlipayRechargeOrder,
    trade_status: str | None,
    trade_no: str | None,
    total_amount: Decimal | None,
    seller_id: str | None,
    svc: CreditsService,
    system_settings_service: SystemSettingsService,
) -> None:
    if not _validate_alipay_seller_id(seller_id):
        raise ValueError("支付宝卖家身份不匹配")

    if total_amount is not None:
        normalized_amount = Decimal(str(total_amount)).quantize(Decimal("0.01"))
        if normalized_amount != Decimal(str(order.amount)).quantize(Decimal("0.01")):
            raise ValueError("支付宝支付金额与订单金额不一致")

    order.trade_status = (trade_status or order.trade_status or "").strip() or None
    order.trade_no = (trade_no or order.trade_no or "").strip() or None
    order.last_checked_at = Datetime.now()
    order.status = _map_alipay_order_status(order.trade_status)

    if order.status != AlipayRechargeOrderStatus.SUCCESS:
        await db.commit()
        return

    if not order.trade_no:
        raise ValueError("支付宝交易号缺失")

    policy = await system_settings_service.get_recharge_policy()
    order.currency = str(policy["currency"])
    order.credit_per_unit = Decimal(str(policy["credit_per_unit"])).quantize(
        Decimal("0.000001")
    )
    order.expected_credited_amount = (
        Decimal(str(order.amount)) * order.credit_per_unit
    ).quantize(Decimal("0.000001"))

    trace_id = _build_alipay_trace_id(
        trade_no=order.trade_no,
        out_trade_no=order.out_trade_no,
    )
    try:
        await svc.recharge_with_trace_id(
            tenant_id=str(order.tenant_id),
            amount=order.amount,
            credit_per_unit=float(order.credit_per_unit),
            currency=order.currency,
            trace_id=trace_id,
            description=(
                f"Alipay recharge trade_no={order.trade_no} amount={order.amount} "
                f"{order.currency} ratio={order.credit_per_unit}"
            ),
        )
    except DuplicateTransactionError:
        pass

    order.status = AlipayRechargeOrderStatus.SUCCESS
    order.settled_at = Datetime.now()
    await db.commit()


async def _resolve_secret_ref(
    instance: ProviderInstance,
    db: AsyncSession,
) -> str | None:
    """Resolve instance.credentials_ref → actual API key via SecretManager."""
    ref = (instance.credentials_ref or "").strip()
    if not ref:
        return None
    if not ref.startswith("db:"):
        creds = instance.__dict__.get("credentials") or []
        for cred in creds:
            if cred.alias == ref and cred.is_active:
                ref = cred.secret_ref_id
                break
    provider = instance.preset_slug
    return await _secret_manager.get(provider, ref, db)


def _build_auth_headers(
    auth_type: str,
    auth_config: dict,
    secret: str,
) -> dict[str, str]:
    """Build upstream auth headers following the same logic as UpstreamCallStep."""
    if auth_type == "api_key":
        header_name = auth_config.get("header", "x-api-key")
        return {header_name: secret}
    if auth_type == "basic":
        return {"Authorization": f"Basic {secret}"}
    if auth_type == "none":
        return {}
    return {"Authorization": f"Bearer {secret}"}


def _build_runtime_profile_for_public_model(
    *,
    preset,
    instance: ProviderInstance,
    provider_model: ProviderModel,
) -> Any:
    capability = (
        provider_model.capabilities[0] if provider_model.capabilities else "chat"
    ).lower()
    stored_profile = load_protocol_profile_from_preset(preset, capability)
    stored_metadata = stored_profile.metadata if stored_profile else {}
    protocol = (
        instance.protocol
        or (stored_metadata.get("protocol") if isinstance(stored_metadata, dict) else None)
        or preset.provider
    )
    return build_protocol_profile_from_preset(
        preset=preset,
        provider=preset.provider,
        capability=capability,
        protocol=protocol,
        upstream_path=provider_model.upstream_path,
        http_method="",
        template_engine="",
        request_template={},
        response_transform={},
        request_builder={},
        default_headers=preset.default_headers or {},
        default_params=preset.default_params or {},
    )


@router.get("/balance", response_model=CreditsBalanceResponse)
async def get_balance(
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsBalanceResponse:
    return await svc.get_balance(str(current_user.id) if current_user else None)


@router.get("/consumption", response_model=CreditsConsumptionResponse)
async def get_consumption(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsConsumptionResponse:
    return await svc.get_consumption(
        str(current_user.id) if current_user else None, days
    )


@router.get("/model-usage", response_model=CreditsModelUsageResponse)
async def get_model_usage(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsModelUsageResponse:
    return await svc.get_model_usage(
        str(current_user.id) if current_user else None, days
    )


@router.get("/transactions", response_model=CreditsTransactionListResponse)
async def get_transactions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
) -> CreditsTransactionListResponse:
    return await svc.list_transactions(
        str(current_user.id) if current_user else None, limit, offset
    )


@router.get("/models", response_model=CreditsPlatformModelsResponse)
async def get_credits_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CreditsPlatformModelsResponse:
    """
    返回管理员配置的公共平台模型列表，供桌面端同步到本地「平台」实例。
    从 is_public=True 且 is_enabled 的 ProviderInstance 下查询 ProviderModel，
    JOIN ProviderPreset 以获取 provider 品牌元数据（name/slug/icon/color）。
    """
    from app.models.provider_preset import ProviderPreset

    stmt = (
        select(ProviderModel, ProviderPreset)
        .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
        .outerjoin(
            ProviderPreset, ProviderInstance.preset_slug == ProviderPreset.slug
        )
        .where(
            ProviderInstance.is_public.is_(True),
            ProviderInstance.is_enabled.is_(True),
            ProviderModel.is_active.is_(True),
        )
    )
    rows = (await db.execute(stmt)).all()
    models = [
        CreditsPlatformModel(
            id=str(m.id),
            model_id=m.model_id,
            display_name=m.display_name,
            capabilities=m.capabilities or [],
            pricing=m.pricing_config or None,
            provider_name=preset.name if preset else "",
            provider_slug=preset.slug if preset else "",
            provider_icon=preset.icon if preset else None,
            provider_color=preset.theme_color if preset else None,
        )
        for m, preset in rows
    ]
    return CreditsPlatformModelsResponse(models=models)


@router.post("/chat/completions")
async def credits_chat_completions_proxy(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    计费代理（瘦代理）：
    鉴权 → 余额预检 → 按 model_id 查库找到管理员配置的公共实例和密钥 →
    构建上游 URL → 转发请求 → 按 pricing_config 扣费 → 返回响应。

    计费逻辑通过 BillingPipeline 与 Gateway 共享，确保两条路径行为一致。
    """
    body = await request.json()
    model_id = (body.get("model") or "").strip()
    messages = body.get("messages") or []
    if not model_id or not messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="model and messages are required",
        )

    # --- 1. 查找公共实例下匹配的 ProviderModel ---
    stmt = (
        select(ProviderModel)
        .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
        .options(selectinload(ProviderModel.instance).selectinload(ProviderInstance.credentials))
        .where(
            or_(
                ProviderModel.model_id == model_id,
                ProviderModel.unified_model_id == model_id,
            ),
            ProviderModel.is_active.is_(True),
            ProviderInstance.is_public.is_(True),
            ProviderInstance.is_enabled.is_(True),
        )
        .limit(1)
    )
    provider_model: ProviderModel | None = (await db.execute(stmt)).scalars().first()
    if not provider_model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Platform model not found: {model_id}",
        )

    instance: ProviderInstance = provider_model.instance

    # --- 2. 查 Preset 获取 auth_type / protocol ---
    preset_repo = ProviderPresetRepository(db)
    preset = await preset_repo.get_by_slug(instance.preset_slug)
    if not preset or not preset.is_active:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider preset not available: {instance.preset_slug}",
        )

    # --- 3. 解密凭证 ---
    secret = await _resolve_secret_ref(instance, db)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Platform credential not configured for this model",
        )

    # --- 4. 余额预检 (与 Gateway QuotaCheckStep 一致) ---
    tenant_id = str(current_user.id) if current_user else None
    pricing = provider_model.pricing_config or {}
    max_tokens = body.get("max_tokens") or 4096
    estimated = estimate_cost(pricing, max_tokens)

    if tenant_id and pricing:
        try:
            await quota_precheck(tenant_id, estimated, db)
        except QuotaExceededError as exc:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient credits: {exc}",
            ) from exc

    # --- 5. 构建 runtime v2 profile / canonical request / upstream request ---
    profile = _build_runtime_profile_for_public_model(
        preset=preset,
        instance=instance,
        provider_model=provider_model,
    )
    canonical_request = to_canonical_chat_request(body)
    canonical_request.model = provider_model.model_id
    if profile.protocol_family == "openai_responses" and not canonical_request.input_items:
        input_text_parts: list[str] = []
        for message in canonical_request.messages:
            if message.role == "system":
                continue
            if isinstance(message.content, str) and message.content.strip():
                input_text_parts.append(message.content)
        if input_text_parts:
            canonical_request.input_items = [
                CanonicalInputItem(
                    type="text",
                    role="user",
                    text="\n\n".join(input_text_parts),
                )
            ]
    prepared = protocol_runtime_service.build_upstream_request(
        canonical_request,
        profile,
        base_url=instance.base_url or preset.base_url,
    )
    auth_headers = _build_auth_headers(
        preset.auth_type,
        preset.auth_config or {},
        secret,
    )
    headers = {
        "Content-Type": "application/json",
        **prepared.headers,
        **auth_headers,
    }

    # --- 6. 构建转发体 ---
    is_stream = body.get("stream") is True
    forward_body = dict(prepared.body)
    if is_stream:
        if profile.protocol_family == "openai_responses":
            raise HTTPException(
                status_code=400,
                detail="streaming not supported for responses-backed credits models yet",
            )
        forward_body["stream_options"] = {"include_usage": True}

    trace_id = (body.get("trace_id") or "").strip() or f"credits-{uuid.uuid4().hex[:16]}"

    # --- 7. 流式转发 + 扣费 (通过 BillingPipeline) ---
    if is_stream:
        async def _raw_stream():
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    prepared.method,
                    prepared.url,
                    headers=headers,
                    params=prepared.query,
                    json=forward_body,
                ) as resp:
                    if not resp.is_success:
                        text = (await resp.aread()).decode(errors="replace")[:500]
                        raise HTTPException(status_code=resp.status_code, detail=text)
                    async for chunk in resp.aiter_bytes():
                        yield chunk

        billed_stream = wrap_stream_with_billing(
            raw_stream=_raw_stream(),
            db_session=db,
            tenant_id=tenant_id or "",
            trace_id=trace_id,
            pricing_config=pricing,
            estimated_cost=estimated,
            provider=preset.provider,
            model=model_id,
        )

        return StreamingResponse(
            billed_stream,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # --- 8. 非流式转发 ---
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.request(
            prepared.method,
            prepared.url,
            headers=headers,
            params=prepared.query,
            json=forward_body,
        )

    if not resp.is_success:
        try:
            err = resp.json()
            detail = err.get("error") if isinstance(err.get("error"), str) else resp.text[:500]
        except Exception:
            detail = resp.text[:500]
        raise HTTPException(status_code=resp.status_code, detail=detail)

    upstream_data = resp.json()
    canonical_response = decode_response(
        profile.response.decoder.name,
        upstream_data if isinstance(upstream_data, dict) else {},
        fallback_model=model_id,
    )
    data = render_chat_completion_response(canonical_response)

    # --- 9. 按 pricing_config 扣费 (通过 BillingPipeline) ---
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)

    if tenant_id and (input_tokens > 0 or output_tokens > 0):
        try:
            await record_and_adjust(
                db_session=db,
                tenant_id=tenant_id,
                trace_id=trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                pricing_config=pricing,
                estimated_cost=estimated,
                provider=preset.provider,
                model=model_id,
                description=f"Credits proxy model={model_id}",
            )
            await db.commit()
        except DuplicateTransactionError:
            pass
        except Exception as exc:
            logger.error("credits_proxy_billing_failed trace=%s err=%s", trace_id, exc)
            await db.rollback()

    return data


@router.get("/recharge-policy", response_model=CreditsRechargePolicyResponse)
async def get_recharge_policy(
    _current_user: User = Depends(get_current_user),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
) -> CreditsRechargePolicyResponse:
    policy = await system_settings_service.get_recharge_policy()
    return CreditsRechargePolicyResponse(**policy)


@router.post("/recharge", response_model=CreditsRechargeResponse)
async def recharge_credits(
    payload: CreditsRechargeRequest,
    current_user: User = Depends(get_current_user),
    svc: CreditsService = Depends(get_credits_service),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
) -> CreditsRechargeResponse:
    policy = await system_settings_service.get_recharge_policy()
    try:
        return await svc.recharge(
            tenant_id=str(current_user.id) if current_user else None,
            amount=payload.amount,
            credit_per_unit=float(policy["credit_per_unit"]),
            currency=str(policy["currency"]),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/recharge/alipay/order", response_model=CreditsAlipayOrderResponse)
async def create_alipay_recharge_order(
    payload: CreditsAlipayOrderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
    alipay_service: AlipayService = Depends(get_alipay_service),
) -> CreditsAlipayOrderResponse:
    policy = await system_settings_service.get_recharge_policy()
    try:
        order = alipay_service.create_page_order(
            tenant_id=str(current_user.id),
            amount=payload.amount,
            subject=str(settings.ALIPAY_RECHARGE_SUBJECT or "Deeting Credits Recharge"),
            body=(
                f"Credits recharge amount={payload.amount} {policy['currency']}, "
                f"ratio={policy['credit_per_unit']}"
            ),
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        if "金额" in detail:
            status_code = status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc

    expected_credited_amount = (
        Decimal(str(order.amount)) * Decimal(str(policy["credit_per_unit"]))
    ).quantize(Decimal("0.000001"))
    db.add(
        AlipayRechargeOrder(
            tenant_id=current_user.id,
            out_trade_no=order.out_trade_no,
            status=AlipayRechargeOrderStatus.PENDING,
            trade_status="WAIT_BUYER_PAY",
            amount=order.amount,
            currency=str(policy["currency"]),
            credit_per_unit=Decimal(str(policy["credit_per_unit"])).quantize(
                Decimal("0.000001")
            ),
            expected_credited_amount=expected_credited_amount,
            pay_url=order.pay_url,
        )
    )
    await db.commit()
    return CreditsAlipayOrderResponse(
        out_trade_no=order.out_trade_no,
        pay_url=order.pay_url,
        amount=float(order.amount),
        currency=str(policy["currency"]),
        expected_credited_amount=float(expected_credited_amount),
    )


@router.get(
    "/recharge/alipay/status",
    response_model=CreditsAlipayOrderStatusResponse,
)
async def get_alipay_recharge_order_status(
    out_trade_no: str = Query(..., min_length=1),
    refresh: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    svc: CreditsService = Depends(get_credits_service),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
    alipay_service: AlipayService = Depends(get_alipay_service),
) -> CreditsAlipayOrderStatusResponse:
    order = await _get_alipay_order_for_user(
        db,
        out_trade_no=out_trade_no.strip(),
        user_id=current_user.id,
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="订单不存在")

    refreshed = False
    if refresh and order.status != AlipayRechargeOrderStatus.SUCCESS:
        refreshed = True
        try:
            query_result = await alipay_service.query_trade(out_trade_no=order.out_trade_no)
        except (httpx.HTTPError, ValueError) as exc:
            order.error_code = "query_failed"
            order.error_detail = str(exc)
            order.last_checked_at = Datetime.now()
            await db.commit()
            await db.refresh(order)
        else:
            if query_result.code == "10000":
                await _apply_alipay_order_update(
                    db=db,
                    order=order,
                    trade_status=query_result.trade_status,
                    trade_no=query_result.trade_no,
                    total_amount=query_result.total_amount,
                    seller_id=query_result.seller_id,
                    svc=svc,
                    system_settings_service=system_settings_service,
                )
            else:
                order.error_code = query_result.sub_code or query_result.code or None
                order.error_detail = query_result.msg
                order.last_checked_at = Datetime.now()
                await db.commit()
                await db.refresh(order)

    if order.status == AlipayRechargeOrderStatus.SUCCESS:
        await db.refresh(order)
    return _serialize_alipay_order_status(order, refreshed=refreshed)


@router.post(
    "/recharge/alipay/notify",
    response_class=PlainTextResponse,
    include_in_schema=False,
)
async def handle_alipay_recharge_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
    svc: CreditsService = Depends(get_credits_service),
    system_settings_service: SystemSettingsService = Depends(get_system_settings_service),
    alipay_service: AlipayService = Depends(get_alipay_service),
) -> PlainTextResponse:
    form = await request.form()
    payload = {str(key): str(value) for key, value in form.items()}

    if not alipay_service.verify_notify_signature(payload):
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    app_id = str(payload.get("app_id") or "").strip()
    if app_id and app_id != str(settings.ALIPAY_APP_ID):
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    trade_status = str(payload.get("trade_status") or "").strip()
    if trade_status not in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
        return PlainTextResponse("success")

    out_trade_no = str(payload.get("out_trade_no") or "").strip()
    trade_no = str(payload.get("trade_no") or "").strip()
    total_amount_raw = str(payload.get("total_amount") or "").strip()
    if not out_trade_no or not trade_no or not total_amount_raw:
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    try:
        tenant_id, expected_amount = alipay_service.parse_out_trade_no(out_trade_no)
        paid_amount = Decimal(total_amount_raw).quantize(Decimal("0.01"))
    except Exception:
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    if paid_amount != expected_amount:
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)
    try:
        order = await _get_alipay_order_for_user(
            db,
            out_trade_no=out_trade_no,
            user_id=uuid.UUID(tenant_id),
        )
        if not order:
            expected_credited_amount = Decimal("0")
            order = AlipayRechargeOrder(
                tenant_id=uuid.UUID(tenant_id),
                out_trade_no=out_trade_no,
                status=AlipayRechargeOrderStatus.PENDING,
                amount=paid_amount,
                currency="CNY",
                credit_per_unit=Decimal("0"),
                expected_credited_amount=expected_credited_amount,
            )
            db.add(order)
            await db.flush()

        await _apply_alipay_order_update(
            db=db,
            order=order,
            trade_status=trade_status,
            trade_no=trade_no,
            total_amount=paid_amount,
            seller_id=str(payload.get("seller_id") or "").strip() or None,
            svc=svc,
            system_settings_service=system_settings_service,
        )
    except DuplicateTransactionError:
        return PlainTextResponse("success")
    except ValueError:
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    return PlainTextResponse("success")
