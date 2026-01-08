from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.logging_config import logger
from app.models import ProviderPreset, AgentTaskType
from app.repositories.provider_preset_repository import (
    create_provider_preset as repo_create_provider_preset,
    delete_provider_preset as repo_delete_provider_preset,
    get_provider_preset as repo_get_provider_preset,
    list_provider_presets as repo_list_provider_presets,
    persist_provider_preset as repo_persist_provider_preset,
    rollback as repo_rollback,
)
from app.repositories.agent_task_repository import create_task as repo_create_task
from app.schemas.provider_control import (
    ProviderPresetBase,
    ProviderPresetCreateRequest,
    ProviderPresetExportResponse,
    ProviderPresetImportError,
    ProviderPresetImportRequest,
    ProviderPresetImportResult,
    ProviderPresetUpdateRequest,
)


class ProviderPresetServiceError(RuntimeError):
    """Base error for provider preset operations."""


class ProviderPresetIdExistsError(ProviderPresetServiceError):
    """Raised when preset_id already exists."""


class ProviderPresetNotFoundError(ProviderPresetServiceError):
    """Raised when preset_id cannot be found."""

def _create_discover_task(session: Session, preset_id: str, created_by_id=None):
    """
    Enqueue an agent task to discover rules/mappings for this preset.
    Non-blocking; failures are logged but do not break main flow.
    """
    try:
        task = repo_create_task(
            session,
            task_type=AgentTaskType.PRESET_DISCOVER,
            provider_slug=None,
            config={"preset_id": preset_id},
            created_by_id=created_by_id,
        )
        logger.info("Queued preset_discover task for preset %s", preset_id)
        return task
    except Exception:  # pragma: no cover - keep side effect soft
        logger.exception("Failed to queue preset_discover task for %s", preset_id)
        return None


def create_preset_discover_task(session: Session, preset_id: str, *, created_by_id=None):
    """公开方法，便于接口手动触发 discover 任务。"""
    return _create_discover_task(session, preset_id, created_by_id)

def list_provider_presets(session: Session) -> list[ProviderPreset]:
    return repo_list_provider_presets(session)


def get_provider_preset(session: Session, preset_id: str) -> ProviderPreset:
    preset = repo_get_provider_preset(session, preset_id=preset_id)
    if preset is None:
        raise ProviderPresetNotFoundError(f"Preset {preset_id} not found")
    return preset


def create_provider_preset(session: Session, payload: ProviderPresetCreateRequest, *, created_by_id=None) -> ProviderPreset:
    preset = ProviderPreset(
        preset_id=payload.preset_id,
        display_name=payload.display_name,
        description=payload.description,   
        base_url=str(payload.base_url),
        models_path=payload.models_path,
        messages_path=payload.messages_path,
        chat_completions_path=payload.chat_completions_path,
        responses_path=payload.responses_path,
        images_generations_path=payload.images_generations_path,
        supported_api_styles=payload.supported_api_styles,
        retryable_status_codes=payload.retryable_status_codes,
        custom_headers=payload.custom_headers,
        static_models=payload.static_models,
        endpoints_config=payload.endpoints_config,
        model_list_config=payload.model_list_config,
        response_maps=payload.response_maps,
    )

    try:
        preset = repo_create_provider_preset(session, preset=preset)
    except IntegrityError as exc:  # pragma: no cover
        logger.error("Failed to create provider preset: %s", exc)
        raise ProviderPresetIdExistsError("preset_id 已存在") from exc
    return preset


def update_provider_preset(
    session: Session,
    preset_id: str,
    payload: ProviderPresetUpdateRequest,
    *,
    updated_by_id=None,
) -> ProviderPreset:
    preset = get_provider_preset(session, preset_id)

    if payload.display_name is not None:
        preset.display_name = payload.display_name
    if payload.description is not None:
        preset.description = payload.description
    if payload.base_url is not None:
        preset.base_url = str(payload.base_url)
    if payload.supported_api_styles is not None:
        preset.supported_api_styles = payload.supported_api_styles
    if payload.retryable_status_codes is not None:
        preset.retryable_status_codes = payload.retryable_status_codes
    if payload.custom_headers is not None:
        preset.custom_headers = payload.custom_headers
    if payload.static_models is not None:
        preset.static_models = payload.static_models
    if payload.endpoints_config is not None:
        preset.endpoints_config = payload.endpoints_config
    if payload.model_list_config is not None:
        preset.model_list_config = payload.model_list_config
    if payload.response_maps is not None:
        preset.response_maps = payload.response_maps

    return repo_persist_provider_preset(session, preset=preset)


def delete_provider_preset(session: Session, preset_id: str) -> None:
    preset = get_provider_preset(session, preset_id)
    repo_delete_provider_preset(session, preset=preset)


def export_provider_presets(session: Session) -> ProviderPresetExportResponse:
    presets = list_provider_presets(session)
    serialized = [ProviderPresetBase.model_validate(preset) for preset in presets]
    return ProviderPresetExportResponse(presets=serialized, total=len(serialized))


def import_provider_presets(session: Session, payload: ProviderPresetImportRequest, *, created_by_id=None) -> ProviderPresetImportResult:
    result = ProviderPresetImportResult()

    for preset_payload in payload.presets:
        try:
            try:
                existing = get_provider_preset(session, preset_payload.preset_id)
            except ProviderPresetNotFoundError:
                existing = None

            if existing and not payload.overwrite:
                result.skipped.append(preset_payload.preset_id)
                continue

            if existing and payload.overwrite:
                update_payload = ProviderPresetUpdateRequest(
                    **preset_payload.model_dump(exclude={"preset_id"})
                )
                update_provider_preset(session, preset_payload.preset_id, update_payload, updated_by_id=created_by_id)
                result.updated.append(preset_payload.preset_id)
                continue

            create_payload = ProviderPresetCreateRequest(**preset_payload.model_dump())
            create_provider_preset(session, create_payload, created_by_id=created_by_id)
            result.created.append(preset_payload.preset_id)
        except ProviderPresetServiceError as exc:
            repo_rollback(session)
            logger.error("Failed to import provider preset %s: %s", preset_payload.preset_id, exc)
            result.failed.append(
                ProviderPresetImportError(preset_id=preset_payload.preset_id, reason=str(exc))
            )
        except Exception as exc:  # pragma: no cover - unexpected branch
            repo_rollback(session)
            logger.exception(
                "Unexpected error importing provider preset %s", preset_payload.preset_id
            )
            result.failed.append(
                ProviderPresetImportError(preset_id=preset_payload.preset_id, reason=str(exc))
            )

    return result


__all__ = [
    "ProviderPresetIdExistsError",
    "ProviderPresetNotFoundError",
    "ProviderPresetServiceError",
    "create_provider_preset",
    "delete_provider_preset",
    "export_provider_presets",
    "get_provider_preset",
    "create_preset_discover_task",
    "import_provider_presets",
    "list_provider_presets",
    "update_provider_preset",
]
