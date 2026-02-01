import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_skill_success(client: AsyncClient, admin_tokens: dict):
    response = await client.post(
        "/api/v1/admin/skills",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={"id": "docx_editor", "name": "Docx Editor"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["id"] == "docx_editor"
    assert data["name"] == "Docx Editor"
    assert data["status"] == "draft"


@pytest.mark.asyncio
async def test_get_skill_success(client: AsyncClient, admin_tokens: dict):
    await client.post(
        "/api/v1/admin/skills",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={"id": "pdf_editor", "name": "PDF Editor"},
    )
    response = await client.get(
        "/api/v1/admin/skills/pdf_editor",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "pdf_editor"


@pytest.mark.asyncio
async def test_list_skills_success(client: AsyncClient, admin_tokens: dict):
    response = await client.get(
        "/api/v1/admin/skills",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_update_skill_success(client: AsyncClient, admin_tokens: dict):
    await client.post(
        "/api/v1/admin/skills",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={"id": "pptx_editor", "name": "PPTX Editor"},
    )
    response = await client.patch(
        "/api/v1/admin/skills/pptx_editor",
        headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        json={"status": "active"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "active"


@pytest.mark.asyncio
async def test_create_skill_no_permission(client: AsyncClient, auth_tokens: dict):
    response = await client.post(
        "/api/v1/admin/skills",
        headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        json={"id": "blocked_skill", "name": "Blocked"},
    )
    assert response.status_code == 403
