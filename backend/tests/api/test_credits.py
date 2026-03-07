import base64
import json
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.models.billing import (
    AlipayRechargeOrder,
    BillingTransaction,
    TenantQuota,
    TransactionStatus,
    TransactionType,
)
from app.models.system_setting import SystemSetting
from app.utils.time_utils import Datetime


def _generate_rsa_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


def _sign_alipay_notify_payload(payload: dict[str, str], private_key_pem: str) -> str:
    sign_content = "&".join(
        f"{key}={payload[key]}"
        for key in sorted(payload)
        if key not in {"sign", "sign_type"}
        and payload[key] is not None
        and payload[key] != ""
    )
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    signature = private_key.sign(
        sign_content.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


async def _get_test_user_id(session_factory: async_sessionmaker[AsyncSession]) -> UUID:
    async with session_factory() as session:
        result = await session.execute(
            select(User).where(User.email == "testuser@example.com")
        )
        user = result.scalar_one()
        return user.id


async def _clear_user_data(
    session_factory: async_sessionmaker[AsyncSession], user_id: UUID
) -> None:
    async with session_factory() as session:
        await session.execute(
            delete(AlipayRechargeOrder).where(AlipayRechargeOrder.tenant_id == user_id)
        )
        await session.execute(
            delete(BillingTransaction).where(BillingTransaction.tenant_id == user_id)
        )
        await session.execute(
            delete(TenantQuota).where(TenantQuota.tenant_id == user_id)
        )
        await session.execute(
            delete(SystemSetting).where(SystemSetting.key == "credits_recharge_policy")
        )
        await session.commit()


async def _seed_quota(
    session_factory: async_sessionmaker[AsyncSession], user_id: UUID, balance: Decimal
) -> None:
    async with session_factory() as session:
        quota = TenantQuota(tenant_id=user_id, balance=balance)
        session.add(quota)
        await session.commit()


async def _seed_transactions(
    session_factory: async_sessionmaker[AsyncSession],
    transactions: list[BillingTransaction],
) -> None:
    async with session_factory() as session:
        session.add_all(transactions)
        await session.commit()


@pytest.mark.asyncio
async def test_credits_balance(
    client: AsyncClient, auth_tokens: dict, AsyncSessionLocal
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    await _seed_quota(AsyncSessionLocal, user_id, Decimal("12.5"))

    now = Datetime.now()
    await _seed_transactions(
        AsyncSessionLocal,
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("3.5"),
                balance_before=Decimal("12.5"),
                balance_after=Decimal("9.0"),
                input_tokens=100,
                output_tokens=50,
                model="gpt-4o",
                created_at=now,
            ),
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("9.9"),
                balance_before=Decimal("9.0"),
                balance_after=Decimal("-0.9"),
                input_tokens=10,
                output_tokens=5,
                model="gpt-4o",
                created_at=now - timedelta(days=40),
            ),
        ],
    )

    resp = await client.get(
        "/api/v1/credits/balance",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["balance"] == 12.5
    assert data["monthlySpent"] == 3.5
    assert data["usedPercent"] > 0


@pytest.mark.asyncio
async def test_credits_consumption_and_model_usage(
    client: AsyncClient, auth_tokens: dict, AsyncSessionLocal
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    await _seed_quota(AsyncSessionLocal, user_id, Decimal("5.0"))

    now = Datetime.now()
    await _seed_transactions(
        AsyncSessionLocal,
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("1.0"),
                balance_before=Decimal("5.0"),
                balance_after=Decimal("4.0"),
                input_tokens=120,
                output_tokens=30,
                model="gpt-4o",
                created_at=now,
            ),
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("0.6"),
                balance_before=Decimal("4.0"),
                balance_after=Decimal("3.4"),
                input_tokens=60,
                output_tokens=40,
                model="claude-3.5",
                created_at=now - timedelta(days=1),
            ),
        ],
    )

    consumption = await client.get(
        "/api/v1/credits/consumption",
        params={"days": 2},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert consumption.status_code == 200
    payload = consumption.json()
    assert payload["days"] == 2
    assert set(payload["models"]) == {"gpt-4o", "claude-3.5"}
    assert len(payload["timeline"]) == 2

    usage = await client.get(
        "/api/v1/credits/model-usage",
        params={"days": 2},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert usage.status_code == 200
    usage_payload = usage.json()
    assert usage_payload["totalTokens"] == 250
    models = {item["model"]: item["tokens"] for item in usage_payload["models"]}
    assert models["gpt-4o"] == 150
    assert models["claude-3.5"] == 100


@pytest.mark.asyncio
async def test_credits_transactions_pagination(
    client: AsyncClient, auth_tokens: dict, AsyncSessionLocal
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    await _seed_quota(AsyncSessionLocal, user_id, Decimal("2.0"))

    now = Datetime.now()
    await _seed_transactions(
        AsyncSessionLocal,
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("0.2"),
                balance_before=Decimal("2.0"),
                balance_after=Decimal("1.8"),
                input_tokens=10,
                output_tokens=10,
                model="gpt-4o",
                created_at=now,
            ),
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("0.3"),
                balance_before=Decimal("1.8"),
                balance_after=Decimal("1.5"),
                input_tokens=20,
                output_tokens=10,
                model="gpt-4o",
                created_at=now - timedelta(seconds=1),
            ),
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("0.4"),
                balance_before=Decimal("1.5"),
                balance_after=Decimal("1.1"),
                input_tokens=30,
                output_tokens=10,
                model="gpt-4o",
                created_at=now - timedelta(seconds=2),
            ),
        ],
    )

    resp = await client.get(
        "/api/v1/credits/transactions",
        params={"limit": 2, "offset": 0},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["nextOffset"] == 2


@pytest.mark.asyncio
async def test_credits_recharge_updates_balance(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "USD"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    policy_resp = await client.get(
        "/api/v1/credits/recharge-policy",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert policy_resp.status_code == 200
    policy_data = policy_resp.json()
    assert policy_data["creditPerUnit"] == 20
    assert policy_data["currency"] == "USD"

    recharge_resp = await client.post(
        "/api/v1/credits/recharge",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert recharge_resp.status_code == 200
    recharge_data = recharge_resp.json()
    assert recharge_data["amount"] == 3
    assert recharge_data["creditedAmount"] == 60
    assert recharge_data["currency"] == "USD"
    assert recharge_data["balance"] == 60
    assert recharge_data["traceId"].startswith("credits-recharge-")

    async with AsyncSessionLocal() as session:
        tx = (
            await session.execute(
                select(BillingTransaction).where(
                    BillingTransaction.trace_id == recharge_data["traceId"]
                )
            )
        ).scalar_one()
        assert tx.type == TransactionType.RECHARGE
        assert tx.status == TransactionStatus.COMMITTED
        assert float(tx.amount) == 60

    balance_resp = await client.get(
        "/api/v1/credits/balance",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert balance_resp.status_code == 200
    balance_data = balance_resp.json()
    assert balance_data["balance"] == 60


@pytest.mark.asyncio
async def test_alipay_recharge_order_creation(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    private_key, public_key = _generate_rsa_keypair()

    monkeypatch.setattr("app.core.config.settings.ALIPAY_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_APP_ID", "2026000000000001")
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PRIVATE_KEY",
        private_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PUBLIC_KEY",
        public_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_NOTIFY_URL",
        "https://example.com/api/v1/credits/recharge/alipay/notify",
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_RETURN_URL",
        "https://example.com/dashboard/credits",
    )
    monkeypatch.setattr("app.core.config.settings.ALIPAY_RECHARGE_SUBJECT", "Credits")

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "CNY"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    resp = await client.post(
        "/api/v1/credits/recharge/alipay/order",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["amount"] == 3
    assert data["currency"] == "CNY"
    assert data["expectedCreditedAmount"] == 60
    assert data["outTradeNo"].startswith("rcg")
    assert "openapi.alipay.com/gateway.do" in data["payUrl"]

    parsed = parse_qs(urlparse(data["payUrl"]).query)
    assert parsed.get("method", [""])[0] == "alipay.trade.page.pay"
    assert parsed.get("app_id", [""])[0] == "2026000000000001"
    assert parsed.get("sign_type", [""])[0] == "RSA2"
    biz_content_raw = parsed.get("biz_content", ["{}"])[0]
    biz_content = json.loads(biz_content_raw)
    assert biz_content["out_trade_no"] == data["outTradeNo"]
    assert biz_content["total_amount"] == "3.00"
    assert parsed.get("sign", [""])[0]


@pytest.mark.asyncio
async def test_alipay_notify_recharge_is_idempotent(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    private_key, public_key = _generate_rsa_keypair()

    monkeypatch.setattr("app.core.config.settings.ALIPAY_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_APP_ID", "2026000000000001")
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PRIVATE_KEY",
        private_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PUBLIC_KEY",
        public_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_NOTIFY_URL",
        "https://example.com/api/v1/credits/recharge/alipay/notify",
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_RETURN_URL",
        "https://example.com/dashboard/credits",
    )
    monkeypatch.setattr("app.core.config.settings.ALIPAY_RECHARGE_SUBJECT", "Credits")

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "CNY"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    order_resp = await client.post(
        "/api/v1/credits/recharge/alipay/order",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert order_resp.status_code == 200
    out_trade_no = order_resp.json()["outTradeNo"]

    notify_payload = {
        "app_id": "2026000000000001",
        "charset": "utf-8",
        "notify_time": "2026-03-05 00:01:05",
        "notify_type": "trade_status_sync",
        "out_trade_no": out_trade_no,
        "seller_id": "2088101122136241",
        "trade_no": "2026030522001400000000000001",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "3.00",
        "version": "1.0",
        "sign_type": "RSA2",
    }
    notify_payload["sign"] = _sign_alipay_notify_payload(notify_payload, private_key)

    first = await client.post(
        "/api/v1/credits/recharge/alipay/notify",
        data=notify_payload,
    )
    assert first.status_code == 200
    assert first.text == "success"

    second = await client.post(
        "/api/v1/credits/recharge/alipay/notify",
        data=notify_payload,
    )
    assert second.status_code == 200
    assert second.text == "success"

    balance_resp = await client.get(
        "/api/v1/credits/balance",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert balance_resp.status_code == 200
    assert balance_resp.json()["balance"] == 60

    async with AsyncSessionLocal() as session:
        txs = (
            await session.execute(
                select(BillingTransaction).where(
                    BillingTransaction.tenant_id == user_id,
                    BillingTransaction.type == TransactionType.RECHARGE,
                )
            )
        ).scalars().all()
        assert len(txs) == 1
        assert float(txs[0].amount) == 60


@pytest.mark.asyncio
async def test_alipay_notify_rejects_invalid_signature(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    private_key, public_key = _generate_rsa_keypair()

    monkeypatch.setattr("app.core.config.settings.ALIPAY_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_APP_ID", "2026000000000001")
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PRIVATE_KEY",
        private_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_PUBLIC_KEY",
        public_key,
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_NOTIFY_URL",
        "https://example.com/api/v1/credits/recharge/alipay/notify",
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_RETURN_URL",
        "https://example.com/dashboard/credits",
    )
    monkeypatch.setattr("app.core.config.settings.ALIPAY_RECHARGE_SUBJECT", "Credits")

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "CNY"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    order_resp = await client.post(
        "/api/v1/credits/recharge/alipay/order",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert order_resp.status_code == 200
    out_trade_no = order_resp.json()["outTradeNo"]

    notify_payload = {
        "app_id": "2026000000000001",
        "charset": "utf-8",
        "notify_time": "2026-03-05 00:01:05",
        "notify_type": "trade_status_sync",
        "out_trade_no": out_trade_no,
        "seller_id": "2088101122136241",
        "trade_no": "2026030522001400000000000001",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "3.00",
        "version": "1.0",
        "sign_type": "RSA2",
        "sign": "invalid-sign",
    }

    resp = await client.post(
        "/api/v1/credits/recharge/alipay/notify",
        data=notify_payload,
    )
    assert resp.status_code == 400
    assert resp.text == "failure"

    balance_resp = await client.get(
        "/api/v1/credits/balance",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert balance_resp.status_code == 200
    assert balance_resp.json()["balance"] == 0


@pytest.mark.asyncio
async def test_alipay_order_status_is_pending_before_notify(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    private_key, public_key = _generate_rsa_keypair()

    monkeypatch.setattr("app.core.config.settings.ALIPAY_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_APP_ID", "2026000000000001")
    monkeypatch.setattr("app.core.config.settings.ALIPAY_PRIVATE_KEY", private_key)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_PUBLIC_KEY", public_key)
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_NOTIFY_URL",
        "https://example.com/api/v1/credits/recharge/alipay/notify",
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_RETURN_URL",
        "https://example.com/dashboard/credits",
    )
    monkeypatch.setattr("app.core.config.settings.ALIPAY_RECHARGE_SUBJECT", "Credits")

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "CNY"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    order_resp = await client.post(
        "/api/v1/credits/recharge/alipay/order",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert order_resp.status_code == 200
    out_trade_no = order_resp.json()["outTradeNo"]

    status_resp = await client.get(
        "/api/v1/credits/recharge/alipay/status",
        params={"out_trade_no": out_trade_no},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["outTradeNo"] == out_trade_no
    assert data["status"] == "pending"
    assert data["tradeStatus"] == "WAIT_BUYER_PAY"
    assert data["amount"] == 3
    assert data["currency"] == "CNY"
    assert data["expectedCreditedAmount"] == 60
    assert data["creditedAmount"] == 0
    assert data["refreshed"] is False


@pytest.mark.asyncio
async def test_alipay_order_status_refresh_reconciles_successful_trade(
    client: AsyncClient,
    auth_tokens: dict,
    admin_tokens: dict,
    AsyncSessionLocal,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _get_test_user_id(AsyncSessionLocal)
    await _clear_user_data(AsyncSessionLocal, user_id)
    private_key, public_key = _generate_rsa_keypair()

    monkeypatch.setattr("app.core.config.settings.ALIPAY_ENABLED", True)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_APP_ID", "2026000000000001")
    monkeypatch.setattr("app.core.config.settings.ALIPAY_PRIVATE_KEY", private_key)
    monkeypatch.setattr("app.core.config.settings.ALIPAY_PUBLIC_KEY", public_key)
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_NOTIFY_URL",
        "https://example.com/api/v1/credits/recharge/alipay/notify",
    )
    monkeypatch.setattr(
        "app.core.config.settings.ALIPAY_RETURN_URL",
        "https://example.com/dashboard/credits",
    )
    monkeypatch.setattr("app.core.config.settings.ALIPAY_RECHARGE_SUBJECT", "Credits")

    await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        json={"credit_per_unit": 20, "currency": "CNY"},
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )

    order_resp = await client.post(
        "/api/v1/credits/recharge/alipay/order",
        json={"amount": 3},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert order_resp.status_code == 200
    out_trade_no = order_resp.json()["outTradeNo"]

    async def _fake_query_trade(self, *, out_trade_no: str):
        return SimpleNamespace(
            code="10000",
            trade_status="TRADE_SUCCESS",
            out_trade_no=out_trade_no,
            trade_no="2026030722001400000000000001",
            total_amount=Decimal("3.00"),
            seller_id=None,
            raw_response={"trade_status": "TRADE_SUCCESS"},
        )

    monkeypatch.setattr(
        "app.services.payments.alipay_service.AlipayService.query_trade",
        _fake_query_trade,
    )

    status_resp = await client.get(
        "/api/v1/credits/recharge/alipay/status",
        params={"out_trade_no": out_trade_no, "refresh": "true"},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["outTradeNo"] == out_trade_no
    assert data["status"] == "success"
    assert data["tradeStatus"] == "TRADE_SUCCESS"
    assert data["tradeNo"] == "2026030722001400000000000001"
    assert data["creditedAmount"] == 60
    assert data["refreshed"] is True

    balance_resp = await client.get(
        "/api/v1/credits/balance",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert balance_resp.status_code == 200
    assert balance_resp.json()["balance"] == 60
