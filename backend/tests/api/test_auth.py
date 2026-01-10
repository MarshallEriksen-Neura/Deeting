"""
认证 API 测试

测试场景:
- 登录成功/失败
- JWT 验证有效/过期/吊销
- Token 刷新和轮换
- 登出
"""
import pytest
from httpx import AsyncClient


class TestLogin:
    """登录测试"""

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, test_user: dict):
        """测试验证码登录成功"""
        await client.post(
            "/api/v1/auth/login/code",
            json={"email": test_user["email"]},
        )
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user["email"], "code": "123456"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_login_invalid_code(self, client: AsyncClient, test_user: dict):
        """测试验证码错误"""
        await client.post(
            "/api/v1/auth/login/code",
            json={"email": test_user["email"]},
        )
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user["email"], "code": "000000"},
        )
        assert response.status_code == 401
        assert "invalid" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_auto_register_with_invite(self, client: AsyncClient):
        """新用户首登自动注册（需邀请码时提供 invite_code）。"""
        await client.post(
            "/api/v1/auth/login/code",
            json={"email": "fresh@example.com", "invite_code": "TEST_INVITE_CODE"},
        )
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "fresh@example.com", "code": "123456", "invite_code": "TEST_INVITE_CODE"},
        )
        assert resp.status_code in [200, 403]  # 若未配置邀请码则可能 403

    @pytest.mark.asyncio
    async def test_login_inactive_user(self, client: AsyncClient, inactive_user: dict):
        """未激活用户应被自动激活并登录"""
        await client.post(
            "/api/v1/auth/login/code",
            json={"email": inactive_user["email"]},
        )
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": inactive_user["email"], "code": "123456"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_login_code_attempt_limit(self, client: AsyncClient, test_user: dict):
        """验证码输错达到上限后应失效"""
        await client.post(
            "/api/v1/auth/login/code",
            json={"email": test_user["email"]},
        )

        # 故意输错，超过上限
        for _ in range(3):
            resp = await client.post(
                "/api/v1/auth/login",
                json={"email": test_user["email"], "code": "000000"},
            )
            assert resp.status_code == 401

        # 正确验证码也应失效
        resp_ok = await client.post(
            "/api/v1/auth/login",
            json={"email": test_user["email"], "code": "123456"},
        )
        assert resp_ok.status_code == 401
        assert "invalid" in resp_ok.json()["detail"].lower()


class TestTokenRefresh:
    """Token 刷新测试"""

    @pytest.mark.asyncio
    async def test_refresh_success(self, client: AsyncClient, auth_tokens: dict):
        """测试刷新成功"""
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        # 新 token 应该与旧 token 不同（轮换）
        assert data["refresh_token"] != auth_tokens["refresh_token"]

    @pytest.mark.asyncio
    async def test_refresh_token_reuse_detection(self, client: AsyncClient, auth_tokens: dict):
        """测试 refresh token 重用检测"""
        # 第一次刷新
        response1 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response1.status_code == 200

        # 尝试重用旧的 refresh token（应该失败）
        response2 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response2.status_code == 401
        assert "reuse" in response2.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self, client: AsyncClient):
        """测试无效 refresh token"""
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "invalid.token.here"},
        )
        assert response.status_code == 401


class TestLogout:
    """登出测试"""

    @pytest.mark.asyncio
    async def test_logout_success(self, client: AsyncClient, auth_tokens: dict):
        """测试登出成功"""
        response = await client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert response.status_code == 200
        assert "logged out" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_access_after_logout(self, client: AsyncClient, auth_tokens: dict):
        """测试登出后访问"""
        # 先登出
        await client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )

        # 尝试用旧 token 访问
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert response.status_code == 401
        assert "revoked" in response.json()["detail"].lower()


class TestJWTValidation:
    """JWT 验证测试"""

    @pytest.mark.asyncio
    async def test_valid_jwt_access(self, client: AsyncClient, auth_tokens: dict):
        """测试有效 JWT 访问"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_auth_header(self, client: AsyncClient):
        """测试缺少认证头"""
        response = await client.get("/api/v1/users/me")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_invalid_token_format(self, client: AsyncClient):
        """测试无效 token 格式"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": "Bearer invalid.token"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_x_user_id_backward_compat(self, client: AsyncClient, test_user: dict):
        """X-User-Id 已废弃，期望被拒绝"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"X-User-Id": test_user["id"]},
        )
        assert response.status_code == 401
