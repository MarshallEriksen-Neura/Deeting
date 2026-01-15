from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GatewayLog, User


async def _get_test_user_id(session: AsyncSession) -> UUID:
    result = await session.execute(select(User).where(User.email == "testuser@example.com"))
    user = result.scalar_one()
    return user.id


async def _clear_logs(session: AsyncSession) -> None:
    await session.execute(delete(GatewayLog))
    await session.commit()


async def _seed_logs(session: AsyncSession, user_id, total: int = 3) -> None:
    """为指定用户插入多条日志，创建时间递减，确保游标分页顺序稳定。"""
    base_time = datetime.now(timezone.utc)
    for i in range(total):
        session.add(
            GatewayLog(
                user_id=user_id,
                model="gpt-test",
                status_code=200,
                duration_ms=100 + i,
                input_tokens=10,
                output_tokens=5,
                total_tokens=15,
                cost_upstream=0.001,
                cost_user=0.002,
                created_at=base_time - timedelta(seconds=i),
            )
        )
    await session.commit()


@pytest.mark.asyncio
async def test_list_gateway_logs_only_current_user(client: AsyncClient, auth_tokens: dict, AsyncSessionLocal) -> None:
    async with AsyncSessionLocal() as session:
        user_id = await _get_test_user_id(session)
        await _clear_logs(session)
        await _seed_logs(session, user_id, total=2)
        await _seed_logs(session, uuid4(), total=1)  # 其他用户日志

    resp = await client.get(
        "/api/v1/logs",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) == 2
    assert all(item["user_id"] == str(user_id) for item in data["items"])


@pytest.mark.asyncio
async def test_list_gateway_logs_cursor_pagination(client: AsyncClient, auth_tokens: dict, AsyncSessionLocal) -> None:
    async with AsyncSessionLocal() as session:
        user_id = await _get_test_user_id(session)
        await _clear_logs(session)
        await _seed_logs(session, user_id, total=3)

    first = await client.get(
        "/api/v1/logs",
        params={"size": 2},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert first.status_code == 200
    first_page = first.json()
    assert len(first_page["items"]) == 2

    next_cursor = first_page.get("next_page") or first_page.get("next")
    assert next_cursor is not None

    second = await client.get(
        "/api/v1/logs",
        params={"cursor": next_cursor, "size": 2},
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
    )
    assert second.status_code == 200
    second_page = second.json()
    assert "items" in second_page
    # 剩余 1 条
    assert len(second_page["items"]) == 1
