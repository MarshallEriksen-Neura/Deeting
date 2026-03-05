import hashlib
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories import ProviderModelRepository, SystemSettingRepository
from app.repositories.billing_repository import DuplicateTransactionError
from app.schemas.credits import (
    CreditsAlipayOrderRequest,
    CreditsAlipayOrderResponse,
    CreditsBalanceResponse,
    CreditsConsumptionResponse,
    CreditsModelUsageResponse,
    CreditsRechargePolicyResponse,
    CreditsRechargeRequest,
    CreditsRechargeResponse,
    CreditsTransactionListResponse,
)
from app.services.credits import CreditsService
from app.services.payments import AlipayService
from app.services.system import SystemSettingsService

router = APIRouter(prefix="/credits", tags=["Credits"])


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


def _build_alipay_trace_id(trade_no: str, out_trade_no: str) -> str:
    digest = hashlib.sha256(f"{trade_no}:{out_trade_no}".encode()).hexdigest()[:40]
    return f"alipay-recharge-{digest}"


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
