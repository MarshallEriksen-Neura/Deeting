from __future__ import annotations

import asyncio
import json
import secrets
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from app.core import cache
from app.utils.time_utils import Datetime

_CACHE_KEY_PREFIX = "code_mode:runtime_bridge"
_CONSUME_SCRIPT_NAME = "code_mode_bridge_consume"


@dataclass
class RuntimeBridgeClaims:
    user_id: str
    session_id: str
    trace_id: str | None = None
    tenant_id: str | None = None
    api_key_id: str | None = None
    capability: str | None = None
    requested_model: str | None = None
    scopes: list[str] = field(default_factory=list)
    allowed_models: list[str] = field(default_factory=list)
    max_calls: int = 8


@dataclass
class RuntimeBridgeIssueResult:
    token: str
    expires_at: str


class RuntimeBridgeTokenService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._memory_store: dict[str, dict[str, Any]] = {}
        self._context_store: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _cache_key(token: str) -> str:
        return f"{_CACHE_KEY_PREFIX}:{token}"

    async def issue_token(
        self,
        *,
        claims: RuntimeBridgeClaims,
        ttl_seconds: int,
    ) -> RuntimeBridgeIssueResult:
        ttl = max(1, int(ttl_seconds or 1))
        token = secrets.token_urlsafe(32)
        expires_at = Datetime.now() + timedelta(seconds=ttl)
        claims_payload = {
            "user_id": str(claims.user_id),
            "session_id": str(claims.session_id),
            "trace_id": claims.trace_id,
            "tenant_id": claims.tenant_id,
            "api_key_id": claims.api_key_id,
            "capability": claims.capability,
            "requested_model": claims.requested_model,
            "scopes": list(claims.scopes or []),
            "allowed_models": list(claims.allowed_models or []),
            "max_calls": max(1, int(claims.max_calls or 1)),
        }

        payload = {
            "claims": claims_payload,
            "used_calls": 0,
            "expires_at": expires_at.isoformat(),
        }
        full_key = cache._make_key(self._cache_key(token))
        redis_client = getattr(cache, "_redis", None)
        stored = False
        if redis_client:
            try:
                await redis_client.hset(
                    full_key,
                    mapping={
                        "claims_json": json.dumps(claims_payload, ensure_ascii=False),
                        "used_calls": "0",
                        "max_calls": str(claims_payload["max_calls"]),
                    },
                )
                await redis_client.expire(full_key, ttl)
                stored = True
            except Exception:
                stored = False

        if not stored:
            async with self._lock:
                self._memory_store[token] = payload

        return RuntimeBridgeIssueResult(token=token, expires_at=expires_at.isoformat())

    async def consume_call(self, token: str) -> dict[str, Any]:
        raw_token = (token or "").strip()
        if not raw_token:
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_MISSING_TOKEN",
                "error": "missing execution token",
            }

        redis_client = getattr(cache, "_redis", None)
        if redis_client:
            redis_result = await self._consume_call_redis(redis_client, raw_token)
            if redis_result is not None:
                return redis_result

        now = Datetime.now()
        async with self._lock:
            payload = self._memory_store.get(raw_token)

        if not isinstance(payload, dict):
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "error": "execution token not found",
            }

        expires_at_iso = str(payload.get("expires_at") or "")
        try:
            expires_at = Datetime.from_iso_string(expires_at_iso)
        except Exception:
            expires_at = now

        if expires_at <= now:
            async with self._lock:
                self._memory_store.pop(raw_token, None)
                self._prune_expired_locked(now)
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_TOKEN_EXPIRED",
                "error": "execution token expired",
            }

        claims_payload = payload.get("claims") if isinstance(payload.get("claims"), dict) else {}
        max_calls = max(1, int(claims_payload.get("max_calls") or 1))
        used_calls = int(payload.get("used_calls") or 0)
        if used_calls >= max_calls:
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_CALL_LIMIT",
                "error": f"runtime bridge call limit exceeded ({max_calls})",
                "max_calls": max_calls,
            }

        call_index = used_calls
        payload["used_calls"] = used_calls + 1
        async with self._lock:
            self._memory_store[raw_token] = payload

        claims = RuntimeBridgeClaims(
            user_id=str(claims_payload.get("user_id") or ""),
            session_id=str(claims_payload.get("session_id") or ""),
            trace_id=self._as_optional_str(claims_payload.get("trace_id")),
            tenant_id=self._as_optional_str(claims_payload.get("tenant_id")),
            api_key_id=self._as_optional_str(claims_payload.get("api_key_id")),
            capability=self._as_optional_str(claims_payload.get("capability")),
            requested_model=self._as_optional_str(claims_payload.get("requested_model")),
            scopes=[
                str(item)
                for item in (claims_payload.get("scopes") or [])
                if item is not None
            ],
            allowed_models=[
                str(item)
                for item in (claims_payload.get("allowed_models") or [])
                if item is not None
            ],
            max_calls=max_calls,
        )
        if not claims.user_id or not claims.session_id:
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "error": "execution token claims are incomplete",
            }

        return {
            "ok": True,
            "claims": claims,
            "call_index": call_index,
            "max_calls": max_calls,
            "expires_at": expires_at_iso,
        }

    async def _consume_call_redis(
        self,
        redis_client,
        token: str,
    ) -> dict[str, Any] | None:
        script_sha = cache.get_script_sha(_CONSUME_SCRIPT_NAME)
        if not script_sha:
            await cache.preload_scripts()
            script_sha = cache.get_script_sha(_CONSUME_SCRIPT_NAME)
        if not script_sha:
            return None

        full_key = cache._make_key(self._cache_key(token))
        try:
            result = await redis_client.evalsha(script_sha, 1, full_key)
        except Exception:
            return None

        if not isinstance(result, (list, tuple)) or len(result) < 6:
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "error": "invalid bridge token script result",
            }

        ok = int(self._as_int(result[0], 0)) == 1
        code = self._as_str(result[1]) or "UNKNOWN"
        call_index = self._as_int(result[2], 0)
        max_calls = max(1, self._as_int(result[3], 1))
        claims_json = self._as_str(result[4])
        ttl_seconds = self._as_int(result[5], 0)

        claims = self._claims_from_json(claims_json, max_calls=max_calls)
        if claims is None:
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "error": "execution token claims are incomplete",
            }

        expires_at = (
            Datetime.now() + timedelta(seconds=max(0, ttl_seconds))
        ).isoformat()

        if ok:
            return {
                "ok": True,
                "claims": claims,
                "call_index": call_index,
                "max_calls": max_calls,
                "expires_at": expires_at,
            }
        if code == "CALL_LIMIT":
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_CALL_LIMIT",
                "error": f"runtime bridge call limit exceeded ({max_calls})",
                "max_calls": max_calls,
            }
        if code == "NOT_FOUND":
            return {
                "ok": False,
                "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
                "error": "execution token not found",
            }
        return {
            "ok": False,
            "error_code": "CODE_MODE_BRIDGE_INVALID_TOKEN",
            "error": f"execution token check failed: {code}",
        }

    def _claims_from_json(
        self,
        claims_json: str | None,
        *,
        max_calls: int,
    ) -> RuntimeBridgeClaims | None:
        if not claims_json:
            return None
        try:
            payload = json.loads(claims_json)
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None

        claims = RuntimeBridgeClaims(
            user_id=str(payload.get("user_id") or ""),
            session_id=str(payload.get("session_id") or ""),
            trace_id=self._as_optional_str(payload.get("trace_id")),
            tenant_id=self._as_optional_str(payload.get("tenant_id")),
            api_key_id=self._as_optional_str(payload.get("api_key_id")),
            capability=self._as_optional_str(payload.get("capability")),
            requested_model=self._as_optional_str(payload.get("requested_model")),
            scopes=[str(item) for item in (payload.get("scopes") or []) if item is not None],
            allowed_models=[
                str(item) for item in (payload.get("allowed_models") or []) if item is not None
            ],
            max_calls=max_calls,
        )
        if not claims.user_id or not claims.session_id:
            return None
        return claims

    def _prune_expired_locked(self, now) -> None:
        expired: list[str] = []
        for token, payload in self._memory_store.items():
            if not isinstance(payload, dict):
                expired.append(token)
                continue
            expires_at_iso = str(payload.get("expires_at") or "")
            try:
                expires_at = Datetime.from_iso_string(expires_at_iso)
            except Exception:
                expired.append(token)
                continue
            if expires_at <= now:
                expired.append(token)
        for token in expired:
            self._memory_store.pop(token, None)
            self._context_store.pop(token, None)

    async def store_context(self, token: str, context: dict[str, Any]) -> None:
        """Store runtime context data alongside a bridge token for lazy retrieval."""
        raw_token = (token or "").strip()
        if not raw_token or not isinstance(context, dict):
            return
        redis_client = getattr(cache, "_redis", None)
        if redis_client:
            try:
                ctx_key = cache._make_key(f"{_CACHE_KEY_PREFIX}:ctx:{raw_token}")
                await redis_client.set(
                    ctx_key,
                    json.dumps(context, ensure_ascii=False),
                )
                ttl = await redis_client.ttl(cache._make_key(self._cache_key(raw_token)))
                if ttl and ttl > 0:
                    await redis_client.expire(ctx_key, ttl)
                return
            except Exception:
                pass
        async with self._lock:
            self._context_store[raw_token] = context

    async def retrieve_context(self, token: str) -> dict[str, Any] | None:
        """Retrieve stored runtime context for a bridge token."""
        raw_token = (token or "").strip()
        if not raw_token:
            return None
        redis_client = getattr(cache, "_redis", None)
        if redis_client:
            try:
                ctx_key = cache._make_key(f"{_CACHE_KEY_PREFIX}:ctx:{raw_token}")
                raw = await redis_client.get(ctx_key)
                if raw:
                    data = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
        async with self._lock:
            ctx = self._context_store.get(raw_token)
        if isinstance(ctx, dict):
            return ctx
        return None

    @staticmethod
    def _as_optional_str(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _as_int(value: Any, default: int) -> int:
        try:
            if isinstance(value, bytes):
                value = value.decode("utf-8")
            return int(value)
        except Exception:
            return default

    @staticmethod
    def _as_str(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            try:
                return value.decode("utf-8")
            except Exception:
                return ""
        return str(value)


runtime_bridge_token_service = RuntimeBridgeTokenService()
