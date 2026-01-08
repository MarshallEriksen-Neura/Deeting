"""
管理员用户 API 测试

测试场景:
- 管理员用户 CRUD
- 角色分配/移除
- 封禁/解封
- 权限检查
"""
import pytest
from httpx import AsyncClient


class TestAdminUserList:
    """用户列表测试"""

    @pytest.mark.asyncio
    async def test_list_users_success(self, client: AsyncClient, admin_tokens: dict):
        """测试获取用户列表"""
        response = await client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "skip" in data
        assert "limit" in data

    @pytest.mark.asyncio
    async def test_list_users_pagination(self, client: AsyncClient, admin_tokens: dict):
        """测试分页"""
        response = await client.get(
            "/api/v1/admin/users?skip=0&limit=5",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["skip"] == 0
        assert data["limit"] == 5

    @pytest.mark.asyncio
    async def test_list_users_filter_email(self, client: AsyncClient, admin_tokens: dict):
        """测试邮箱筛选"""
        response = await client.get(
            "/api/v1/admin/users?email=test",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_list_users_no_permission(self, client: AsyncClient, auth_tokens: dict):
        """测试无权限访问"""
        response = await client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {auth_tokens['access_token']}"},
        )
        assert response.status_code == 403


class TestAdminUserCRUD:
    """用户 CRUD 测试"""

    @pytest.mark.asyncio
    async def test_create_user_success(self, client: AsyncClient, admin_tokens: dict):
        """测试创建用户"""
        response = await client.post(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={
                "email": "adminCreated@example.com",
                "password": "securepassword123",
                "username": "Admin Created User",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "adminCreated@example.com"
        assert data["is_active"] is True  # 管理员创建的用户直接激活

    @pytest.mark.asyncio
    async def test_get_user_detail(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        test_user: dict,
    ):
        """测试获取用户详情"""
        response = await client.get(
            f"/api/v1/admin/users/{test_user['id']}",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "roles" in data

    @pytest.mark.asyncio
    async def test_update_user_status(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        test_user: dict,
    ):
        """测试更新用户状态"""
        response = await client.patch(
            f"/api/v1/admin/users/{test_user['id']}",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={"is_active": False},
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is False


class TestAdminRoleManagement:
    """角色管理测试"""

    @pytest.mark.asyncio
    async def test_assign_roles(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        test_user: dict,
        test_role: dict,
    ):
        """测试分配角色"""
        response = await client.post(
            f"/api/v1/admin/users/{test_user['id']}/roles",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={"role_ids": [test_role["id"]], "action": "add"},
        )
        assert response.status_code == 200
        assert "assigned" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_remove_roles(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        user_with_role: dict,
        test_role: dict,
    ):
        """测试移除角色"""
        response = await client.post(
            f"/api/v1/admin/users/{user_with_role['id']}/roles",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={"role_ids": [test_role["id"]], "action": "remove"},
        )
        assert response.status_code == 200
        assert "removed" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_list_roles(self, client: AsyncClient, admin_tokens: dict):
        """测试获取角色列表"""
        response = await client.get(
            "/api/v1/admin/roles",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_list_permissions(self, client: AsyncClient, admin_tokens: dict):
        """测试获取权限列表"""
        response = await client.get(
            "/api/v1/admin/permissions",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestAdminBan:
    """封禁测试"""

    @pytest.mark.asyncio
    async def test_ban_user_permanent(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        test_user: dict,
    ):
        """测试永久封禁"""
        response = await client.post(
            f"/api/v1/admin/users/{test_user['id']}/ban",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={"reason": "Violation of terms"},
        )
        assert response.status_code == 200
        assert "permanently" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_ban_user_temporary(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        test_user: dict,
    ):
        """测试临时封禁"""
        response = await client.post(
            f"/api/v1/admin/users/{test_user['id']}/ban",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
            json={"reason": "Temporary suspension", "duration_hours": 24},
        )
        assert response.status_code == 200
        assert "24 hours" in response.json()["message"]

    @pytest.mark.asyncio
    async def test_unban_user(
        self,
        client: AsyncClient,
        admin_tokens: dict,
        banned_user: dict,
    ):
        """测试解封"""
        response = await client.post(
            f"/api/v1/admin/users/{banned_user['id']}/unban",
            headers={"Authorization": f"Bearer {admin_tokens['access_token']}"},
        )
        assert response.status_code == 200
        assert "unbanned" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_banned_user_login(self, client: AsyncClient, banned_user: dict):
        """测试被封禁用户登录"""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": banned_user["email"], "password": banned_user["password"]},
        )
        # 登录应该成功，但后续请求会被拒绝
        # 或者根据实现，登录时也检查封禁状态
        # 这里假设登录成功但访问被拒绝
        assert response.status_code in [200, 403]

    @pytest.mark.asyncio
    async def test_banned_user_access(
        self,
        client: AsyncClient,
        banned_user_tokens: dict,
    ):
        """测试被封禁用户访问"""
        response = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {banned_user_tokens['access_token']}"},
        )
        assert response.status_code == 403
        assert "banned" in response.json()["detail"].lower()
