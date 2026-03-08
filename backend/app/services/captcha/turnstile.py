"""Cloudflare Turnstile CAPTCHA 校验服务"""

from __future__ import annotations

from app.core.config import settings
from app.core.http_client import create_async_http_client
from app.core.logging import logger

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile_token(
    token: str, client_ip: str | None = None
) -> bool:
    """
    向 Cloudflare 校验 Turnstile token。

    开发/测试环境自动跳过校验以方便本地调试。
    """
    if settings.ENVIRONMENT.lower() in {"test", "development"}:
        logger.debug("turnstile_skip_dev", extra={"env": settings.ENVIRONMENT})
        return True

    secret = settings.TURNSTILE_SECRET_KEY
    if not secret:
        logger.warning("turnstile_secret_not_configured")
        return False

    payload = {"secret": secret, "response": token}
    if client_ip:
        payload["remoteip"] = client_ip

    try:
        async with create_async_http_client(timeout=10.0) as client:
            resp = await client.post(SITEVERIFY_URL, data=payload)
            resp.raise_for_status()
            result = resp.json()
    except Exception:
        logger.exception("turnstile_verify_request_failed")
        return False

    success = result.get("success", False)
    if not success:
        logger.warning(
            "turnstile_verify_failed",
            extra={"error_codes": result.get("error-codes", [])},
        )
    return success
