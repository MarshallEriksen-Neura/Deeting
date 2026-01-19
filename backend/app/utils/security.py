"""
安全工具模块：密码哈希、JWT 编解码、验证码生成、SSRF 检测
"""
import ipaddress
import logging
import re
import secrets
import socket
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.utils.time_utils import Datetime

# SQL 注入常用关键字正则
SQL_INJECTION_PATTERN = re.compile(
    r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION|TRUNCATE|EXEC|EXECUTE)\b)|"
    r"(;|--|\'|\")",
    re.IGNORECASE
)

# Prompt 注入常用攻击模式（简化版）
PROMPT_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(.*)?\s*instructions", re.IGNORECASE),
    re.compile(r"system prompt:", re.IGNORECASE),
    re.compile(r"you are now a", re.IGNORECASE),
    re.compile(r"stay in character", re.IGNORECASE),
]

logger = logging.getLogger(__name__)


def get_password_hash(password: str) -> str:
    """生成密码的 bcrypt 哈希值"""
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证明文密码与哈希值是否匹配"""
    password_bytes = plain_password.encode('utf-8')
    hashed_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hashed_bytes)

def _load_private_key() -> str:
    """加载 RSA 私钥"""
    key_path = Path(settings.JWT_PRIVATE_KEY_PATH)
    if not key_path.is_absolute():
        key_path = Path(__file__).parent.parent.parent / key_path
    return key_path.read_text()

def _load_public_key() -> str:
    """加载 RSA 公钥"""
    key_path = Path(settings.JWT_PUBLIC_KEY_PATH)
    if not key_path.is_absolute():
        key_path = Path(__file__).parent.parent.parent / key_path
    return key_path.read_text()

def create_access_token(user_id: UUID, jti: str, version: int) -> str:
    """创建 access token (短期，用于 API 访问，携带 token_version 便于失效校验)"""
    expire = Datetime.now() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "access",
        "version": version,
        "exp": expire,
        "iat": Datetime.now(),
    }
    return jwt.encode(payload, _load_private_key(), algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(user_id: UUID, jti: str, version: int) -> str:
    """创建 refresh token (长期，用于刷新 access token)"""
    expire = Datetime.now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "refresh",
        "version": version,
        "exp": expire,
        "iat": Datetime.now(),
    }
    return jwt.encode(payload, _load_private_key(), algorithm=settings.JWT_ALGORITHM)

def decode_token(token: str) -> dict[str, Any]:
    """解码并验证 JWT token，返回 payload"""
    try:
        payload = jwt.decode(token, _load_public_key(), algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}") from e

def generate_verification_code(length: int = 6) -> str:
    """生成数字验证码（用于激活、密码重置等）"""
    return "".join(secrets.choice("0123456789") for _ in range(length))

def generate_jti() -> str:
    """生成唯一的 JWT ID"""
    return secrets.token_urlsafe(32)


def is_potential_sql_injection(content: str) -> bool:
    """检测内容是否包含潜在的 SQL 注入攻击"""
    if not content:
        return False
    return bool(SQL_INJECTION_PATTERN.search(content))


def is_potential_prompt_injection(content: str) -> bool:
    """检测内容是否包含潜在的 Prompt 注入攻击"""
    if not content:
        return False
    for pattern in PROMPT_INJECTION_PATTERNS:
        if pattern.search(content):
            return True
    return False


def _normalize_list(value: list[str] | str | None) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return value
    return [item.strip() for item in str(value).split(",") if item.strip()]


def is_hostname_whitelisted(hostname: str, whitelist: list[str] | str | None = None) -> bool:
    """检查主机名是否在白名单中（支持 *.domain.com 通配）"""
    if not hostname:
        return False
    entries = _normalize_list(whitelist if whitelist is not None else settings.OUTBOUND_WHITELIST)
    if not entries:
        return False

    host = hostname.lower().strip()
    for allowed in entries:
        allowed = allowed.lower().strip()
        if not allowed:
            continue
        if allowed.startswith("*."):
            suffix = allowed[1:]  # .domain.com
            if host.endswith(suffix) or host == allowed[2:]:
                return True
        elif host == allowed:
            return True
    return False


def is_safe_upstream_url(url: str) -> bool:
    """
    严谨的 SSRF 检查函数：
    1) 只允许 http/https
    2) 命中系统白名单直接放行
    3) 非白名单需满足自定义上游策略与内网阻断策略
    """
    if not url:
        return False

    try:
        parsed = urlparse(url)
    except Exception as exc:
        logger.warning("SSRF: invalid url format err=%s", exc)
        return False

    if parsed.scheme not in ("http", "https"):
        logger.warning("SSRF: blocked invalid scheme=%s", parsed.scheme)
        return False

    hostname = parsed.hostname
    if not hostname:
        logger.warning("SSRF: missing hostname url=%s", url)
        return False

    if is_hostname_whitelisted(hostname, settings.OUTBOUND_WHITELIST):
        return True

    if not settings.ALLOW_CUSTOM_UPSTREAM:
        logger.warning("SSRF: custom upstream disabled host=%s", hostname)
        return False

    if settings.ALLOW_INTERNAL_NETWORKS:
        return True

    blocked_subnets = _normalize_list(settings.BLOCKED_SUBNETS)
    networks = []
    for cidr in blocked_subnets:
        try:
            networks.append(ipaddress.ip_network(cidr, strict=False))
        except ValueError as exc:
            logger.warning("SSRF: invalid blocked subnet=%s err=%s", cidr, exc)

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip:
        for network in networks:
            if ip in network:
                logger.critical("SSRF ALERT: blocked direct ip=%s", hostname)
                return False
        return True

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addr_info = socket.getaddrinfo(hostname, port)
    except OSError as exc:
        logger.warning("SSRF: dns resolution failed host=%s err=%s", hostname, exc)
        return False

    for _, _, _, _, sockaddr in addr_info:
        ip_str = sockaddr[0]
        try:
            resolved = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        for network in networks:
            if resolved in network:
                logger.critical(
                    "SSRF ALERT: blocked host=%s ip=%s",
                    hostname,
                    ip_str,
                )
                return False

    return True
