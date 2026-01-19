from __future__ import annotations

import base64
import hashlib
import hmac
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def build_prompt_hash(prompt: str, negative_prompt: str | None = None) -> str:
    secret = (settings.SECRET_KEY or "").encode("utf-8")
    message = prompt or ""
    if negative_prompt:
        message = f"{message}\nNEGATIVE:{negative_prompt}"
    digest = hmac.new(secret, message.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest


class PromptCipher:
    def __init__(self, secret_key: str | None = None) -> None:
        self._secret_key = (secret_key or settings.SECRET_KEY or "").strip()
        self._fernet: Fernet | None = None

    def _get_fernet(self) -> Fernet:
        if self._fernet:
            return self._fernet
        if not self._secret_key:
            raise RuntimeError("SECRET_KEY not configured")
        digest = hashlib.sha256(self._secret_key.encode("utf-8")).digest()
        fernet_key = base64.urlsafe_b64encode(digest)
        self._fernet = Fernet(fernet_key)
        return self._fernet

    def encrypt(self, value: str) -> Optional[str]:
        if not value:
            return None
        try:
            fernet = self._get_fernet()
        except RuntimeError:
            return None
        return fernet.encrypt(value.encode("utf-8")).decode("utf-8")

    def decrypt(self, token: str) -> Optional[str]:
        if not token:
            return None
        try:
            fernet = self._get_fernet()
        except RuntimeError:
            return None
        try:
            return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            return None


__all__ = ["PromptCipher", "build_prompt_hash"]
