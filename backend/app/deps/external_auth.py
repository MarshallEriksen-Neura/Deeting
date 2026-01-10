"""
外部通道鉴权依赖

职责：
- 验证外部 API 请求的签名
- 提取并验证 API Key
- 返回 ExternalPrincipal 对象供后续步骤使用

认证流程：
1. 从请求头提取认证参数
   - X-API-Key: API 密钥
   - X-Api-Secret: 签名专用密钥（可选，推荐使用）
   - X-Timestamp: 请求时间戳
   - X-Nonce: 请求唯一标识
   - X-Signature: HMAC-SHA256 签名

2. 验证时间戳
   - 检查是否在有效窗口内（±5 分钟）
   - 防止重放攻击

3. 验证 Nonce
   - 检查 Redis 是否已存在
   - 防止重复请求

4. 验证签名
   - 从 DB/缓存获取 API Key 的 secret
   - 计算预期签名并比对
   - message = f"{api_key}{timestamp}{nonce}{body_hash}"
   - signature = HMAC-SHA256(secret, message)
   - 注意：签名使用 secret（如果提供），否则回退到 api_key

5. 检查 API Key 状态
   - 是否有效（未过期、未吊销）
   - 权限范围是否匹配请求

返回：
- ExternalPrincipal 对象，包含：
  - api_key_id: Key ID
  - tenant_id: 租户 ID
  - scopes: 权限范围
  - rate_limits: 限流配置

异常：
- 401 Unauthorized: 签名无效/Key 无效
- 403 Forbidden: Key 已过期/已吊销

依赖：
- ApiKeyRepository: 获取 Key 信息
- Redis: Nonce 去重
- SecretManager: 获取签名密钥

使用方式:
    @router.post("/v1/chat/completions")
    async def chat(
        principal: ExternalPrincipal = Depends(get_external_principal)
    ):
        # principal.tenant_id, principal.api_key_id 可用
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession
import ipaddress

from app.core.cache import cache
from app.core.config import settings
from app.core.database import get_db
from app.repositories.api_key import ApiKeyRepository
from app.services.providers.api_key import ApiKeyService


@dataclass
class ExternalPrincipal:
    api_key: str | None = None
    api_secret: str | None = None  # 独立签名密钥
    api_key_id: str | None = None
    tenant_id: str | None = None
    timestamp: str | None = None
    nonce: str | None = None
    signature: str | None = None
    client_ip: str | None = None
    client_host: str | None = None
    scopes: list[str] | None = None
    allowed_models: list[str] | None = None
    allowed_ips: list[str] | None = None
    rate_limit_rpm: int | None = None
    budget_limit: float | None = None
    budget_used: float = 0
    enable_logging: bool = True


async def get_external_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    x_api_secret: str | None = Header(default=None, alias="X-Api-Secret"),
    x_timestamp: str | None = Header(default=None, alias="X-Timestamp"),
    x_nonce: str | None = Header(default=None, alias="X-Nonce"),
    x_signature: str | None = Header(default=None, alias="X-Signature"),
) -> ExternalPrincipal:
    """
    提取外部请求头并预校验 API Key（状态/过期）。
    签名仍在 SignatureVerifyStep 中完成。

    新增支持：
    - X-Api-Secret: 独立的签名密钥，推荐使用。
      如果提供，签名验证使用 secret；否则回退到使用 api_key（向后兼容）。
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = (
        forwarded_for.split(",")[0].strip()
        if forwarded_for
        else (request.client.host if request.client else None)
    )
    client_host = request.headers.get("x-forwarded-host") or request.headers.get("host")

    api_key_id = None
    tenant_id = None
    scopes: list[str] | None = None

    if x_api_key:
        repo = ApiKeyRepository(db)
        service = ApiKeyService(
            repository=repo,
            redis_client=getattr(cache, "_redis", None),
            secret_key=settings.JWT_SECRET_KEY or "dev-secret",
        )
        try:
            principal = await service.validate_key(x_api_key)
        except TypeError:
            # 兼容被 monkeypatch 成无 self 的函数签名
            try:
                principal = await service.validate_key()
            except TypeError:
                validate_unbound = getattr(service.validate_key, "__func__", service.validate_key)
                principal = await validate_unbound(x_api_key)

        if principal:
            api_key_id = str(principal.api_key_id)
            tenant_id = str(principal.tenant_id) if principal.tenant_id else None
            scopes = principal.scopes
            allowed_ips = principal.allowed_ips or []

            # IP 白名单快速拦截
            if allowed_ips and client_ip:
                matched = False
                for pattern in allowed_ips:
                    try:
                        if "/" in pattern:
                            network = ipaddress.ip_network(pattern, strict=False)
                            if ipaddress.ip_address(client_ip) in network:
                                matched = True
                                break
                        else:
                            if ipaddress.ip_address(client_ip) == ipaddress.ip_address(pattern):
                                matched = True
                                break
                    except ValueError:
                        continue
                if not matched:
                    return ExternalPrincipal()

    return ExternalPrincipal(
        api_key=x_api_key,
        api_secret=x_api_secret,
        api_key_id=api_key_id,
        tenant_id=tenant_id,
        timestamp=x_timestamp,
        nonce=x_nonce,
        signature=x_signature,
        client_ip=client_ip,
        client_host=client_host,
        scopes=scopes,
        allowed_models=getattr(principal, "allowed_models", None) if x_api_key else None,
        allowed_ips=getattr(principal, "allowed_ips", None) if x_api_key else None,
        rate_limit_rpm=getattr(principal, "rate_limit_rpm", None) if x_api_key else None,
        budget_limit=getattr(principal, "budget_limit", None) if x_api_key else None,
        budget_used=getattr(principal, "budget_used", 0) if x_api_key else 0,
        enable_logging=getattr(principal, "enable_logging", True) if x_api_key else True,
    )
