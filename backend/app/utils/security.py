"""
安全工具模块：密码哈希、JWT 编解码、验证码生成
"""
import re
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

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
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "access",
        "version": version,
        "exp": expire,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, _load_private_key(), algorithm=settings.JWT_ALGORITHM)

def create_refresh_token(user_id: UUID, jti: str, version: int) -> str:
    """创建 refresh token (长期，用于刷新 access token)"""
    expire = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "jti": jti,
        "type": "refresh",
        "version": version,
        "exp": expire,
        "iat": datetime.now(UTC),
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
