from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.skill_registry import SkillRegistry
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.repositories.user_skill_installation_repository import (
    UserSkillInstallationRepository,
)
from app.services.plugin_ui_bundle_storage import (
    get_bundle_ready_marker,
    get_plugin_ui_bundle_dir,
)

_PLUGIN_UI_TOKEN_AUD = "plugin_ui"
_DEFAULT_UI_TOKEN_TTL_SECONDS = 300
_MAX_UI_TOKEN_TTL_SECONDS = 1800


@dataclass(frozen=True)
class PluginUiSession:
    renderer_url: str
    expires_at: int
    skill_id: str
    revision: str
    renderer_asset_path: str


@dataclass(frozen=True)
class PluginUiAsset:
    file_path: Path
    content_type: str
    expires_at: int


class PluginUiGatewayService:
    def __init__(
        self,
        session: AsyncSession | None = None,
        *,
        skill_repo: SkillRegistryRepository | None = None,
        install_repo: UserSkillInstallationRepository | None = None,
    ):
        self.session = session
        self.skill_repo = skill_repo or (
            SkillRegistryRepository(session) if session is not None else None
        )
        self.install_repo = install_repo or (
            UserSkillInstallationRepository(session) if session is not None else None
        )

    async def issue_renderer_session(
        self,
        *,
        user_id: uuid.UUID,
        skill_id: str,
        base_url: str,
        ttl_seconds: int = _DEFAULT_UI_TOKEN_TTL_SECONDS,
    ) -> PluginUiSession:
        self._ensure_signing_secret()
        if self.skill_repo is None or self.install_repo is None:
            raise ValueError("issue_renderer_session requires database repositories")

        skill = await self.skill_repo.get_by_id(skill_id)
        if not skill:
            raise HTTPException(status_code=404, detail="plugin not found")
        if skill.source_repo is None:
            raise HTTPException(status_code=400, detail="plugin has no source repo")
        if str(skill.status or "").strip() != "active":
            raise HTTPException(status_code=409, detail="plugin is not active")

        install = await self.install_repo.get_by_user_skill(user_id, skill_id)
        if not install or not bool(getattr(install, "is_enabled", False)):
            raise HTTPException(status_code=403, detail="plugin not installed")

        revision = str(install.installed_revision or skill.source_revision or "").strip()
        if not revision:
            raise HTTPException(status_code=409, detail="plugin revision unavailable")

        bundle_dir = get_plugin_ui_bundle_dir(skill_id=skill_id, revision=revision)
        if not get_bundle_ready_marker(bundle_dir).exists():
            raise HTTPException(status_code=404, detail="plugin ui bundle not found")

        renderer_asset_path = self._resolve_renderer_asset_path(skill)
        resolved_renderer = self._safe_path_join(bundle_dir, renderer_asset_path)
        if not resolved_renderer.exists() or not resolved_renderer.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"renderer asset not found: {renderer_asset_path}",
            )

        now = int(time.time())
        ttl = max(30, min(int(ttl_seconds or _DEFAULT_UI_TOKEN_TTL_SECONDS), _MAX_UI_TOKEN_TTL_SECONDS))
        expires_at = now + ttl
        token = self._issue_token(
            {
                "uid": str(user_id),
                "sid": str(skill_id),
                "rev": str(revision),
                "aud": _PLUGIN_UI_TOKEN_AUD,
                "exp": expires_at,
                "jti": uuid.uuid4().hex,
            }
        )

        normalized_base_url = str(base_url or "").rstrip("/")
        asset_part = quote(renderer_asset_path, safe="/")
        renderer_url = (
            f"{normalized_base_url}{settings.API_V1_STR}"
            f"/plugin-market/ui/t/{token}/{asset_part}"
        )
        return PluginUiSession(
            renderer_url=renderer_url,
            expires_at=expires_at,
            skill_id=str(skill_id),
            revision=str(revision),
            renderer_asset_path=renderer_asset_path,
        )

    async def resolve_asset(
        self,
        *,
        token: str,
        asset_path: str,
    ) -> PluginUiAsset:
        payload = self._verify_token(token)
        skill_id = str(payload.get("sid") or "").strip()
        revision = str(payload.get("rev") or "").strip()
        if not skill_id or not revision:
            raise HTTPException(status_code=403, detail="invalid ui token payload")

        bundle_dir = get_plugin_ui_bundle_dir(skill_id=skill_id, revision=revision)
        if not get_bundle_ready_marker(bundle_dir).exists():
            raise HTTPException(status_code=404, detail="plugin ui bundle not found")

        target_asset_path = str(asset_path or "").strip().lstrip("/") or "index.html"
        if any(part.startswith(".") for part in Path(target_asset_path).parts):
            raise HTTPException(status_code=403, detail="access denied")
        file_path = self._safe_path_join(bundle_dir, target_asset_path)
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="ui asset not found")

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        return PluginUiAsset(
            file_path=file_path,
            content_type=content_type,
            expires_at=int(payload["exp"]),
        )

    @staticmethod
    def _resolve_renderer_asset_path(skill: SkillRegistry) -> str:
        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        ui_bundle = manifest.get("ui_bundle")
        if isinstance(ui_bundle, dict):
            renderer_asset_path = str(ui_bundle.get("renderer_asset_path") or "").strip()
            if renderer_asset_path:
                return renderer_asset_path.lstrip("/")
        entry = manifest.get("entry")
        if isinstance(entry, dict):
            renderer_entry = str(entry.get("renderer") or "").strip().lstrip("/")
            if renderer_entry:
                candidate = Path(renderer_entry)
                if candidate.suffix:
                    return candidate.name
        return "index.html"

    @staticmethod
    def _safe_path_join(base: Path, untrusted: str) -> Path:
        base_path = base.resolve()
        final_path = (base_path / untrusted).resolve()
        if not final_path.is_relative_to(base_path):
            raise HTTPException(status_code=403, detail="access denied")
        return final_path

    def _issue_token(self, payload: dict) -> str:
        payload_bytes = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        payload_b64 = self._urlsafe_b64_encode(payload_bytes)
        sig = self._sign(payload_b64)
        return f"{payload_b64}.{sig}"

    def _verify_token(self, token: str) -> dict:
        self._ensure_signing_secret()
        raw = str(token or "").strip()
        if not raw or "." not in raw:
            raise HTTPException(status_code=403, detail="invalid ui token")
        payload_b64, sig = raw.split(".", 1)
        expected_sig = self._sign(payload_b64)
        if not hmac.compare_digest(sig, expected_sig):
            raise HTTPException(status_code=403, detail="invalid ui token signature")
        try:
            payload = json.loads(self._urlsafe_b64_decode(payload_b64).decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=403, detail="invalid ui token payload") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=403, detail="invalid ui token payload")
        if str(payload.get("aud") or "") != _PLUGIN_UI_TOKEN_AUD:
            raise HTTPException(status_code=403, detail="invalid ui token audience")
        exp = int(payload.get("exp") or 0)
        if exp <= int(time.time()):
            raise HTTPException(status_code=403, detail="ui token expired")
        return payload

    def _sign(self, payload_b64: str) -> str:
        secret = self._ensure_signing_secret().encode("utf-8")
        return hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def _urlsafe_b64_encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

    @staticmethod
    def _urlsafe_b64_decode(value: str) -> bytes:
        padded = value + "=" * ((4 - len(value) % 4) % 4)
        return base64.urlsafe_b64decode(padded.encode("utf-8"))

    @staticmethod
    def _ensure_signing_secret() -> str:
        secret = str(getattr(settings, "SECRET_KEY", "") or "").strip()
        if not secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="SECRET_KEY not configured",
            )
        return secret
