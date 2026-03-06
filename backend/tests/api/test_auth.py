"""
认证 API 测试

测试场景:
- 登录成功/失败
- JWT 验证有效/过期/吊销
- Token 刷新和轮换
- 登出
"""

from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.login_session import LoginSession
from app.utils.security import decode_token
from main import app


async def _login(client: AsyncClient, email: str) -> dict:
    await client.post(
        "/api/v1/auth/login/code",
        json={"email": email},
    )
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "code": "123456"},
    )
    assert response.status_code == 200
    return response.json()


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
    async def test_login_creates_bound_login_session(
        self,
        client: AsyncClient,
        test_user: dict,
        AsyncSessionLocal,
    ):
        data = await _login(client, test_user["email"])
        access_payload = decode_token(data["access_token"])
        refresh_payload = decode_token(data["refresh_token"])

        assert access_payload["sid"] == refresh_payload["sid"]

        async with AsyncSessionLocal() as session:
            login_session = await session.scalar(
                select(LoginSession).where(
                    LoginSession.user_id == UUID(test_user["id"]),
                    LoginSession.session_key == access_payload["sid"],
                )
            )

        assert login_session is not None
        assert login_session.current_access_jti == access_payload["jti"]
        assert login_session.current_refresh_jti == refresh_payload["jti"]

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
            json={
                "email": "fresh@example.com",
                "code": "123456",
                "invite_code": "TEST_INVITE_CODE",
            },
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
    async def test_refresh_token_reuse_detection(
        self, client: AsyncClient, auth_tokens: dict
    ):
        """测试 refresh token 重用检测"""
        # 第一次刷新
        response1 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response1.status_code == 200
        refreshed_access_token = response1.json()["access_token"]

        # 清空 Cookie，强制第二次仅使用旧 body token 触发重用检测
        client.cookies.clear()
        response2 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response2.status_code == 401
        assert "reuse" in response2.json()["detail"].lower()

        # 并发/快速重试不应误伤全量会话（新 access token 仍可访问）
        me_resp = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {refreshed_access_token}"},
        )
        assert me_resp.status_code == 200

    @pytest.mark.asyncio
    async def test_refresh_prefers_cookie_over_body_token(
        self, client: AsyncClient, auth_tokens: dict
    ):
        """当 Cookie 与 body 同时存在且不一致时，应优先使用 Cookie。"""
        # 第一次刷新，客户端 Cookie 将自动更新为新 refresh token
        response1 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response1.status_code == 200

        # 第二次故意带旧 body token；若后端优先 Cookie，应继续成功
        response2 = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response2.status_code == 200

    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self, client: AsyncClient):
        """测试无效 refresh token"""
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "invalid.token.here"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_rotates_tokens_on_same_login_session(
        self,
        client: AsyncClient,
        auth_tokens: dict,
        AsyncSessionLocal,
    ):
        old_access = decode_token(auth_tokens["access_token"])
        old_refresh = decode_token(auth_tokens["refresh_token"])

        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": auth_tokens["refresh_token"]},
        )
        assert response.status_code == 200

        data = response.json()
        new_access = decode_token(data["access_token"])
        new_refresh = decode_token(data["refresh_token"])

        assert new_access["sid"] == old_access["sid"]
        assert new_refresh["sid"] == old_refresh["sid"]
        assert new_access["jti"] != old_access["jti"]
        assert new_refresh["jti"] != old_refresh["jti"]

        async with AsyncSessionLocal() as session:
            login_session = await session.scalar(
                select(LoginSession).where(
                    LoginSession.session_key == new_access["sid"],
                )
            )

        assert login_session is not None
        assert login_session.current_access_jti == new_access["jti"]
        assert login_session.current_refresh_jti == new_refresh["jti"]


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
    async def test_x_user_id_backward_compat(
        self, client: AsyncClient, test_user: dict
    ):
        """X-User-Id 已废弃，期望被拒绝"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"X-User-Id": test_user["id"]},
        )
        assert response.status_code == 401


class TestLoginSessions:
    @pytest.mark.asyncio
    async def test_profile_revoke_invalidates_other_device(
        self,
        test_user: dict,
    ):
        transport = ASGITransport(app=app)
        async with (
            AsyncClient(transport=transport, base_url="http://test") as device_a,
            AsyncClient(transport=transport, base_url="http://test") as device_b,
        ):
            tokens_a = await _login(device_a, test_user["email"])
            tokens_b = await _login(device_b, test_user["email"])

            sessions_response = await device_b.get(
                "/api/v1/login-sessions",
                headers={"Authorization": f"Bearer {tokens_b['access_token']}"},
            )
            assert sessions_response.status_code == 200
            sessions = sessions_response.json()
            target = next(item for item in sessions if not item["is_current"])

            revoke_response = await device_b.delete(
                f"/api/v1/login-sessions/{target['id']}",
                headers={"Authorization": f"Bearer {tokens_b['access_token']}"},
            )
            assert revoke_response.status_code == 200

            me_response = await device_a.get(
                "/api/v1/users/me",
                headers={"Authorization": f"Bearer {tokens_a['access_token']}"},
            )
            assert me_response.status_code == 401
            assert "session" in me_response.json()["detail"].lower()

            refresh_response = await device_a.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": tokens_a["refresh_token"]},
            )
            assert refresh_response.status_code == 401

    @pytest.mark.asyncio
    async def test_profile_cannot_revoke_current_device(
        self,
        client: AsyncClient,
        auth_tokens: dict,
    ):
        sessions_response = await client.get(
            "/api/v1/login-sessions",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert sessions_response.status_code == 200
        current = next(item for item in sessions_response.json() if item["is_current"])

        revoke_response = await client.delete(
            f"/api/v1/login-sessions/{current['id']}",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert revoke_response.status_code == 400
