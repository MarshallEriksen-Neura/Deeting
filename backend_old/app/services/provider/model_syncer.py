"""Model synchronizer for fetching and upserting provider models."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentTask, AgentTaskStatus, AgentTaskType, Provider, ProviderMetadata, ProviderModel
from app.repositories.agent_task_repository import update_status as update_task_status

from .capability_matcher import CapabilityMatcher
from .rule_validator import RuleValidator

logger = logging.getLogger(__name__)


class ModelSyncerError(RuntimeError):
    """Base error for model synchronization operations."""


class ProviderNotFoundError(ModelSyncerError):
    """Raised when provider slug is not found."""

    def __init__(self, provider_slug: str):
        super().__init__(f"Provider '{provider_slug}' not found")
        self.provider_slug = provider_slug


class MetadataNotFoundError(ModelSyncerError):
    """Raised when provider metadata is not found."""

    def __init__(self, provider_slug: str):
        super().__init__(f"Metadata for provider '{provider_slug}' not found")
        self.provider_slug = provider_slug


class RuleValidationError(ModelSyncerError):
    """Raised when rule validation fails."""

    def __init__(self, reason: str, issues: list[dict[str, Any]] | None = None):
        super().__init__(f"Rule validation failed: {reason}")
        self.reason = reason
        self.issues = issues or []


class ModelSyncer:
    """Synchronizes provider models by fetching /models and applying extraction rules."""

    def __init__(self, session: Session, http_timeout: int = 30):
        self.session = session
        self.http_timeout = http_timeout
        self.capability_matcher = CapabilityMatcher()
        self.rule_validator = RuleValidator()

    def sync_provider_models(
        self,
        provider_slug: str,
        *,
        created_by_id: UUID | None = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """
        Synchronize models for a provider by fetching /models and applying rules.

        Args:
            provider_slug: Provider slug identifier
            created_by_id: User ID who initiated sync (for task tracking)
            dry_run: If True, validate rules but don't write to database

        Returns:
            Dict containing:
                - success: Boolean indicating if sync succeeded
                - models_synced: Number of models synced
                - models_updated: Number of existing models updated
                - models_created: Number of new models created
                - task_id: AgentTask ID if rule regeneration was triggered

        Raises:
            ProviderNotFoundError: If provider not found
            MetadataNotFoundError: If provider metadata not found
            RuleValidationError: If rules are invalid and blocking
        """
        # 1. Fetch provider and metadata
        provider = self._get_provider(provider_slug)
        metadata = self._get_metadata(provider_slug)

        # 2. Fetch /models response
        models_response = self._fetch_models(provider, metadata)

        # 3. Validate rules against response
        rule_dict = {
            "jmespath_rule": metadata.model_list_config.get("selector") if metadata.model_list_config else None,
            "capability_rules": self._extract_capability_rules(metadata),
        }

        validation_result = self.rule_validator.validate_rule(rule_dict, models_response)

        if not validation_result["valid"]:
            # Rules failed - create rule regeneration task
            task = self._create_rule_gen_task(
                provider=provider,
                sample_response=models_response,
                issues=validation_result["issues"],
                created_by_id=created_by_id,
            )
            raise RuleValidationError(
                "Rules failed validation" + ("; regeneration task created" if task else ""),
                validation_result["issues"],
            )

        # 4. Extract models using validated rules
        extracted_models = validation_result["extracted_models"]

        if dry_run:
            return {
                "success": True,
                "models_synced": len(extracted_models),
                "models_updated": 0,
                "models_created": 0,
                "dry_run": True,
            }

        # 5. Upsert models to database
        models_created, models_updated = self._upsert_models(
            provider,
            extracted_models,
            validation_result["matched_capabilities"],
        )

        return {
            "success": True,
            "models_synced": len(extracted_models),
            "models_created": models_created,
            "models_updated": models_updated,
        }

    def _get_provider(self, provider_slug: str) -> Provider:
        """Fetch provider by slug."""
        stmt = select(Provider).where(Provider.provider_id == provider_slug)
        provider = self.session.execute(stmt).scalars().first()
        if not provider:
            raise ProviderNotFoundError(provider_slug)
        return provider

    def _get_metadata(self, provider_slug: str) -> ProviderMetadata:
        """Fetch provider metadata by slug."""
        stmt = select(ProviderMetadata).where(ProviderMetadata.provider_slug == provider_slug)
        metadata = self.session.execute(stmt).scalars().first()
        if not metadata:
            raise MetadataNotFoundError(provider_slug)
        return metadata

    def _fetch_models(self, provider: Provider, metadata: ProviderMetadata) -> dict[str, Any]:
        """Fetch /models response from provider."""
        if not metadata.model_list_config:
            raise ModelSyncerError(f"No model_list_config for provider {provider.provider_id}")

        endpoint = metadata.model_list_config.get("endpoint", "/v1/models")
        url = f"{metadata.base_url.rstrip('/')}{endpoint}"

        # Build auth headers
        headers = self._build_auth_headers(metadata)

        try:
            response = httpx.get(url, headers=headers, timeout=self.http_timeout)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            raise ModelSyncerError(f"Failed to fetch models from {url}: {e}") from e

    def _build_auth_headers(self, metadata: ProviderMetadata) -> dict[str, str]:
        """Build authentication headers from auth_config."""
        headers = {}
        auth_config = metadata.auth_config or {}

        auth_type = auth_config.get("type", "bearer")
        if auth_type == "bearer":
            header = auth_config.get("header", "Authorization")
            # Note: In production, we'd fetch actual API key from provider_api_keys
            # For now, we'll skip auth or use a placeholder
            # headers[header] = f"Bearer {api_key}"
            pass

        return headers

    def _extract_capability_rules(self, metadata: ProviderMetadata) -> list[dict[str, Any]]:
        """Extract capability rules from endpoints_config."""
        if not metadata.endpoints_config:
            return []

        # Extract capability patterns from endpoints_config
        # This is a simplified extraction - actual structure may vary
        rules = []
        for capability, config in metadata.endpoints_config.items():
            if isinstance(config, dict) and "patterns" in config:
                rules.append({
                    "capability": capability,
                    "patterns": config["patterns"],
                })

        return rules

    def _upsert_models(
        self,
        provider: Provider,
        models: list[dict[str, Any]],
        matched_capabilities: dict[str, list[str]],
    ) -> tuple[int, int]:
        """
        Upsert models to database.

        Returns tuple of (created_count, updated_count).
        """
        created = 0
        updated = 0

        # Fetch existing models for this provider
        stmt = select(ProviderModel).where(ProviderModel.provider_id == provider.id)
        existing = {m.model_id: m for m in self.session.execute(stmt).scalars().all()}

        for model_data in models:
            model_id = model_data.get("id") or model_data.get("model") or model_data.get("name")
            if not model_id:
                logger.warning("Skipping model without ID: %s", model_data)
                continue

            model_id = str(model_id)
            capabilities = matched_capabilities.get(model_id, [])

            # Build model record
            display_name = model_data.get("name") or model_data.get("display_name") or model_id
            family = self._infer_family(model_id)
            context_length = model_data.get("context_length") or model_data.get("max_tokens") or 4096

            # Calculate metadata hash for change detection
            metadata_str = json.dumps(model_data, sort_keys=True)
            meta_hash = hashlib.sha256(metadata_str.encode()).hexdigest()

            if model_id in existing:
                # Update existing
                existing_model = existing[model_id]
                if existing_model.meta_hash != meta_hash:
                    existing_model.display_name = display_name
                    existing_model.family = family
                    existing_model.context_length = context_length
                    existing_model.capabilities = capabilities
                    existing_model.metadata_json = model_data
                    existing_model.meta_hash = meta_hash
                    self.session.add(existing_model)
                    updated += 1
            else:
                # Create new
                new_model = ProviderModel(
                    provider_id=provider.id,
                    model_id=model_id,
                    display_name=display_name,
                    family=family,
                    context_length=context_length,
                    capabilities=capabilities,
                    metadata_json=model_data,
                    meta_hash=meta_hash,
                )
                self.session.add(new_model)
                created += 1

        self.session.commit()
        return created, updated

    def _infer_family(self, model_id: str) -> str:
        """Infer model family from model ID."""
        model_lower = model_id.lower()

        if "gpt" in model_lower:
            return "gpt"
        if "claude" in model_lower:
            return "claude"
        if "gemini" in model_lower:
            return "gemini"
        if "llama" in model_lower:
            return "llama"
        if "qwen" in model_lower:
            return "qwen"
        if "embed" in model_lower:
            return "embedding"

        return "unknown"

    def _create_rule_gen_task(
        self,
        provider: Provider,
        sample_response: dict[str, Any],
        issues: list[dict[str, Any]],
        created_by_id: UUID | None,
    ) -> AgentTask | None:
        """
        Create RULE_GEN agent task when rules fail validation.

        仅对绑定了官方 ProviderPreset 的 Provider 创建任务；公共/私有但无预设均跳过。
        """
        has_preset = getattr(provider, "preset_uuid", None) is not None
        if not has_preset:
            logger.warning(
                "Skip RULE_GEN task for provider %s (has_preset=%s)",
                provider.provider_id,
                has_preset,
            )
            return None

        task = AgentTask(
            task_type=AgentTaskType.RULE_GEN,
            status=AgentTaskStatus.PENDING.value,
            provider_slug=provider.provider_id,
            config={
                "sample_response": sample_response,
                "validation_issues": issues,
            },
            steps=[
                {
                    "name": "init",
                    "status": "running",
                    "message": "规则验证失败，等待重新生成",
                    "progress": 5,
                }
            ],
            progress=5,
            created_by_id=str(created_by_id) if created_by_id else None,
        )
        self.session.add(task)
        self.session.commit()
        self.session.refresh(task)

        logger.info(
            "Created RULE_GEN task %s for provider %s due to validation failure",
            task.id,
            provider.provider_id,
        )

        return task


__all__ = [
    "MetadataNotFoundError",
    "ModelSyncer",
    "ModelSyncerError",
    "ProviderNotFoundError",
    "RuleValidationError",
]
