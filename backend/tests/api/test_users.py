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
    async def test_register_success(self, client: AsyncClient):
        """测试注册成功"""
        # 简化：当前实现要求开启注册控制时必须携带邀请码；
        # 此处依赖测试环境是否启用控制，如启用需预置 invite_code fixture。
        response = await client.post(
            "/api/v1/users/register",
            json={
                "email": "newuser@example.com",
                "password": "securepassword123",
                "username": "New User",
                "invite_code": "TEST_INVITE_CODE",  # 若未启用注册控制，可忽略此字段
            },
        )
        assert response.status_code == 200
        assert "activation code" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client: AsyncClient, test_user: dict):
        """测试重复邮箱注册"""
        response = await client.post(
            "/api/v1/users/register",
            json={
                "email": test_user["email"],
                "password": "anypassword123",
            },
        )
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_weak_password(self, client: AsyncClient):
        """测试弱密码"""
        response = await client.post(
            "/api/v1/users/register",
            json={
                "email": "weakpass@example.com",
                "password": "123",  # 太短
            },
        )
        assert response.status_code == 422  # Validation error


class TestActivation:
    """激活测试"""

    @pytest.mark.asyncio
    async def test_activate_success(
        self,
        client: AsyncClient,
        pending_activation_user: dict,
    ):
        """测试激活成功"""
        response = await client.post(
            "/api/v1/users/activate",
            json={
                "email": pending_activation_user["email"],
                "code": pending_activation_user["activation_code"],
            },
        )
        assert response.status_code == 200
        assert "activated" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_activate_invalid_code(self, client: AsyncClient, inactive_user: dict):
        """测试无效验证码"""
        response = await client.post(
            "/api/v1/users/activate",
            json={
                "email": inactive_user["email"],
                "code": "000000",  # 错误的验证码
            },
        )
        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()


class TestPasswordReset:
    """密码重置测试"""

    @pytest.mark.asyncio
    async def test_request_reset_success(self, client: AsyncClient, test_user: dict):
        """测试请求重置成功"""
        response = await client.post(
            "/api/v1/users/reset-password",
            json={"email": test_user["email"]},
        )
        assert response.status_code == 200
        # 即使用户不存在也返回相同消息（安全考虑）

    @pytest.mark.asyncio
    async def test_request_reset_unknown_email(self, client: AsyncClient):
        """测试未知邮箱请求重置"""
        response = await client.post(
            "/api/v1/users/reset-password",
            json={"email": "unknown@example.com"},
        )
        # 不透露用户是否存在
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_confirm_reset_success(
        self,
        client: AsyncClient,
        user_with_reset_code: dict,
    ):
        """测试确认重置成功"""
        response = await client.post(
            "/api/v1/users/reset-password/confirm",
            json={
                "email": user_with_reset_code["email"],
                "code": user_with_reset_code["reset_code"],
                "new_password": "newSecurePassword123",
            },
        )
        assert response.status_code == 200
        assert "reset" in response.json()["message"].lower()


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
        assert "permission_flags" in data

    @pytest.mark.asyncio
    async def test_update_me_success(self, client: AsyncClient, auth_tokens: dict):
        """测试更新当前用户信息"""
        response = await client.patch(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={"username": "Updated Name"},
        )
        assert response.status_code == 200
        assert response.json()["username"] == "Updated Name"


class TestChangePassword:
    """修改密码测试"""

    @pytest.mark.asyncio
    async def test_change_password_success(
        self,
        client: AsyncClient,
        auth_tokens: dict,
        test_user: dict,
    ):
        """测试修改密码成功"""
        response = await client.post(
            "/api/v1/users/me/change-password",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={
                "old_password": test_user["password"],
                "new_password": "newSecurePassword123",
            },
        )
        assert response.status_code == 200
        assert "changed" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_change_password_wrong_old(
        self,
        client: AsyncClient,
        auth_tokens: dict,
    ):
        """测试旧密码错误"""
        response = await client.post(
            "/api/v1/users/me/change-password",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
            json={
                "old_password": "wrongoldpassword",
                "new_password": "newSecurePassword123",
            },
        )
        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()
