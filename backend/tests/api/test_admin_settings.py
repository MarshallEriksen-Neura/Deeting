import pytest
from httpx import AsyncClient
from sqlalchemy import delete

from app.models.system_setting import SystemSetting


@pytest.mark.asyncio
async def test_admin_recharge_policy_get_and_update(
    client: AsyncClient, admin_tokens: dict, AsyncSessionLocal
) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(SystemSetting).where(SystemSetting.key == "credits_recharge_policy")
        )
        await session.commit()

    headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    default_resp = await client.get(
        "/api/v1/admin/settings/recharge-policy", headers=headers
    )
    assert default_resp.status_code == 200
    default_data = default_resp.json()
    assert default_data["credit_per_unit"] > 0
    assert default_data["currency"] == "USD"

    update_resp = await client.patch(
        "/api/v1/admin/settings/recharge-policy",
        headers=headers,
        json={"credit_per_unit": 12.5, "currency": "cny"},
    )
    assert update_resp.status_code == 200
    updated_data = update_resp.json()
    assert updated_data["credit_per_unit"] == 12.5
    assert updated_data["currency"] == "CNY"

    read_back_resp = await client.get(
        "/api/v1/admin/settings/recharge-policy", headers=headers
    )
    assert read_back_resp.status_code == 200
    read_back_data = read_back_resp.json()
    assert read_back_data["credit_per_unit"] == 12.5
    assert read_back_data["currency"] == "CNY"
