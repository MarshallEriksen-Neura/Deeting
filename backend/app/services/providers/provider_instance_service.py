import uuid
import httpx
import time
import json
from datetime import datetime
from typing import Iterable, List, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from google.oauth2 import service_account
import google.auth.transport.requests

from app.models.provider_instance import ProviderInstance, ProviderModel, ProviderCredential
from app.repositories.provider_instance_repository import (
    ProviderInstanceRepository,
    ProviderModelRepository,
)
from app.repositories.provider_credential_repository import ProviderCredentialRepository
from app.core.cache_invalidation import CacheInvalidator


class ProviderInstanceService:
    """封装 ProviderInstance / ProviderModel 业务，避免 API 直接操作 ORM。"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.instance_repo = ProviderInstanceRepository(session)
        self.model_repo = ProviderModelRepository(session)
        self.credential_repo = ProviderCredentialRepository(session)
        self._invalidator = CacheInvalidator()
        from app.core.cache import cache
        self.cache = cache

    async def verify_credentials(
        self,
        preset_slug: str,
        base_url: str,
        api_key: str,
        model: str | None = None,
        protocol: str | None = "openai",
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
            return await self._probe_vertex_deployment(url, headers)

        # Azure 特殊处理
        elif "azure" in preset_slug.lower() and resource_name:
            if "{resource}" in url:
                url = url.replace("{resource}", resource_name)
            if deployment_name:
                version = api_version or "2023-05-15"
                url = f"{url}/openai/deployments/{deployment_name}/chat/completions?api-version={version}"
                headers["api-key"] = api_key
                return await self._probe_azure_deployment(url, headers)
        
        # 协议处理
        elif protocol == "claude" or protocol == "anthropic":
            url = f"{url}/v1/models"
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            if not url.endswith("/v1"):
                 url = f"{url}/v1/models"
            else:
                 url = f"{url}/models"
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
                        "discovered_models": models
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Verification failed: HTTP {resp.status_code} - {resp.text[:100]}",
                        "latency_ms": latency,
                        "discovered_models": []
                    }
        except Exception as e:
            return {
                "success": False,
                "message": f"Verification error: {str(e)}",
                "latency_ms": 0,
                "discovered_models": []
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

    async def create_instance(
        self,
        user_id: uuid.UUID | None,
        preset_slug: str,
        name: str,
        description: str | None,
        base_url: str,
        icon: str | None,
        credentials_ref: str | None,
        api_key: str | None = None,
        protocol: str | None = None,
        model_prefix: str | None = None,
        channel: str = "external",
        priority: int = 0,
        is_enabled: bool = True,
        resource_name: str | None = None,
        deployment_name: str | None = None,
        api_version: str | None = None,
        project_id: str | None = None,
        region: str | None = None,
    ) -> ProviderInstance:
        meta = {}
        if protocol:
            meta["protocol"] = protocol
        if model_prefix:
            meta["model_prefix"] = model_prefix
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
        
        if api_key:
            final_credentials_ref = "default"

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
            "channel": channel,
            "priority": priority,
            "is_enabled": is_enabled,
            "meta": meta,
        }
        
        instance = await self.instance_repo.create(instance_data)
        
        if api_key:
            # Use repository for credential creation
            cred_data = {
                "id": uuid.uuid4(),
                "instance_id": instance_id,
                "alias": "default",
                "secret_ref_id": api_key,
                "is_active": True
            }
            await self.credential_repo.create(cred_data)

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
        for key in ["name", "description", "base_url", "icon", "channel", "priority", "is_enabled", "credentials_ref"]:
            if key in fields and fields[key] is not None:
                updatable[key] = fields[key]

        for key in ["protocol", "model_prefix", "resource_name", "deployment_name", "api_version", "project_id", "region"]:
            if key in fields and fields[key] is not None:
                meta_updates[key] = fields[key]

        if meta_updates:
            meta = dict(getattr(instance, "meta", {}) or {})
            meta.update(meta_updates)
            updatable["meta"] = meta

        # 处理 api_key 更新：追加默认凭证
        api_key = fields.get("api_key")
        if api_key:
            cred_data = {
                "id": uuid.uuid4(),
                "instance_id": instance_id,
                "alias": "default",
                "secret_ref_id": api_key,
                "is_active": True,
            }
            await self.credential_repo.create(cred_data)
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
            d = m.model_dump() if hasattr(m, "model_dump") else m.__dict__
            # Clean up SQLAlchemy internal state
            d.pop("_sa_instance_state", None)
            d.pop("id", None) # Let repo handle ID or reuse logic
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
        return await self.model_repo.get_by_instance_id(instance_id)

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
        secret_ref_id: str,
        weight: int = 0,
        priority: int = 0,
        is_active: bool = True,
    ) -> ProviderCredential:
        await self.assert_instance_access(instance_id, user_id)
        
        # 唯一性校验
        exists = await self.credential_repo.get_by_alias(instance_id, alias)
        if exists:
            raise ValueError("alias_exists")

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
