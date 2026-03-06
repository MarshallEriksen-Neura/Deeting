import hashlib
import logging
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories import (
    ProviderModelRepository,
    ProviderPresetRepository,
    SystemSettingRepository,
)
from app.repositories.billing_repository import (
    BillingRepository,
    DuplicateTransactionError,
    InsufficientBalanceError,
)
from app.schemas.credits import (
    CreditsAlipayOrderRequest,
    CreditsAlipayOrderResponse,
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
from app.services.credits import CreditsService
from app.services.payments import AlipayService
from app.services.providers.upstream_url import build_upstream_url
from app.services.secrets.manager import SecretManager
from app.services.system import SystemSettingsService

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
    )


def get_billing_repository(db: AsyncSession = Depends(get_db)) -> BillingRepository:
    return BillingRepository(db)


def _build_alipay_trace_id(trade_no: str, out_trade_no: str) -> str:
    digest = hashlib.sha256(f"{trade_no}:{out_trade_no}".encode()).hexdigest()[:40]
    return f"alipay-recharge-{digest}"


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
    从 is_public=True 且 is_enabled 的 ProviderInstance 下查询 ProviderModel。
    """
    stmt = (
        select(ProviderModel)
        .join(ProviderInstance, ProviderModel.instance_id == ProviderInstance.id)
        .where(
            ProviderInstance.is_public.is_(True),
            ProviderInstance.is_enabled.is_(True),
            ProviderModel.is_active.is_(True),
        )
    )
    rows = (await db.execute(stmt)).scalars().all()
    models = [
        CreditsPlatformModel(
            id=str(m.id),
            model_id=m.model_id,
            display_name=m.display_name,
            capabilities=m.capabilities or [],
            pricing=m.pricing_config or None,
        )
        for m in rows
    ]
    return CreditsPlatformModelsResponse(models=models)


@router.post("/chat/completions")
async def credits_chat_completions_proxy(
    request: Request,
    current_user: User = Depends(get_current_user),
    billing_repo: BillingRepository = Depends(get_billing_repository),
    db: AsyncSession = Depends(get_db),
):
    """
    计费代理（瘦代理）：
    鉴权 → 按 model_id 查库找到管理员配置的公共实例和密钥 →
    构建上游 URL → 转发请求 → 按 pricing_config 扣费 → 返回响应。
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

    # --- 4. 构建上游 URL 和认证头 ---
    protocol = instance.protocol or (
        (preset.capability_configs or {}).get("chat", {}).get("protocol")
    ) or preset.provider
    base_url = instance.base_url or preset.base_url
    upstream_url = build_upstream_url(
        base_url,
        provider_model.upstream_path,
        protocol,
        auto_append_v1=instance.auto_append_v1,
    )

    auth_headers = _build_auth_headers(
        preset.auth_type,
        preset.auth_config or {},
        secret,
    )
    headers = {
        "Content-Type": "application/json",
        **auth_headers,
        **(preset.default_headers or {}),
    }

    # --- 5. 构建转发体 ---
    stream = body.get("stream") is True
    forward_body = {
        "model": provider_model.model_id,
        "messages": messages,
        "stream": stream,
        **{k: body[k] for k in ("temperature", "max_tokens", "tools") if k in body},
    }

    tenant_id = str(current_user.id) if current_user else None
    trace_id = (body.get("trace_id") or "").strip() or None
    pricing = provider_model.pricing_config or {}

    # --- 6. 流式转发 ---
    if stream:
        async def _stream_and_bill():
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST", upstream_url, headers=headers, json=forward_body,
                ) as resp:
                    if not resp.is_success:
                        text = (await resp.aread()).decode(errors="replace")[:500]
                        raise HTTPException(status_code=resp.status_code, detail=text)
                    async for chunk in resp.aiter_bytes():
                        yield chunk

        return StreamingResponse(
            _stream_and_bill(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # --- 7. 非流式转发 ---
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(upstream_url, headers=headers, json=forward_body)

    if not resp.is_success:
        try:
            err = resp.json()
            detail = err.get("error") if isinstance(err.get("error"), str) else resp.text[:500]
        except Exception:
            detail = resp.text[:500]
        raise HTTPException(status_code=resp.status_code, detail=detail)

    data = resp.json()

    # --- 8. 按 pricing_config 扣费 ---
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)

    if tenant_id and trace_id and (input_tokens > 0 or output_tokens > 0):
        input_per_1k = Decimal(str(pricing.get("input_per_1k", 0)))
        output_per_1k = Decimal(str(pricing.get("output_per_1k", 0)))
        input_cost = (Decimal(input_tokens) / 1000) * input_per_1k
        output_cost = (Decimal(output_tokens) / 1000) * output_per_1k
        amount = input_cost + output_cost
        if amount > 0:
            try:
                await billing_repo.deduct(
                    tenant_id=tenant_id,
                    amount=amount,
                    trace_id=trace_id,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    input_price=input_per_1k,
                    output_price=output_per_1k,
                    provider=preset.provider,
                    model=model_id,
                    description=f"Credits proxy model={model_id}",
                )
            except DuplicateTransactionError:
                pass
            except InsufficientBalanceError as e:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=str(e),
                ) from e

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
    return CreditsAlipayOrderResponse(
        out_trade_no=order.out_trade_no,
        pay_url=order.pay_url,
        amount=float(order.amount),
        currency=str(policy["currency"]),
        expected_credited_amount=float(expected_credited_amount),
    )


@router.post(
    "/recharge/alipay/notify",
    response_class=PlainTextResponse,
    include_in_schema=False,
)
async def handle_alipay_recharge_notify(
    request: Request,
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

    policy = await system_settings_service.get_recharge_policy()
    trace_id = _build_alipay_trace_id(trade_no=trade_no, out_trade_no=out_trade_no)
    try:
        await svc.recharge_with_trace_id(
            tenant_id=tenant_id,
            amount=paid_amount,
            credit_per_unit=float(policy["credit_per_unit"]),
            currency=str(policy["currency"]),
            trace_id=trace_id,
            description=(
                f"Alipay recharge trade_no={trade_no} amount={paid_amount} "
                f"{policy['currency']} ratio={policy['credit_per_unit']}"
            ),
        )
    except DuplicateTransactionError:
        return PlainTextResponse("success")
    except ValueError:
        return PlainTextResponse("failure", status_code=status.HTTP_400_BAD_REQUEST)

    return PlainTextResponse("success")
