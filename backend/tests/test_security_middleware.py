"""
安全中间件测试
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.responses import PlainTextResponse

from app.middleware.security_headers import SecurityHeadersMiddleware
from app.middleware.request_validator import RequestValidatorMiddleware


@pytest.fixture
def app_with_security_headers():
    """创建带有安全头中间件的测试应用"""
    app = FastAPI()

    @app.get("/test")
    async def test_endpoint():
        return {"message": "ok"}

    app.add_middleware(SecurityHeadersMiddleware, enable_hsts=False)

    return app


@pytest.fixture
def app_with_request_validator():
    """创建带有请求验证中间件的测试应用"""
    app = FastAPI()

    @app.get("/test")
    async def test_endpoint():
        return {"message": "ok"}

    app.add_middleware(
        RequestValidatorMiddleware,
        enable_sql_injection_check=True,
        enable_xss_check=True,
        enable_path_traversal_check=True,
        enable_command_injection_check=True,
        log_suspicious_requests=False,  # 测试中禁用日志
    )

    return app


def test_security_headers_added(app_with_security_headers):
    """测试安全头是否被添加到响应中"""
    client = TestClient(app_with_security_headers)
    response = client.get("/test")

    assert response.status_code == 200
    assert "X-Content-Type-Options" in response.headers
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "X-Frame-Options" in response.headers
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "X-XSS-Protection" in response.headers
    assert "Content-Security-Policy" in response.headers
    assert "Referrer-Policy" in response.headers
    assert "Permissions-Policy" in response.headers


def test_hsts_not_enabled_in_dev(app_with_security_headers):
    """测试开发环境中HSTS是否未启用"""
    client = TestClient(app_with_security_headers)
    response = client.get("/test")

    assert "Strict-Transport-Security" not in response.headers


def test_sql_injection_blocked(app_with_request_validator):
    """测试SQL注入是否被阻止"""
    client = TestClient(app_with_request_validator)

    # 测试SQL注入
    response = client.get("/test?id=1' OR '1'='1")
    assert response.status_code == 403
    assert response.json()["reason"] == "sql_injection_in_query"


def test_xss_blocked(app_with_request_validator):
    """测试XSS攻击是否被阻止"""
    client = TestClient(app_with_request_validator)

    # 测试XSS
    response = client.get("/test", params={"script": "<script>alert(XSS)</script>"})
    assert response.status_code == 403
    assert response.json()["reason"] == "xss_in_query"


def test_path_traversal_blocked(app_with_request_validator):
    """测试路径遍历是否被阻止"""
    client = TestClient(app_with_request_validator)

    # 测试路径遍历
    response = client.get("/test?path=../../../etc/passwd")
    assert response.status_code == 403
    assert response.json()["reason"] == "path_traversal_in_query"


def test_command_injection_blocked(app_with_request_validator):
    """测试命令注入是否被阻止"""
    client = TestClient(app_with_request_validator)

    # 测试命令注入
    response = client.get("/test?cmd=echo hello; rm -rf /")
    assert response.status_code == 403
    assert response.json()["reason"] == "command_injection_in_query"


def test_normal_request_allowed(app_with_request_validator):
    """测试正常请求是否被允许"""
    client = TestClient(app_with_request_validator)

    # 测试正常请求
    response = client.get("/test?param=value")
    assert response.status_code == 200
    assert response.json() == {"message": "ok"}


def test_suspicious_user_agent_blocked(app_with_request_validator):
    """测试可疑User-Agent是否被阻止"""
    client = TestClient(app_with_request_validator)

    # 测试可疑的扫描工具User-Agent
    response = client.get("/test", headers={"User-Agent": "sqlmap/1.0"})
    assert response.status_code == 403
    assert response.json()["reason"] == "suspicious_user_agent"


def test_safe_user_agent_allowed(app_with_request_validator):
    """测试正常的User-Agent是否被允许"""
    client = TestClient(app_with_request_validator)

    # 测试正常的User-Agent
    response = client.get("/test", headers={"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"})
    assert response.status_code == 200
    assert response.json() == {"message": "ok"}