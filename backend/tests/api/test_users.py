"""
用户自助 API 测试

测试场景:
- 用户注册和激活流程
- 密码重置流程
- 用户信息获取和更新
- 密码修改
"""
import pytest
from httpx import AsyncClient


class TestRegistration:
    """注册测试"""

    @pytest.mark.asyncio
    async def test_register_removed(self, client: AsyncClient):
        """注册接口已下线，提示用户使用验证码登录。"""
        response = await client.post(
            "/api/v1/users/register",
            json={
                "email": "newuser@example.com",
                "password": "securepassword123",
            },
        )
        assert response.status_code in [404, 405]

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client: AsyncClient, test_user: dict):
        """注册接口已下线，兼容性提示"""
        response = await client.post(
            "/api/v1/users/register",
            json={"email": test_user["email"], "password": "anypassword123"},
        )
        assert response.status_code in [404, 405]

    @pytest.mark.asyncio
    async def test_register_weak_password(self, client: AsyncClient):
        """注册接口已下线，不再校验密码强度。"""
        response = await client.post(
            "/api/v1/users/register",
            json={"email": "weakpass@example.com", "password": "123"},
        )
        assert response.status_code in [404, 405]


class TestActivation:
    """激活测试"""

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_activate_removed(self, client: AsyncClient, inactive_user: dict):
        """激活接口已下线，登录即激活。"""
        response = await client.post(
            "/api/v1/users/activate",
            json={"email": inactive_user["email"], "code": "123456"},
        )
        assert response.status_code in [404, 405]


class TestPasswordReset:
    """密码重置已移除"""

    @pytest.mark.asyncio
    async def test_reset_removed(self, client: AsyncClient, test_user: dict):
        response = await client.post(
            "/api/v1/users/reset-password",
            json={"email": test_user["email"]},
        )
        assert response.status_code == 200
        assert "removed" in response.json()["message"].lower()


class TestUserProfile:
    """用户信息测试"""

    @pytest.mark.asyncio
    async def test_get_me_success(self, client: AsyncClient, auth_tokens: dict):
        """测试获取当前用户信息"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "email" in data
        assert "avatar_url" in data
        assert "permission_flags" in data

    @pytest.mark.asyncio
    async def test_update_me_success(self, client: AsyncClient, auth_tokens: dict):
        """测试更新当前用户信息"""
        response = await client.patch(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={
                "username": "Updated Name",
                "avatar_url": "https://example.com/avatar.png",
            },
        )
        assert response.status_code == 200
        assert response.json()["username"] == "Updated Name"
        assert response.json()["avatar_url"] == "https://example.com/avatar.png"


class TestChangePassword:
    """修改密码测试"""

    @pytest.mark.asyncio
    async def test_change_password_removed(
        self,
        client: AsyncClient,
        auth_tokens: dict,
        test_user: dict,
    ):
        """密码修改已移除，应返回 410。"""
        response = await client.post(
            "/api/v1/users/me/change-password",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={
                "old_password": test_user["password"],
                "new_password": "newSecurePassword123",
            },
        )
        assert response.status_code == 410

    @pytest.mark.asyncio
    async def test_change_password_removed_wrong_old(
        self,
        client: AsyncClient,
        auth_tokens: dict,
    ):
        """即使旧密码错误也返回统一 410。"""
        response = await client.post(
            "/api/v1/users/me/change-password",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={
                "old_password": "wrongoldpassword",
                "new_password": "newSecurePassword123",
            },
        )
        assert response.status_code == 410
