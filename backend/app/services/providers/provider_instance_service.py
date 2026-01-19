import uuid
import httpx
import time
import json
from typing import Iterable, List, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from google.oauth2 import service_account
import google.auth.transport.requests

from app.models.provider_instance import ProviderInstance, ProviderModel, ProviderCredential
from app.core.config import settings
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_credential_repository import ProviderCredentialRepository
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.core.cache_invalidation import CacheInvalidator
from app.constants.model_capability_map import guess_capabilities, primary_capability
from app.services.secrets.manager import SecretManager
from app.services.providers.upstream_url import (
    build_upstream_url,
    build_upstream_url_with_params,
)
from app.utils.time_utils import Datetime


class ProviderInstanceService:
    """封装 ProviderInstance / ProviderModel 业务，避免 API 直接操作 ORM。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.instance_repo = ProviderInstanceRepository(session)
        self.model_repo = ProviderModelRepository(session)
        self.preset_repo = ProviderPresetRepository(session)
        self.credential_repo = ProviderCredentialRepository(session)
        self._invalidator = CacheInvalidator()
        self.secret_manager = SecretManager()
        from app.core.cache import cache
        self.cache = cache

    async def verify_credentials(
        self,
        preset_slug: str,
        base_url: str,
        api_key: str,
        model: str | None = None,
        protocol: str | None = "openai",
        auto_append_v1: bool | None = None,
        resource_name: str | None = None,
        deployment_name: str | None = None,
        project_id: str | None = None,
        region: str | None = None,
        api_version: str | None = None,
    ) -> Dict[str, Any]:
        """验证凭证有效性并尝试发现模型列表。"""
        # 1. 构造探测 URL
        url = base_url.rstrip("/")
        headers = {}
        
        # Vertex AI 特殊处理
        if "vertexai" in preset_slug.lower():
            if project_id and region:
                url = url.replace("{project}", project_id).replace("{region}", region)
            headers["Authorization"] = f"Bearer {api_key}"
            test_model = model or "gemini-1.5-flash"
            url = f"{url}publishers/google/models/{test_model}:streamGenerateContent?alt=sse"
            result = await self._probe_vertex_deployment(url, headers)
            result["probe_url"] = url
            return result

        # Azure 特殊处理
        elif "azure" in preset_slug.lower() and resource_name:
            if "{resource}" in url:
                url = url.replace("{resource}", resource_name)
            if deployment_name:
                version = api_version or "2023-05-15"
                url = f"{url}/openai/deployments/{deployment_name}/chat/completions?api-version={version}"
                headers["api-key"] = api_key
                result = await self._probe_azure_deployment(url, headers)
                result["probe_url"] = url
                return result
        
        # 协议处理
        elif protocol == "claude" or protocol == "anthropic":
            url = build_upstream_url(
                base_url=url,
                upstream_path="v1/models",
                protocol=protocol,
                auto_append_v1=False,
            )
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            url = build_upstream_url(
                base_url=url,
                upstream_path="models",
                protocol=protocol,
                auto_append_v1=auto_append_v1,
            )
            headers["Authorization"] = f"Bearer {api_key}"
        
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers)
                latency = int((time.time() - start) * 1000)
                
                if resp.status_code == 200:
                    data = resp.json()
                    models = []
                    if isinstance(data, dict):
                        if "data" in data and isinstance(data["data"], list):
                             models = [m["id"] for m in data["data"] if "id" in m]
                        elif "models" in data and isinstance(data["models"], list):
                             models = [m["id"] for m in data["models"] if "id" in m]
                    
                    return {
                        "success": True,
                        "message": "Verification successful",
                        "latency_ms": latency,
                        "discovered_models": models,
                        "probe_url": url,
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Verification failed: HTTP {resp.status_code} - {resp.text[:100]}",
                        "latency_ms": latency,
                        "discovered_models": [],
                        "probe_url": url,
                    }
        except Exception as e:
            return {
                "success": False,
                "message": f"Verification error: {str(e)}",
                "latency_ms": 0,
                "discovered_models": [],
                "probe_url": url,
            }

    def _get_vertex_access_token(self, creds_input: str) -> str:
        try:
            info = json.loads(creds_input)
            if "type" in info and info["type"] == "service_account":
                creds = service_account.Credentials.from_service_account_info(
                    info,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"]
                )
                auth_req = google.auth.transport.requests.Request()
                creds.refresh(auth_req)
                return creds.token
        except (json.JSONDecodeError, ValueError):
            pass
        return creds_input

    async def _probe_vertex_deployment(self, url: str, headers: dict) -> Dict[str, Any]:
        start = time.time()
        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header[7:]
            real_token = self._get_vertex_access_token(raw_token)
            headers["Authorization"] = f"Bearer {real_token}"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": "ping"}]}],
            "generationConfig": {"maxOutputTokens": 1}
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency = int((time.time() - start) * 1000)
                
                if resp.status_code == 200:
                    return {
                        "success": True,
                        "message": "Vertex AI connection verified",
                        "latency_ms": latency,
                        "discovered_models": ["gemini-vertex"]
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Vertex AI verification failed: {resp.status_code} - {resp.text[:100]}",
                        "latency_ms": latency,
                        "discovered_models": []
                    }
        except Exception as e:
            return {
                "success": False,
                "message": f"Vertex AI probe error: {str(e)}",
                "latency_ms": 0,
                "discovered_models": []
            }

    async def _probe_azure_deployment(self, url: str, headers: dict) -> Dict[str, Any]:
        start = time.time()
        payload = {
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency = int((time.time() - start) * 1000)
                
                if resp.status_code == 200:
                    return {
                        "success": True,
                        "message": "Azure deployment verified",
                        "latency_ms": latency,
                        "discovered_models": ["azure-deployment"]
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Azure verification failed: {resp.status_code} - {resp.text[:100]}",
                        "latency_ms": latency,
                        "discovered_models": []
                    }
        except Exception as e:
            return {
                "success": False,
                "message": f"Azure probe error: {str(e)}",
                "latency_ms": 0,
                "discovered_models": []
            }

    async def _get_secret(self, preset, instance: ProviderInstance) -> str | None:
        """解析实例默认凭证：先查实例内 credential，再查 SecretManager。"""
        secret_ref = instance.credentials_ref or getattr(preset, "auth_config", {}).get("secret_ref_id")
        if secret_ref and not secret_ref.startswith("db:"):
            grouped = await self.credential_repo.get_by_instance_ids([str(instance.id)])
            creds = grouped.get(str(instance.id), [])
            for cred in creds:
                if cred.alias == secret_ref and cred.is_active:
                    secret_ref = cred.secret_ref_id
                    break
        provider = getattr(preset, "provider", None) if preset else None
        return await self.secret_manager.get(provider, secret_ref, self.session)

    def _normalize_base_url(self, preset, instance: ProviderInstance) -> str:
        base = instance.base_url or getattr(preset, "base_url", "")
        tpl = getattr(preset, "url_template", None)
        meta = getattr(instance, "meta", {}) or {}

        resource_name = meta.get("resource_name") or meta.get("resource") or meta.get("deployment_name")
        if tpl and "{resource}" in tpl and resource_name:
            base = tpl.replace("{resource}", resource_name)
        return (base or "").rstrip("/")

    async def _fetch_models_from_upstream(
        self,
        preset,
        instance: ProviderInstance,
        secret: str | None,
    ) -> list[dict[str, Any]]:
        """
        调用上游 /models（或等价接口）并返回原始模型列表。

        已适配：
        - OpenAI: GET /v1/models
        - Anthropic: GET /v1/models 需 anthropic-version 头
        - Azure OpenAI: GET /openai/deployments?api-version=*
        - Gemini API: GET https://generativelanguage.googleapis.com/v1beta/models?key=*
        其余按 OpenAI 兼容路径兜底。
        """
        protocol = (instance.meta or {}).get("protocol") or getattr(preset, "provider", "openai")
        provider = getattr(preset, "provider", "") or protocol
        base_url = self._normalize_base_url(preset, instance)
        if not base_url:
            raise ValueError("base_url_not_configured")

        headers: dict[str, str] = {}
        params: dict[str, Any] = {}
        url = ""

        proto_lower = (protocol or "").lower()
        provider_lower = (provider or "").lower()

        if "anthropic" in (proto_lower + provider_lower):
            url = f"{base_url}/v1/models"
            headers["x-api-key"] = secret or ""
            headers["anthropic-version"] = "2023-06-01"
        elif "azure" in proto_lower or "azure" in provider_lower:
            version = (instance.meta or {}).get("api_version") or "2023-05-15"
            url = f"{base_url}/openai/deployments"
            params["api-version"] = version
            headers["api-key"] = secret or ""
        elif "gemini" in provider_lower or "google" in provider_lower or "vertex" in provider_lower:
            # Gemini API key 通过 header 传递，避免拼接到 URL
            url = "https://generativelanguage.googleapis.com/v1beta/models"
            if secret:
                headers["x-goog-api-key"] = secret
        else:
            url = f"{base_url}/v1/models" if not base_url.endswith("/v1") else f"{base_url}/models"
            if secret:
                headers["Authorization"] = f"Bearer {secret}"

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()

        models: list[dict[str, Any]] = []
        if isinstance(data, dict):
            if isinstance(data.get("data"), list):
                models = data["data"]
            elif isinstance(data.get("models"), list):
                models = data["models"]
            elif isinstance(data.get("value"), list):  # Azure deployments
                models = data["value"]
        return models

    def _build_model_payloads(
        self,
        models: list[dict[str, Any]],
        instance: ProviderInstance,
        forced_capability: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        将上游模型列表转换为 ProviderModel 字段。
        """
        payloads: list[dict[str, Any]] = []
        meta = instance.meta or {}
        model_prefix = meta.get("model_prefix") or ""
        proto = (meta.get("protocol") or getattr(instance, "preset_slug", "") or "").lower()

        def extract_model_id(m: dict) -> str:
            mid = m.get("id") or m.get("model") or m.get("name") or ""
            if isinstance(mid, str) and mid.startswith("models/"):
                mid = mid.split("/", 1)[1]
            return str(mid)

        def upstream_path_for(cap: str, model_id: str) -> str:
            if "azure" in proto:
                base = f"openai/deployments/{model_id}"
                if cap == "embedding":
                    return f"{base}/embeddings"
                if cap == "audio":
                    return f"{base}/audio/transcriptions"
                return f"{base}/chat/completions"
            if "gemini" in proto or "google" in proto or "vertex" in proto:
                if cap == "embedding":
                    return f"v1beta/models/{model_id}:embedContent"
                return f"v1beta/models/{model_id}:generateContent"
            if cap == "embedding":
                return "embeddings"
            if cap == "audio":
                return "audio/transcriptions"
            return "chat/completions"

        now = Datetime.utcnow()
        for m in models:
            raw_model_id = extract_model_id(m)
            if not raw_model_id:
                continue
            model_id = f"{model_prefix}{raw_model_id}"
            caps = guess_capabilities(model_id)
            capability = forced_capability or primary_capability(caps)
            upstream_path = upstream_path_for(capability, model_id)

            payloads.append(
                {
                    "capability": capability,
                    "model_id": model_id,
                    "unified_model_id": model_id,
                    "display_name": m.get("display_name") or m.get("model") or m.get("id") or model_id,
                    "upstream_path": upstream_path,
                    "template_engine": "simple_replace",
                    "request_template": {},
                    "response_transform": {},
                    "pricing_config": {},
                    "limit_config": {},
                    "tokenizer_config": {},
                    "routing_config": {},
                    "source": "auto",
                    "extra_meta": {
                        "upstream_capabilities": caps,
                        "raw": m,
                    },
                    "weight": 100,
                    "priority": 0,
                    "is_active": True,
                    "synced_at": now,
                }
            )
        return payloads

    async def sync_models_from_upstream(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        preserve_user_overrides: bool = True,
    ) -> List[ProviderModel]:
        instance = await self.assert_instance_access(instance_id, user_id)
        preset = await self.preset_repo.get_by_slug(instance.preset_slug)
        if not preset:
            raise ValueError("preset_not_found")
        secret = await self._get_secret(preset, instance)
        models_raw = await self._fetch_models_from_upstream(preset, instance, secret)
        payloads = self._build_model_payloads(models_raw, instance)

        results = await self.model_repo.upsert_from_upstream(
            instance_id, payloads, preserve_user_overrides=preserve_user_overrides
        )
        await self._invalidator.on_provider_model_changed(str(instance_id))
        return results

    async def quick_add_models(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        model_ids: list[str],
        capability: str | None = None,
    ) -> List[ProviderModel]:
        instance = await self.assert_instance_access(instance_id, user_id)
        # 清洗 + 去重
        cleaned = []
        seen: set[str] = set()
        for mid in model_ids:
            mid_clean = (mid or "").strip()
            if not mid_clean or mid_clean in seen:
                continue
            seen.add(mid_clean)
            cleaned.append(mid_clean)
        if not cleaned:
            raise ValueError("empty_models")

        raw_models = [{"id": mid} for mid in cleaned]
        payloads = self._build_model_payloads(raw_models, instance, forced_capability=capability)
        results = await self.model_repo.upsert_for_instance(instance_id, payloads)
        await self._invalidator.on_provider_model_changed(str(instance_id))
        return results

    async def create_instance(
        self,
        user_id: uuid.UUID | None,
        preset_slug: str,
        name: str,
        base_url: str,
        credentials_ref: str | None,
        description: str | None = None,
        icon: str | None = None,
        api_key: str | None = None,
        protocol: str | None = None,
        model_prefix: str | None = None,
        auto_append_v1: bool | None = None,
        priority: int = 0,
        is_enabled: bool = True,
        resource_name: str | None = None,
        deployment_name: str | None = None,
        api_version: str | None = None,
        project_id: str | None = None,
        region: str | None = None,
    ) -> ProviderInstance:
        preset = await self.preset_repo.get_by_slug(preset_slug)
        if not preset or not preset.is_active:
            raise ValueError("preset_not_found")

        meta = {}
        if protocol:
            meta["protocol"] = protocol
        if model_prefix:
            meta["model_prefix"] = model_prefix
        if auto_append_v1 is not None:
            meta["auto_append_v1"] = auto_append_v1
        if resource_name:
            meta["resource_name"] = resource_name
        if deployment_name:
            meta["deployment_name"] = deployment_name
        if api_version:
            meta["api_version"] = api_version
        if project_id:
            meta["project_id"] = project_id
        if region:
            meta["region"] = region

        final_credentials_ref = credentials_ref
        if final_credentials_ref and self.secret_manager._looks_like_plain_secret(final_credentials_ref):
            raise ValueError("plaintext_secret_ref_forbidden")
        if api_key:
            try:
                final_credentials_ref = await self.secret_manager.store(
                    provider=preset.provider,
                    raw_secret=api_key,
                    db_session=self.session,
                )
            except RuntimeError as exc:
                raise ValueError("secret_key_not_configured") from exc

        if not final_credentials_ref:
            raise ValueError("credentials_ref or api_key is required")

        instance_id = uuid.uuid4()
        instance_data = {
            "id": instance_id,
            "user_id": user_id,
            "preset_slug": preset_slug,
            "name": name,
            "description": description,
            "base_url": base_url,
            "icon": icon,
            "credentials_ref": final_credentials_ref,
            "priority": priority,
            "is_enabled": is_enabled,
            "meta": meta,
        }
        
        instance = await self.instance_repo.create(instance_data)
        
        await self._invalidator.on_provider_instance_changed(str(user_id) if user_id else None)
        return instance

    async def update_instance(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        **fields,
    ) -> ProviderInstance:
        instance = await self.assert_instance_access(instance_id, user_id)

        # 提取允许更新的字段
        updatable = {}
        meta_updates = {}
        for key in ["name", "description", "base_url", "icon", "priority", "is_enabled", "credentials_ref"]:
            if key in fields and fields[key] is not None:
                updatable[key] = fields[key]

        for key in [
            "protocol",
            "model_prefix",
            "auto_append_v1",
            "resource_name",
            "deployment_name",
            "api_version",
            "project_id",
            "region",
        ]:
            if key not in fields or fields[key] is None:
                continue
            if key == "protocol" and isinstance(fields[key], str) and not fields[key].strip():
                continue
            meta_updates[key] = fields[key]

        if meta_updates:
            meta = dict(getattr(instance, "meta", {}) or {})
            meta.update(meta_updates)
            updatable["meta"] = meta

        if "credentials_ref" in updatable and self.secret_manager._looks_like_plain_secret(updatable["credentials_ref"]):
            raise ValueError("plaintext_secret_ref_forbidden")

        # 处理 api_key 更新：写入加密密钥并更新 credentials_ref
        api_key = fields.get("api_key")
        if api_key:
            preset = await self.preset_repo.get_by_slug(instance.preset_slug)
            existing_ref = instance.credentials_ref if instance.credentials_ref and instance.credentials_ref.startswith("db:") else None
            try:
                new_ref = await self.secret_manager.store(
                    provider=preset.provider if preset else None,
                    raw_secret=api_key,
                    db_session=self.session,
                    secret_ref_id=existing_ref,
                )
            except RuntimeError as exc:
                raise ValueError("secret_key_not_configured") from exc
            updatable["credentials_ref"] = new_ref
            await self._invalidator.on_provider_credentials_changed(str(instance_id))
        elif "credentials_ref" not in updatable:
            current_ref = (instance.credentials_ref or "").strip()
            if current_ref and self.secret_manager._looks_like_plain_secret(current_ref):
                preset = await self.preset_repo.get_by_slug(instance.preset_slug)
                try:
                    new_ref = await self.secret_manager.store(
                        provider=preset.provider if preset else None,
                        raw_secret=current_ref,
                        db_session=self.session,
                    )
                except RuntimeError as exc:
                    raise ValueError("secret_key_not_configured") from exc
                updatable["credentials_ref"] = new_ref
                await self._invalidator.on_provider_credentials_changed(str(instance_id))

        if updatable:
            await self.instance_repo.update(instance, updatable)

        await self._invalidator.on_provider_instance_changed(str(user_id) if user_id else None)
        return await self.instance_repo.get(instance_id)  # refresh

    async def list_instances(
        self,
        user_id: uuid.UUID | None,
        include_public: bool = True,
    ) -> List[ProviderInstance]:
        return await self.instance_repo.get_available_instances(
            user_id=str(user_id) if user_id else None,
            include_public=include_public,
        )

    async def assert_instance_access(self, instance_id: uuid.UUID, user_id: uuid.UUID | None) -> ProviderInstance:
        instance = await self.instance_repo.get(instance_id)
        if not instance:
            raise ValueError("instance_not_found")
        if instance.user_id and instance.user_id != user_id:
            raise PermissionError("forbidden")
        return instance

    async def upsert_models(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        models: Iterable[ProviderModel],
    ) -> List[ProviderModel]:
        await self.assert_instance_access(instance_id, user_id)
        
        # Convert Pydantic models/objects to dicts for repository
        models_data = []
        for m in models:
            # Handle both dict and object
            if hasattr(m, "model_dump"):
                d = m.model_dump()
            else:
                # copy to avoid mutating ORM instance __dict__
                d = dict(vars(m))
            # Clean up SQLAlchemy internal state
            d.pop("_sa_instance_state", None)
            d.pop("synced_at", None)
            models_data.append(d)

        results = await self.model_repo.upsert_for_instance(instance_id, models_data)
        await self._invalidator.on_provider_model_changed(str(instance_id))
        return results

    async def list_models(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> List[ProviderModel]:
        await self.assert_instance_access(instance_id, user_id)
        from app.core.cache_keys import CacheKeys

        cache_key = CacheKeys.provider_model_list(str(instance_id))

        async def loader():
            return await self.model_repo.get_by_instance_id(instance_id)

        cached = await self.cache.get_or_set_singleflight(
            cache_key,
            loader=loader,
            ttl=self.cache.jitter_ttl(settings.CACHE_DEFAULT_TTL),
        )
        return cached

    async def update_model(
        self,
        model_id: uuid.UUID,
        user_id: uuid.UUID | None,
        **fields,
    ) -> ProviderModel:
        model = await self.model_repo.get(model_id)
        if not model:
            raise ValueError("model_not_found")

        # 权限校验
        await self.assert_instance_access(model.instance_id, user_id)

        updatable_fields = {
            "display_name",
            "is_active",
            "weight",
            "priority",
            "pricing_config",
            "limit_config",
            "tokenizer_config",
            "routing_config",
        }
        updates = {k: v for k, v in fields.items() if k in updatable_fields and v is not None}
        if not updates:
            return model

        updated = await self.model_repo.update_fields(model, updates)
        await self._invalidator.on_provider_model_changed(
            str(model.instance_id),
            capability=model.capability,
            model_id=model.model_id,
        )
        return updated

    def _build_upstream_url(
        self,
        base_url: str,
        upstream_path: str,
        protocol: str | None,
        instance: ProviderInstance,
    ) -> tuple[str, dict]:
        meta = instance.meta or {}
        return build_upstream_url_with_params(
            base_url=base_url,
            upstream_path=upstream_path,
            protocol=protocol,
            auto_append_v1=meta.get("auto_append_v1"),
            api_version=meta.get("api_version"),
        )

    async def test_model(
        self,
        model_id: uuid.UUID,
        user_id: uuid.UUID | None,
        prompt: str = "ping",
    ) -> dict:
        model = await self.model_repo.get(model_id)
        if not model:
            raise ValueError("model_not_found")
        instance = await self.assert_instance_access(model.instance_id, user_id)
        preset = await self.preset_repo.get_by_slug(instance.preset_slug)
        protocol = (instance.meta or {}).get("protocol") or getattr(preset, "provider", "openai")

        secret = await self._get_secret(preset, instance)
        if not secret:
            raise ValueError("secret_not_found")

        base_url = self._normalize_base_url(preset, instance)
        url, params = self._build_upstream_url(base_url, model.upstream_path, protocol, instance)

        headers: dict[str, str] = {"Content-Type": "application/json"}
        proto_lower = (protocol or "").lower()
        if "anthropic" in proto_lower:
            headers["x-api-key"] = secret
            headers["anthropic-version"] = "2023-06-01"
        elif "azure" in proto_lower:
            headers["api-key"] = secret
        elif "gemini" in proto_lower or "google" in proto_lower or "vertex" in proto_lower:
            headers["x-goog-api-key"] = secret
        else:
            headers["Authorization"] = f"Bearer {secret}"

        capability = (model.capability or "chat").lower()
        if capability in {"embedding"}:
            payload = {"model": model.model_id, "input": prompt}
        elif capability in {"audio"}:
            payload = {"model": model.model_id, "input": prompt, "response_format": "json"}
        else:
            payload = {
                "model": model.model_id,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 16,
            }

        start = time.time()
        status_code = 0
        body = None
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, headers=headers, params=params, json=payload)
            status_code = resp.status_code
            try:
                body = resp.json()
            except Exception:
                body = {"text": resp.text[:500]}
            success = 200 <= resp.status_code < 300
            latency_ms = int((time.time() - start) * 1000)
            return {
                "success": success,
                "latency_ms": latency_ms,
                "status_code": status_code,
                "upstream_url": url,
                "response_body": body,
                "error": None if success else body.get("error") if isinstance(body, dict) else resp.text[:200],
            }
        except Exception as exc:
            latency_ms = int((time.time() - start) * 1000)
            return {
                "success": False,
                "latency_ms": latency_ms,
                "status_code": status_code or 0,
                "upstream_url": url,
                "response_body": body,
                "error": str(exc),
            }

    async def list_credentials(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> List[ProviderCredential]:
        await self.assert_instance_access(instance_id, user_id)
        grouped = await self.credential_repo.get_by_instance_ids([str(instance_id)])
        return grouped.get(str(instance_id), [])

    async def create_credential(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
        alias: str,
        secret_ref_id: str | None = None,
        weight: int = 0,
        priority: int = 0,
        is_active: bool = True,
        api_key: str | None = None,
    ) -> ProviderCredential:
        instance = await self.assert_instance_access(instance_id, user_id)
        
        # 唯一性校验
        exists = await self.credential_repo.get_by_alias(instance_id, alias)
        if exists:
            raise ValueError("alias_exists")

        if api_key:
            preset = await self.preset_repo.get_by_slug(instance.preset_slug)
            try:
                secret_ref_id = await self.secret_manager.store(
                    provider=preset.provider if preset else None,
                    raw_secret=api_key,
                    db_session=self.session,
                )
            except RuntimeError as exc:
                raise ValueError("secret_key_not_configured") from exc
        elif not secret_ref_id:
            raise ValueError("secret_ref_id_or_api_key_required")
        elif self.secret_manager._looks_like_plain_secret(secret_ref_id):
            raise ValueError("plaintext_secret_ref_forbidden")
        elif not secret_ref_id.startswith("db:"):
            raise ValueError("secret_ref_id_invalid_format")

        cred_data = {
            "id": uuid.uuid4(),
            "instance_id": instance_id,
            "alias": alias,
            "secret_ref_id": secret_ref_id,
            "weight": weight,
            "priority": priority,
            "is_active": is_active,
        }
        cred = await self.credential_repo.create(cred_data)
        await self._invalidator.on_provider_credentials_changed(str(instance_id))
        return cred

    async def delete_credential(
        self,
        instance_id: uuid.UUID,
        credential_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        await self.assert_instance_access(instance_id, user_id)
        cred = await self.credential_repo.get(credential_id)
        if not cred or cred.instance_id != instance_id:
            raise ValueError("credential_not_found")
        
        await self.credential_repo.delete(credential_id)
        await self._invalidator.on_provider_credentials_changed(str(instance_id))

    async def delete_instance(
        self,
        instance_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        instance = await self.assert_instance_access(instance_id, user_id)
        await self.instance_repo.delete(instance_id)

        # 清理健康状态缓存
        try:
            if self.cache.redis:
                await self.cache.redis.unlink(
                    f"provider:health:{instance_id}",
                    f"provider:health:{instance_id}:history",
                )
        except Exception:
            pass

        await self._invalidator.on_provider_model_changed(str(instance_id))
        await self._invalidator.on_provider_credentials_changed(str(instance_id))
        await self._invalidator.on_provider_instance_changed(str(user_id) if user_id else None)
