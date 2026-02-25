from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client
from app.models.provider_instance import ProviderInstance, ProviderModel
from app.repositories.provider_credential_repository import ProviderCredentialRepository
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.services.providers.auth_resolver import resolve_auth_for_protocol
from app.services.providers.upstream_url import build_upstream_url_with_params
from app.services.secrets.manager import SecretManager
from app.services.system import get_cached_embedding_model


@dataclass(frozen=True)
class _EmbeddingRuntime:
    model: str
    protocol: str
    url: str
    params: dict[str, Any]
    headers: dict[str, str]


# TODO: Duplicate implementation exists; consider consolidating embedding services.
class EmbeddingService:
    """
    Service to generate embeddings using OpenAI (or configured provider).
    Supports dynamic configuration injection.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        """
        Initialize with optional dynamic config.
        config: {
            "api_key": "sk-...",
            "base_url": "https://...",
            "model": "text-embedding-3-small"
        }
        """
        config = config or {}

        # Explicit runtime config (optional): still supported for task-level overrides.
        self.api_key = str(config.get("api_key") or "").strip() or None
        self.base_url = str(config.get("base_url") or "").strip() or None
        self.protocol = str(config.get("protocol") or "openai").strip().lower()
        self.upstream_path = str(config.get("upstream_path") or "embeddings").strip()
        self.auth_type = str(config.get("auth_type") or "").strip() or None
        auth_config = config.get("auth_config")
        self.auth_config = auth_config if isinstance(auth_config, dict) else {}
        default_headers = config.get("default_headers")
        self.default_headers = (
            {str(k): str(v) for k, v in default_headers.items()}
            if isinstance(default_headers, dict)
            else {}
        )
        self.api_version = str(config.get("api_version") or "").strip() or None

        # Model: Config > Cache > Settings (Default)
        explicit_model = config.get("model")
        if isinstance(explicit_model, str):
            explicit_model = explicit_model.strip()
        else:
            explicit_model = None
        self._model_explicit = bool(explicit_model)
        self.model = explicit_model or None
        configured_vector_size = config.get(
            "vector_size", getattr(settings, "EMBEDDING_VECTOR_SIZE", None)
        )
        self._vector_size = self._to_positive_int(configured_vector_size)
        self._runtime: _EmbeddingRuntime | None = None
        self._runtime_lock = asyncio.Lock()
        self._secret_manager = SecretManager()

    @staticmethod
    def _to_positive_int(value: Any) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    async def _resolve_model(self):
        # Explicit model from runtime config should always win.
        if self._model_explicit:
            return

        cached = await get_cached_embedding_model()
        if cached:
            self.model = cached

    async def _ensure_runtime(self) -> _EmbeddingRuntime:
        if self._runtime is not None:
            return self._runtime

        async with self._runtime_lock:
            if self._runtime is not None:
                return self._runtime

            await self._resolve_model()
            model = self._require_model()

            if self.api_key and self.base_url:
                runtime = self._build_explicit_runtime(model)
            else:
                runtime = await self._resolve_runtime_from_provider(model)
            self._runtime = runtime
            return runtime

    def _require_model(self) -> str:
        model = str(self.model or "").strip()
        if not model:
            raise RuntimeError(
                "embedding model is not configured; set it via /admin/settings/embedding"
            )
        return model

    async def embed_text(self, text: str) -> list[float]:
        """
        Embed a single string.
        """
        runtime = await self._ensure_runtime()
        vectors = await self._request_embeddings(runtime, [text])
        if not vectors:
            raise RuntimeError("embedding provider returned empty embedding")
        embedding = vectors[0]
        if isinstance(embedding, list) and embedding:
            self._vector_size = len(embedding)
        return embedding

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Embed multiple strings.
        """
        if not texts:
            return []
        runtime = await self._ensure_runtime()
        embeddings = await self._request_embeddings(runtime, texts)
        if embeddings and isinstance(embeddings[0], list) and embeddings[0]:
            self._vector_size = len(embeddings[0])
        return embeddings

    async def get_vector_size(self) -> int:
        if self._vector_size:
            return self._vector_size

        embedding = await self.embed_text("vector_size_probe")
        size = len(embedding)
        if size <= 0:
            raise RuntimeError("embedding provider returned empty embedding")
        self._vector_size = size
        return size

    def _build_explicit_runtime(self, model: str) -> _EmbeddingRuntime:
        if not self.base_url or not self.api_key:
            raise RuntimeError("explicit embedding runtime requires api_key and base_url")

        url, params = build_upstream_url_with_params(
            base_url=self.base_url,
            upstream_path=self.upstream_path or "embeddings",
            protocol=self.protocol,
            auto_append_v1=None,
            api_version=self.api_version,
        )
        auth_type, auth_config, resolved_headers = resolve_auth_for_protocol(
            protocol=self.protocol,
            provider="custom",
            auth_type=self.auth_type,
            auth_config=self.auth_config,
            default_headers=self.default_headers,
        )
        headers = {"Content-Type": "application/json"}
        headers.update(resolved_headers)
        self._apply_auth_headers(
            headers=headers,
            auth_type=auth_type,
            auth_config=auth_config,
            secret=self.api_key,
        )
        return _EmbeddingRuntime(
            model=model,
            protocol=self.protocol,
            url=url,
            params=params,
            headers=headers,
        )

    async def _resolve_runtime_from_provider(self, model: str) -> _EmbeddingRuntime:
        async with AsyncSessionLocal() as session:
            model_repo = ProviderModelRepository(session)
            candidates = await model_repo.get_candidates(
                capability="embedding",
                model_id=model,
                user_id=None,
                include_public=True,
            )
            if not candidates:
                raise RuntimeError(
                    f"embedding provider model not found for model_id='{model}'"
                )

            selected = self._select_candidate(candidates)
            instance_repo = ProviderInstanceRepository(session)
            instance = await instance_repo.get(selected.instance_id)
            if not instance or not instance.is_enabled:
                raise RuntimeError(
                    f"embedding provider instance unavailable for model_id='{model}'"
                )

            preset_repo = ProviderPresetRepository(session)
            preset = await preset_repo.get_by_slug(instance.preset_slug)
            if not preset or not preset.is_active:
                raise RuntimeError(
                    f"embedding provider preset unavailable for model_id='{model}'"
                )

            secret = await self._resolve_instance_secret(session, preset, instance)
            if not secret:
                raise RuntimeError(
                    f"embedding provider secret missing for model_id='{model}'"
                )

            protocol = self._resolve_protocol(instance, preset.provider)
            base_url = self._normalize_base_url(preset, instance)
            if not base_url:
                raise RuntimeError(
                    f"embedding provider base_url missing for model_id='{model}'"
                )

            upstream_path = str(selected.upstream_path or "").strip() or "embeddings"
            meta = instance.meta or {}
            url, params = build_upstream_url_with_params(
                base_url=base_url,
                upstream_path=upstream_path,
                protocol=protocol,
                auto_append_v1=meta.get("auto_append_v1"),
                api_version=meta.get("api_version"),
            )
            auth_type, auth_config, resolved_headers = resolve_auth_for_protocol(
                protocol=meta.get("protocol"),
                provider=preset.provider,
                auth_type=preset.auth_type,
                auth_config=preset.auth_config,
                default_headers=preset.default_headers,
            )
            headers = {"Content-Type": "application/json"}
            headers.update(resolved_headers)
            self._apply_auth_headers(
                headers=headers,
                auth_type=auth_type,
                auth_config=auth_config,
                secret=secret,
            )
            if "anthropic" in protocol and "anthropic-version" not in headers:
                headers["anthropic-version"] = "2023-06-01"

            return _EmbeddingRuntime(
                model=model,
                protocol=protocol,
                url=url,
                params=params,
                headers=headers,
            )

    @staticmethod
    def _select_candidate(candidates: list[ProviderModel]) -> ProviderModel:
        return sorted(
            candidates,
            key=lambda m: (
                int(getattr(m, "priority", 0) or 0),
                int(getattr(m, "weight", 0) or 0),
                str(getattr(m, "id", "")),
            ),
            reverse=True,
        )[0]

    async def _resolve_instance_secret(
        self,
        session,
        preset,
        instance: ProviderInstance,
    ) -> str | None:
        secret_ref = instance.credentials_ref or getattr(preset, "auth_config", {}).get(
            "secret_ref_id"
        )
        if secret_ref and not str(secret_ref).startswith("db:"):
            credential_repo = ProviderCredentialRepository(session)
            grouped = await credential_repo.get_by_instance_ids([str(instance.id)])
            for cred in grouped.get(str(instance.id), []):
                if cred.alias == secret_ref and cred.is_active:
                    secret_ref = cred.secret_ref_id
                    break
        provider = getattr(preset, "provider", None)
        return await self._secret_manager.get(provider, secret_ref, session)

    @staticmethod
    def _resolve_protocol(instance: ProviderInstance, preset_provider: str | None) -> str:
        meta = instance.meta or {}
        protocol = str(meta.get("protocol") or preset_provider or "openai").strip().lower()
        return protocol or "openai"

    @staticmethod
    def _normalize_base_url(preset, instance: ProviderInstance) -> str:
        base = instance.base_url or getattr(preset, "base_url", "")
        tpl = getattr(preset, "url_template", None)
        meta = getattr(instance, "meta", {}) or {}
        resource_name = (
            meta.get("resource_name")
            or meta.get("resource")
            or meta.get("deployment_name")
        )
        if tpl and "{resource}" in tpl and resource_name:
            base = tpl.replace("{resource}", str(resource_name))
        return str(base or "").rstrip("/")

    @staticmethod
    def _apply_auth_headers(
        *,
        headers: dict[str, str],
        auth_type: str | None,
        auth_config: dict[str, Any] | None,
        secret: str,
    ) -> None:
        at = str(auth_type or "bearer").strip().lower()
        config = auth_config if isinstance(auth_config, dict) else {}
        if at == "none":
            return
        if at == "api_key":
            header_name = str(config.get("header") or "x-api-key")
            headers[header_name] = secret
            return
        if at == "basic":
            headers["Authorization"] = f"Basic {secret}"
            return
        headers["Authorization"] = f"Bearer {secret}"

    async def _request_embeddings(
        self,
        runtime: _EmbeddingRuntime,
        texts: list[str],
    ) -> list[list[float]]:
        if not texts:
            return []

        if self._is_gemini_like(runtime.protocol) and len(texts) > 1:
            vectors: list[list[float]] = []
            for text in texts:
                vectors.extend(await self._request_embeddings(runtime, [text]))
            return vectors

        payload = self._build_payload(runtime, texts)
        data = await self._post_embeddings_request(runtime, payload)
        vectors = self._extract_vectors(data)
        if not vectors:
            raise RuntimeError("embedding provider returned no vectors")
        return vectors

    async def _post_embeddings_request(
        self,
        runtime: _EmbeddingRuntime,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        timeout_seconds = float(
            getattr(settings, "QDRANT_TIMEOUT_SECONDS", 10.0) or 10.0
        )
        async with create_async_http_client(timeout=timeout_seconds) as client:
            response = await client.post(
                runtime.url,
                params=runtime.params or None,
                headers=runtime.headers,
                json=payload,
            )
        if response.status_code >= 400:
            body_preview = (response.text or "")[:300]
            raise RuntimeError(
                f"embedding upstream error status={response.status_code} body={body_preview}"
            )
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("embedding upstream invalid json payload")
        return data

    def _build_payload(self, runtime: _EmbeddingRuntime, texts: list[str]) -> dict[str, Any]:
        if self._is_gemini_like(runtime.protocol):
            text = texts[0]
            return {
                "content": {
                    "parts": [{"text": text}],
                }
            }
        if len(texts) == 1:
            return {"model": runtime.model, "input": texts[0]}
        return {"model": runtime.model, "input": texts}

    @staticmethod
    def _extract_vectors(payload: dict[str, Any]) -> list[list[float]]:
        vectors: list[list[float]] = []

        data = payload.get("data")
        if isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                embedding = item.get("embedding")
                if isinstance(embedding, list) and embedding:
                    vectors.append([float(v) for v in embedding])
            if vectors:
                return vectors

        embedding = payload.get("embedding")
        if isinstance(embedding, dict):
            values = embedding.get("values")
            if isinstance(values, list) and values:
                return [[float(v) for v in values]]

        embeddings = payload.get("embeddings")
        if isinstance(embeddings, list):
            for item in embeddings:
                if isinstance(item, dict):
                    values = item.get("values")
                    if not isinstance(values, list):
                        nested = item.get("embedding")
                        values = nested.get("values") if isinstance(nested, dict) else None
                    if isinstance(values, list) and values:
                        vectors.append([float(v) for v in values])
            if vectors:
                return vectors

        return []

    @staticmethod
    def _is_gemini_like(protocol: str) -> bool:
        proto = (protocol or "").lower()
        return "gemini" in proto or "google" in proto or "vertex" in proto
