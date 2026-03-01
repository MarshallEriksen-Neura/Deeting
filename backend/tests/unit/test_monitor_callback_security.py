from __future__ import annotations

import time

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.monitor_route import (
    _build_feishu_signature_candidates,
    _verify_feishu_callback_signature,
)
from app.core.cache import cache
from app.core.config import settings


def _build_request(headers: dict[str, str], body: bytes) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/monitors/feishu/callback",
        "headers": [(k.lower().encode("utf-8"), v.encode("utf-8")) for k, v in headers.items()],
    }

    received = False

    async def receive():
        nonlocal received
        if received:
            return {"type": "http.request", "body": b"", "more_body": False}
        received = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


@pytest.mark.asyncio
async def test_verify_feishu_callback_signature_accepts_valid_signature(monkeypatch: pytest.MonkeyPatch):
    raw_body = b'{"event":"monitor"}'
    timestamp = str(int(time.time()))
    nonce = "nonce-test-1"
    secret = "secret-test-value"
    signature = next(
        iter(
            _build_feishu_signature_candidates(
                secret=secret,
                timestamp=timestamp,
                nonce=nonce,
                body_text=raw_body.decode("utf-8"),
            )
        )
    )
    request = _build_request(
        {
            "X-Lark-Request-Timestamp": timestamp,
            "X-Lark-Request-Nonce": nonce,
            "X-Lark-Signature": signature,
        },
        raw_body,
    )

    async def _cache_set(*args, **kwargs):
        return True

    monkeypatch.setattr(settings, "FEISHU_CALLBACK_SECRET", secret, raising=False)
    monkeypatch.setattr(settings, "FEISHU_CALLBACK_MAX_SKEW_SECONDS", 300, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)

    await _verify_feishu_callback_signature(request, raw_body)


@pytest.mark.asyncio
async def test_verify_feishu_callback_signature_blocks_replay(monkeypatch: pytest.MonkeyPatch):
    raw_body = b'{"event":"monitor"}'
    timestamp = str(int(time.time()))
    nonce = "nonce-test-2"
    secret = "secret-test-value"
    signature = next(
        iter(
            _build_feishu_signature_candidates(
                secret=secret,
                timestamp=timestamp,
                nonce=nonce,
                body_text=raw_body.decode("utf-8"),
            )
        )
    )
    request = _build_request(
        {
            "X-Lark-Request-Timestamp": timestamp,
            "X-Lark-Request-Nonce": nonce,
            "X-Lark-Signature": signature,
        },
        raw_body,
    )

    async def _cache_set(*args, **kwargs):
        return False

    monkeypatch.setattr(settings, "FEISHU_CALLBACK_SECRET", secret, raising=False)
    monkeypatch.setattr(settings, "FEISHU_CALLBACK_MAX_SKEW_SECONDS", 300, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)
    monkeypatch.setattr(cache, "_redis", object())

    with pytest.raises(HTTPException) as exc_info:
        await _verify_feishu_callback_signature(request, raw_body)
    assert exc_info.value.status_code == 401
    assert "replay" in str(exc_info.value.detail).lower()


@pytest.mark.asyncio
async def test_verify_feishu_callback_signature_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch):
    raw_body = b'{"event":"monitor"}'
    timestamp = str(int(time.time()))
    nonce = "nonce-test-3"
    secret = "secret-test-value"
    request = _build_request(
        {
            "X-Lark-Request-Timestamp": timestamp,
            "X-Lark-Request-Nonce": nonce,
            "X-Lark-Signature": "invalid-signature",
        },
        raw_body,
    )

    async def _cache_set(*args, **kwargs):
        return True

    monkeypatch.setattr(settings, "FEISHU_CALLBACK_SECRET", secret, raising=False)
    monkeypatch.setattr(settings, "FEISHU_CALLBACK_MAX_SKEW_SECONDS", 300, raising=False)
    monkeypatch.setattr(cache, "set", _cache_set)

    with pytest.raises(HTTPException) as exc_info:
        await _verify_feishu_callback_signature(request, raw_body)
    assert exc_info.value.status_code == 401
    assert "signature" in str(exc_info.value.detail).lower()
