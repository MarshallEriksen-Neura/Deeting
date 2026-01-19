import pytest

from app.core.config import settings
from app.services.image_generation.prompt_security import PromptCipher, build_prompt_hash


def test_build_prompt_hash_changes_with_negative(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    base = build_prompt_hash("hello")
    with_neg = build_prompt_hash("hello", "no cats")
    assert base != with_neg


def test_prompt_cipher_encrypt_decrypt(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "secret")
    cipher = PromptCipher()
    token = cipher.encrypt("hello world")
    assert token
    assert cipher.decrypt(token) == "hello world"


def test_prompt_cipher_missing_secret(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "")
    cipher = PromptCipher()
    assert cipher.encrypt("hello") is None
