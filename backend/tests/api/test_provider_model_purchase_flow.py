import hashlib
import uuid

import pytest
from sqlalchemy import func, select

from app.models import BillingTransaction, User
from app.models.provider_instance import ProviderModelEntitlement
from app.models.provider_preset import ProviderPreset
from tests.utils.provider_protocol_profiles import build_protocol_profiles

DEFAULT_PROFILE_CONFIGS = {
    "chat": {
        "template_engine": "simple_replace",
        "request_template": {
            "model": None,
            "messages": None,
            "stream": None,
            "status_stream": None,
            "temperature": None,
            "max_tokens": None,
            "provider_model_id": None,
            "assistant_id": None,
            "session_id": None,
        },
        "response_transform": {},
        "default_headers": {},
        "default_params": {},
        "async_config": {},
    },
}


def _build_trace_id(user_id: str, model_id: str) -> str:
    digest = hashlib.sha256(f"{user_id}:{model_id}".encode("utf-8")).hexdigest()[:40]
    return f"model-purchase-{digest}"


async def _seed_preset(session, slug: str = "openai") -> None:
    existing = (
        await session.execute(
            select(ProviderPreset.slug).where(ProviderPreset.slug == slug)
        )
    ).scalar_one_or_none()
    if existing:
        return

    session.add(
        ProviderPreset(
            id=uuid.uuid4(),
            name="OpenAI",
            slug=slug,
            provider="openai",
            base_url="https://api.openai.com",
            auth_type="bearer",
            auth_config={"secret_ref_id": "ENV_OPENAI_KEY"},
            protocol_schema_version="2026-03-07",
            protocol_profiles=build_protocol_profiles(
                provider="openai",
                profile_configs=DEFAULT_PROFILE_CONFIGS,
            ),
            is_active=True,
        )
    )
    await session.commit()


async def _get_test_user_id(session_factory) -> uuid.UUID:
    async with session_factory() as session:
        result = await session.execute(
            select(User.id).where(User.email == "testuser@example.com").limit(1)
        )
        user_id = result.scalar_one_or_none()
        if not user_id:
            raise RuntimeError("test user not found")
        return user_id


@pytest.mark.asyncio
async def test_public_paid_model_requires_purchase_and_unlocks_after_buy(
    client,
    admin_tokens,
    auth_tokens,
    AsyncSessionLocal,
):
    async with AsyncSessionLocal() as session:
        await _seed_preset(session)

    user_id = await _get_test_user_id(AsyncSessionLocal)
    admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
    user_headers = {"Authorization": f"Bearer {auth_tokens['access_token']}"}

    create_resp = await client.post(
        "/api/v1/admin/provider-instances",
        json={
            "preset_slug": "openai",
            "name": "admin-public-paid",
            "base_url": "https://api.openai.com",
            "credentials_ref": "ENV_OPENAI_KEY",
            "is_enabled": True,
            "is_public": True,
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 201
    instance_id = create_resp.json()["id"]

    sync_resp = await client.post(
        f"/api/v1/admin/provider-instances/{instance_id}/models:sync",
        json={
            "models": [
                {
                    "capabilities": ["chat"],
                    "model_id": "gpt-4o-mini-pro",
                    "upstream_path": "chat/completions",
                    "display_name": "GPT-4o Mini Pro",
                    "pricing_config": {
                        "unlock_price_credits": 12,
                        "input_per_1k": 0.001,
                        "output_per_1k": 0.002,
                    },
                    "source": "manual",
                },
                {
                    "capabilities": ["chat"],
                    "model_id": "gpt-4o-mini-free",
                    "upstream_path": "chat/completions",
                    "display_name": "GPT-4o Mini Free",
                    "source": "manual",
                },
            ]
        },
        headers=admin_headers,
    )
    assert sync_resp.status_code == 200
    synced_models = sync_resp.json()
    paid_model = next(m for m in synced_models if m["model_id"] == "gpt-4o-mini-pro")
    paid_provider_model_id = paid_model["id"]

    list_models_resp = await client.get(
        f"/api/v1/providers/instances/{instance_id}/models",
        headers=user_headers,
    )
    assert list_models_resp.status_code == 200
    paid_row = next(
        m for m in list_models_resp.json() if m["model_id"] == "gpt-4o-mini-pro"
    )
    assert paid_row["is_locked"] is True
    assert paid_row["is_purchased"] is False
    assert paid_row["unlock_price_credits"] == 12

    pre_internal_resp = await client.get("/api/v1/internal/models", headers=user_headers)
    assert pre_internal_resp.status_code == 200
    pre_ids = {
        item["id"]
        for group in pre_internal_resp.json().get("instances", [])
        for item in group.get("models", [])
    }
    assert "gpt-4o-mini-pro" not in pre_ids
    assert "gpt-4o-mini-free" in pre_ids

    pre_available_resp = await client.get("/api/v1/models/available", headers=user_headers)
    assert pre_available_resp.status_code == 200
    pre_available = set(pre_available_resp.json().get("items", []))
    assert "gpt-4o-mini-pro" not in pre_available

    pre_route_resp = await client.post(
        "/api/v1/internal/debug/test-routing",
        json={
            "model": "gpt-4o-mini-pro",
            "capability": "chat",
            "provider_model_id": paid_provider_model_id,
        },
        headers=user_headers,
    )
    assert pre_route_resp.status_code == 400

    purchase_without_balance = await client.post(
        f"/api/v1/providers/models/{paid_provider_model_id}/purchase",
        headers=user_headers,
    )
    assert purchase_without_balance.status_code == 402

    # ensure quota exists then top up credits
    _ = await client.get("/api/v1/credits/balance", headers=user_headers)
    adjust_resp = await client.post(
        f"/api/v1/admin/quotas/{user_id}/adjust",
        json={"amount": 30, "reason": "test topup"},
        headers=admin_headers,
    )
    assert adjust_resp.status_code == 200

    purchase_resp = await client.post(
        f"/api/v1/providers/models/{paid_provider_model_id}/purchase",
        headers=user_headers,
    )
    assert purchase_resp.status_code == 200
    assert purchase_resp.json()["is_purchased"] is True
    assert purchase_resp.json()["is_locked"] is False

    duplicate_purchase_resp = await client.post(
        f"/api/v1/providers/models/{paid_provider_model_id}/purchase",
        headers=user_headers,
    )
    assert duplicate_purchase_resp.status_code == 200
    assert duplicate_purchase_resp.json()["is_purchased"] is True

    post_internal_resp = await client.get("/api/v1/internal/models", headers=user_headers)
    assert post_internal_resp.status_code == 200
    post_ids = {
        item["id"]
        for group in post_internal_resp.json().get("instances", [])
        for item in group.get("models", [])
    }
    assert "gpt-4o-mini-pro" in post_ids

    post_available_resp = await client.get(
        "/api/v1/models/available", headers=user_headers
    )
    assert post_available_resp.status_code == 200
    post_available = set(post_available_resp.json().get("items", []))
    assert "gpt-4o-mini-pro" in post_available

    trace_id = _build_trace_id(str(user_id), paid_provider_model_id)
    async with AsyncSessionLocal() as session:
        tx_count = (
            await session.execute(
                select(func.count(BillingTransaction.id)).where(
                    BillingTransaction.trace_id == trace_id
                )
            )
        ).scalar_one()
        entitlement_count = (
            await session.execute(
                select(func.count(ProviderModelEntitlement.id)).where(
                    ProviderModelEntitlement.user_id == user_id,
                    ProviderModelEntitlement.provider_model_id
                    == uuid.UUID(paid_provider_model_id),
                )
            )
        ).scalar_one()

    assert int(tx_count) == 1
    assert int(entitlement_count) == 1
