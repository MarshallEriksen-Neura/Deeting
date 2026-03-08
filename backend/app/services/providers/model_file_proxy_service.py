from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http_client import create_async_http_client
from app.models.provider_instance import ProviderInstance
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.services.providers.routing_selector import RoutingCandidate, RoutingSelector
from app.services.providers.upstream_url import build_upstream_url
from app.services.secrets.manager import SecretManager
from app.utils.security import is_safe_upstream_url

_DEFAULT_FILE_UPLOAD_TIMEOUT_SECONDS = 120.0
_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024


@dataclass
class ModelFileProxyResult:
    status_code: int
    response_body: Any
    provider: str | None = None
    provider_model_id: str | None = None


class ModelFileProxyError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        source: str = "gateway",
        upstream_status: int | None = None,
        detail: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.source = source
        self.upstream_status = upstream_status
        self.detail = detail


class ModelFileProxyService:
    """模型文件上传透传服务（OpenAI-compatible /files）。"""

    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session
        self.secret_manager = SecretManager()
        self.instance_repo = ProviderInstanceRepository(db_session)
        self.model_repo = ProviderModelRepository(db_session)

    async def proxy_upload(
        self,
        *,
        channel: str,
        user_id: str | None,
        model: str | None,
        provider_model_id: str | None,
        form_fields: dict[str, str],
        filename: str,
        file_bytes: bytes,
        content_type: str | None,
        include_public: bool = True,
        allowed_providers: set[str] | None = None,
    ) -> ModelFileProxyResult:
        if not filename:
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="file filename is required",
                source="client",
            )
        if not file_bytes:
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="file content is empty",
                source="client",
            )
        if len(file_bytes) > _MAX_FILE_SIZE_BYTES:
            raise ModelFileProxyError(
                status_code=413,
                code="INVALID_REQUEST",
                message=f"file too large, max {_MAX_FILE_SIZE_BYTES} bytes",
                source="client",
            )
        if not model and not provider_model_id:
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="model or provider_model_id is required",
                source="client",
            )

        candidate = await self._select_candidate(
            channel=channel,
            user_id=user_id,
            model=model,
            provider_model_id=provider_model_id,
            include_public=include_public,
            allowed_providers=allowed_providers,
        )
        if model and provider_model_id:
            await self._validate_model_binding(provider_model_id, model)
        instance = await self._load_instance(candidate.instance_id)
        upload_url = self._build_files_url(candidate, instance)
        if not is_safe_upstream_url(upload_url):
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="unsafe upstream url",
                source="gateway",
            )
        headers = await self._build_headers(candidate)
        timeout = self._resolve_timeout_seconds(candidate.limit_config)
        data = dict(form_fields)
        data.setdefault("purpose", "assistants")

        files = {
            "file": (
                filename,
                file_bytes,
                content_type or "application/octet-stream",
            )
        }

        try:
            async with create_async_http_client(timeout=timeout, http2=True) as client:
                response = await client.post(
                    upload_url,
                    headers=headers,
                    data=data,
                    files=files,
                )
        except httpx.TimeoutException as exc:
            raise ModelFileProxyError(
                status_code=504,
                code="UPSTREAM_TIMEOUT",
                message=f"upstream timeout after {timeout}s",
                source="upstream",
            ) from exc
        except httpx.NetworkError as exc:
            raise ModelFileProxyError(
                status_code=502,
                code="UPSTREAM_ERROR",
                message=f"upstream network error: {exc}",
                source="upstream",
            ) from exc
        except Exception as exc:
            raise ModelFileProxyError(
                status_code=502,
                code="UPSTREAM_ERROR",
                message=f"upstream request failed: {exc}",
                source="upstream",
            ) from exc

        parsed = self._parse_response_body(response)
        if response.status_code >= 400:
            raise ModelFileProxyError(
                status_code=response.status_code,
                code="UPSTREAM_ERROR",
                message="upstream file upload failed",
                source="upstream",
                upstream_status=response.status_code,
                detail=parsed,
            )

        return ModelFileProxyResult(
            status_code=response.status_code,
            response_body=parsed,
            provider=candidate.provider,
            provider_model_id=candidate.model_id,
        )

    async def _select_candidate(
        self,
        *,
        channel: str,
        user_id: str | None,
        model: str | None,
        provider_model_id: str | None,
        include_public: bool,
        allowed_providers: set[str] | None,
    ) -> RoutingCandidate:
        selector = RoutingSelector(self.db_session)

        if provider_model_id:
            candidates = await selector.load_candidates_by_provider_model_id(
                provider_model_id=provider_model_id,
                capability="chat",
                channel=channel,
                user_id=user_id,
                include_public=include_public,
                allowed_providers=allowed_providers,
            )
        else:
            candidates = await selector.load_candidates(
                capability="chat",
                model=model or "",
                channel=channel,
                user_id=user_id,
                include_public=include_public,
                allowed_providers=allowed_providers,
            )

        if not candidates:
            raise ModelFileProxyError(
                status_code=404,
                code="MODEL_NOT_AVAILABLE",
                message="no available provider model for file upload",
                source="gateway",
            )

        selected, _, _ = await selector.choose(candidates, messages=None)
        return selected

    async def _load_instance(self, instance_id: str) -> ProviderInstance:
        try:
            instance_uuid = uuid.UUID(str(instance_id))
        except Exception as exc:
            raise ModelFileProxyError(
                status_code=500,
                code="GATEWAY_ERROR",
                message="invalid instance id selected by router",
                source="gateway",
            ) from exc

        instance = await self.instance_repo.get(instance_uuid)
        if not instance:
            raise ModelFileProxyError(
                status_code=404,
                code="MODEL_NOT_AVAILABLE",
                message="provider instance not found",
                source="gateway",
            )
        return instance

    async def _validate_model_binding(
        self, provider_model_id: str, requested_model: str
    ) -> None:
        try:
            model_uuid = uuid.UUID(str(provider_model_id))
        except Exception as exc:
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="invalid provider_model_id",
                source="client",
            ) from exc

        provider_model = await self.model_repo.get(model_uuid)
        if not provider_model:
            raise ModelFileProxyError(
                status_code=404,
                code="MODEL_NOT_AVAILABLE",
                message="provider model not found",
                source="gateway",
            )

        allowed_model_ids = {str(provider_model.model_id)}
        if provider_model.unified_model_id:
            allowed_model_ids.add(str(provider_model.unified_model_id))

        if requested_model not in allowed_model_ids:
            raise ModelFileProxyError(
                status_code=400,
                code="INVALID_REQUEST",
                message="model and provider_model_id do not match",
                source="client",
            )

    def _build_files_url(
        self, candidate: RoutingCandidate, instance: ProviderInstance
    ) -> str:
        meta = instance.meta or {}
        protocol = meta.get("protocol") or candidate.provider
        return build_upstream_url(
            base_url=instance.base_url or "",
            upstream_path="files",
            protocol=protocol,
            auto_append_v1=meta.get("auto_append_v1"),
        )

    async def _build_headers(self, candidate: RoutingCandidate) -> dict[str, str]:
        protocol_profile = candidate.protocol_profile or {}
        defaults = (
            protocol_profile.get("defaults")
            if isinstance(protocol_profile, dict)
            else {}
        ) or {}
        default_headers = (
            defaults.get("headers")
            if isinstance(defaults, dict)
            else {}
        ) or {}
        headers = {
            str(k): str(v)
            for k, v in default_headers.items()
            if v is not None
        }
        headers = {
            k: v
            for k, v in headers.items()
            if k.lower() not in {"content-type", "content-length"}
        }

        auth_type = (candidate.auth_type or "bearer").lower()
        auth_config = candidate.auth_config or {}
        provider = candidate.provider or auth_config.get("provider")
        secret_ref = auth_config.get("secret_ref_id") or auth_config.get("secret")
        secret = None
        if auth_type != "none":
            secret = await self.secret_manager.get(provider, secret_ref, self.db_session)
        if auth_type != "none" and not secret:
            raise ModelFileProxyError(
                status_code=502,
                code="UPSTREAM_AUTH_MISSING",
                message="upstream auth secret missing",
                source="upstream",
            )

        if auth_type == "api_key":
            header_name = str(auth_config.get("header") or "x-api-key")
            headers[header_name] = secret or ""
        elif auth_type == "basic":
            headers["Authorization"] = f"Basic {secret or ''}"
        elif auth_type == "none":
            pass
        else:
            headers["Authorization"] = f"Bearer {secret or ''}"

        return headers

    @staticmethod
    def _resolve_timeout_seconds(limit_config: dict[str, Any] | None) -> float:
        if not limit_config:
            return _DEFAULT_FILE_UPLOAD_TIMEOUT_SECONDS
        raw = limit_config.get("timeout")
        try:
            timeout = float(raw)
            if timeout > 0:
                return timeout
        except (TypeError, ValueError):
            pass
        return _DEFAULT_FILE_UPLOAD_TIMEOUT_SECONDS

    @staticmethod
    def _parse_response_body(response: httpx.Response) -> Any:
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            text = response.text
            return {"raw_text": text}
