from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.models import User
from app.models.billing import BillingTransaction, TenantQuota, TransactionStatus, TransactionType
from app.utils.time_utils import Datetime
from tests.api.conftest import AsyncSessionLocal


async def _get_test_user_id() -> UUID:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == "testuser@example.com"))
        user = result.scalar_one()
        return user.id


async def _clear_user_data(user_id: UUID) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(delete(BillingTransaction).where(BillingTransaction.tenant_id == user_id))
        await session.execute(delete(TenantQuota).where(TenantQuota.tenant_id == user_id))
        await session.commit()


async def _seed_quota(user_id: UUID, balance: Decimal) -> None:
    async with AsyncSessionLocal() as session:
        quota = TenantQuota(tenant_id=user_id, balance=balance)
        session.add(quota)
        await session.commit()


async def _seed_transactions(transactions: list[BillingTransaction]) -> None:
    async with AsyncSessionLocal() as session:
        session.add_all(transactions)
        await session.commit()


@pytest.mark.asyncio
async def test_credits_balance(client: AsyncClient, auth_tokens: dict) -> None:
    user_id = await _get_test_user_id()
    await _clear_user_data(user_id)
    await _seed_quota(user_id, Decimal("12.5"))

    now = Datetime.now()
    await _seed_transactions(
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("3.5"),
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
                input_tokens=10,
                output_tokens=5,
                model="gpt-4o",
                created_at=now - timedelta(days=40),
            ),
        ]
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
async def test_credits_consumption_and_model_usage(client: AsyncClient, auth_tokens: dict) -> None:
    user_id = await _get_test_user_id()
    await _clear_user_data(user_id)
    await _seed_quota(user_id, Decimal("5.0"))

    now = Datetime.now()
    await _seed_transactions(
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("1.0"),
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
                input_tokens=60,
                output_tokens=40,
                model="claude-3.5",
                created_at=now - timedelta(days=1),
            ),
        ]
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
async def test_credits_transactions_pagination(client: AsyncClient, auth_tokens: dict) -> None:
    user_id = await _get_test_user_id()
    await _clear_user_data(user_id)
    await _seed_quota(user_id, Decimal("2.0"))

    now = Datetime.now()
    await _seed_transactions(
        [
            BillingTransaction(
                tenant_id=user_id,
                trace_id=uuid4().hex,
                type=TransactionType.DEDUCT,
                status=TransactionStatus.COMMITTED,
                amount=Decimal("0.2"),
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
                input_tokens=30,
                output_tokens=10,
                model="gpt-4o",
                created_at=now - timedelta(seconds=2),
            ),
        ]
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
