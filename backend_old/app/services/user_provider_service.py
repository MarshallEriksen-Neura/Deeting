from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.logging_config import logger
from app.models import Provider, ProviderAllowedUser, ProviderAPIKey
from app.services.provider_preset_service import (
    ProviderPresetNotFoundError,
    get_provider_preset,
)
from app.repositories.provider_metadata_repository import (
    create_metadata as repo_create_metadata,
    get_metadata_by_slug as repo_get_metadata_by_slug,
)
from app.repositories.user_provider_repository import (
    count_user_private_providers as repo_count_user_private_providers,
    create_private_provider_with_key as repo_create_private_provider_with_key,
    get_accessible_provider_ids as repo_get_accessible_provider_ids,
    get_private_provider_by_id as repo_get_private_provider_by_id,
    list_private_providers as repo_list_private_providers,
    list_providers_shared_with_user as repo_list_providers_shared_with_user,
    persist_provider as repo_persist_provider,
    provider_exists as repo_provider_exists,
    update_provider_shared_users as repo_update_provider_shared_users,
)
from app.schemas.notification import NotificationCreateRequest
from app.schemas.provider_control import (
    UserProviderCreateRequest,
    UserProviderUpdateRequest,
)
from app.services.encryption import encrypt_secret
from app.services.notification_service import create_notification
from app.services.user_service import get_user_by_id


class UserProviderServiceError(RuntimeError):
    """Base error for user-private provider operations."""


class UserProviderNotFoundError(UserProviderServiceError):
    """Raised when a private provider cannot be found for a user."""


def _provider_exists(session: Session, provider_id: str) -> bool:
    return repo_provider_exists(session, provider_id=provider_id)


def _pick(value, fallback):
    """Return value if provided (and not empty string), else fallback."""
    if value is None:
        return fallback
    if isinstance(value, str) and value.strip() == "":
        return fallback
    return value


def _inherit_or_override(value):
    """
    对可从 preset 继承的字段：用户未提供则返回 None（表示继承），
    用户提供则返回规范化后的值（空字符串视为未提供）。
    """
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def _normalize_path(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if not trimmed.startswith("/"):
        raise UserProviderServiceError(f"{value} 必须以 / 开头")
    return trimmed


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "provider"


def _generate_unique_provider_id(
    session: Session,
    owner_id: UUID,
    provider_name: str,
) -> str:
    base_slug = _slugify(provider_name)
    owner_prefix = str(owner_id).split("-")[0][:8]
    base = f"{base_slug}-{owner_prefix}" if owner_prefix else base_slug
    base = base[:50]

    candidate = base
    suffix = 1
    while _provider_exists(session, candidate):
        suffix_str = str(suffix)
        trimmed = base[: max(1, 50 - len(suffix_str) - 1)]
        candidate = f"{trimmed}-{suffix_str}"
        suffix += 1
        if suffix > 50:
            raise UserProviderServiceError("无法生成唯一 provider_id，请稍后重试")
    return candidate


def create_private_provider(
    session: Session,
    owner_id: UUID,
    payload: UserProviderCreateRequest,
) -> Provider:
    """为指定用户创建一个私有 Provider 并写入一条上游密钥。"""

    provider_name = payload.name or "provider"

    preset = None
    if payload.preset_id:
        try:
            preset = get_provider_preset(session, payload.preset_id)
        except ProviderPresetNotFoundError as exc:
            raise UserProviderServiceError(str(exc)) from exc


    base_url = payload.base_url or getattr(preset, "base_url", None)
    if base_url is None:
        raise UserProviderServiceError("base_url 不能为空")

    generated_provider_id = _generate_unique_provider_id(
        session, owner_id, provider_name
    )

    base_url = str(base_url)

    provider = Provider(
        provider_id=generated_provider_id,
        name=provider_name,
        base_url=base_url,
        weight=payload.weight or 1.0,
        region=payload.region,
        cost_input=payload.cost_input,
        cost_output=payload.cost_output,
        max_qps=payload.max_qps,
        retryable_status_codes=_pick(
            payload.retryable_status_codes, getattr(preset, "retryable_status_codes", None)
        ),
        custom_headers=_pick(payload.custom_headers, getattr(preset, "custom_headers", None)),
        supported_api_styles=_pick(
            payload.supported_api_styles, getattr(preset, "supported_api_styles", None)
        ),
        static_models=_pick(payload.static_models, getattr(preset, "static_models", None)),
        status="healthy",
        owner_id=owner_id,
        visibility="private",
        preset_uuid=getattr(preset, "id", None),
    )

    try:
        provider = repo_create_private_provider_with_key(
            session,
            provider=provider,
            encrypted_key=encrypt_secret(payload.api_key),
            max_qps=payload.max_qps,
        )
    except IntegrityError as exc:  # pragma: no cover - 并发场景保护
        logger.error("Failed to create private provider: %s", exc)
        raise UserProviderServiceError("无法创建私有提供商") from exc

    # 如果预设带有模型规则且当前 provider 未有 metadata，则初始化一份，便于后续自动同步与映射
    if preset and (preset.model_list_config or preset.endpoints_config):
        existing_metadata = repo_get_metadata_by_slug(session, provider_slug=provider.provider_id)
        if existing_metadata is None:
            try:
                repo_create_metadata(
                    session,
                    provider_slug=provider.provider_id,
                    name=provider.name,
                    base_url=provider.base_url,
                    auth_config={"type": "bearer", "header": "Authorization", "value_template": "Bearer {api_key}"},
                    endpoints_config=preset.endpoints_config,
                    model_list_config=preset.model_list_config,
                )
                logger.info(
                    "Initialized provider_metadata for %s from preset %s",
                    provider.provider_id,
                    preset.preset_id,
                )
            except Exception as exc:  # pragma: no cover - 容错，不影响主流程
                logger.warning(
                    "Failed to init provider_metadata for %s from preset %s: %s",
                    provider.provider_id,
                    preset.preset_id,
                    exc,
                )
    return provider


def list_private_providers(session: Session, owner_id: UUID) -> list[Provider]:
    """列出指定用户的所有私有 Provider。"""
    return repo_list_private_providers(session, owner_id=owner_id)


def get_private_provider_by_id(
    session: Session,
    owner_id: UUID,
    provider_id: str,
) -> Provider | None:
    return repo_get_private_provider_by_id(session, owner_id=owner_id, provider_id=provider_id)


def update_private_provider(
    session: Session,
    owner_id: UUID,
    provider_id: str,
    payload: UserProviderUpdateRequest,
) -> Provider:
    """更新指定用户的私有 Provider 基本配置。

    目前仅允许更新非标识类字段；provider_id 不可修改。
    """
    provider = repo_get_private_provider_by_id(session, owner_id=owner_id, provider_id=provider_id)
    if provider is None:
        raise UserProviderNotFoundError(
            f"Private provider '{provider_id}' not found for user {owner_id}"
        )

    if payload.name is not None:
        provider.name = payload.name
    if payload.base_url is not None:
        provider.base_url = str(payload.base_url)
    if payload.weight is not None:
        provider.weight = payload.weight
    if payload.region is not None:
        provider.region = payload.region
    if payload.cost_input is not None:
        provider.cost_input = payload.cost_input
    if payload.cost_output is not None:
        provider.cost_output = payload.cost_output
    if payload.max_qps is not None:
        provider.max_qps = payload.max_qps
    if payload.retryable_status_codes is not None:
        provider.retryable_status_codes = payload.retryable_status_codes
    if payload.custom_headers is not None:
        provider.custom_headers = payload.custom_headers
    if payload.supported_api_styles is not None:
        # When explicitly provided, supported_api_styles becomes the
        # authoritative declaration of upstream API styles for this provider.
        provider.supported_api_styles = payload.supported_api_styles
    if payload.static_models is not None:
        provider.static_models = payload.static_models

    try:
        provider = repo_persist_provider(session, provider=provider)
    except IntegrityError as exc:  # pragma: no cover - 并发场景保护
        logger.error("Failed to update private provider: %s", exc)
        raise UserProviderServiceError("无法更新私有提供商") from exc
    return provider


def count_user_private_providers(session: Session, owner_id: UUID) -> int:
    """统计用户的私有 Provider 数量，用于配额控制。"""
    return repo_count_user_private_providers(session, owner_id=owner_id)


def list_providers_shared_with_user(session: Session, user_id: UUID) -> list[Provider]:
    """列出通过私有分享授权给该用户的 Provider（不包含自己创建的）。"""
    return repo_list_providers_shared_with_user(session, user_id=user_id)


def get_accessible_provider_ids(
    session: Session,
    user_id: UUID,
) -> set[str]:
    """返回当前用户可访问的 Provider ID 集合，用于路由过滤。"""
    user = get_user_by_id(session, user_id)
    if user is None:
        return set()
    return repo_get_accessible_provider_ids(session, user_id=user_id, is_superuser=bool(user.is_superuser))


def update_provider_shared_users(
    session: Session,
    owner_id: UUID,
    provider_id: str,
    user_ids: list[UUID],
) -> Provider:
    """更新私有 Provider 的共享列表并调整可见性。"""

    provider = repo_get_private_provider_by_id(session, owner_id=owner_id, provider_id=provider_id)
    if provider is None:
        raise UserProviderNotFoundError(
            f"Private provider '{provider_id}' not found for user {owner_id}"
        )

    normalized: list[UUID] = []
    seen: set[UUID] = set()
    for raw in user_ids:
        try:
            uid = UUID(str(raw))
        except (TypeError, ValueError):
            raise UserProviderServiceError(f"非法的用户 ID: {raw}")
        if uid == owner_id:
            # 不需要显式授权所有者自己
            continue
        if uid in seen:
            continue
        normalized.append(uid)
        seen.add(uid)

    # 校验用户存在
    missing = [uid for uid in normalized if get_user_by_id(session, uid) is None]
    if missing:
        missing_str = ", ".join(str(item) for item in missing)
        raise UserProviderServiceError(f"以下用户不存在：{missing_str}")

    provider, added_user_ids = repo_update_provider_shared_users(
        session,
        provider=provider,
        target_user_ids=normalized,
    )

    if added_user_ids:
        try:
            create_notification(
                session,
                NotificationCreateRequest(
                    title="私有提供商共享通知",
                    content=(
                        f"私有提供商 {provider.name}（ID: {provider.provider_id}）"
                        "已向你开放访问权限。"
                    ),
                    level="info",
                    target_type="users",
                    target_user_ids=added_user_ids,
                ),
                creator_id=owner_id,
            )
        except Exception:  # pragma: no cover - 通知失败不影响共享
            logger.exception(
                "Failed to send share notification for provider %s to users %s",
                provider.provider_id,
                added_user_ids,
            )
    return provider


__all__ = [
    "UserProviderNotFoundError",
    "UserProviderServiceError",
    "count_user_private_providers",
    "create_private_provider",
    "get_accessible_provider_ids",
    "get_private_provider_by_id",
    "list_private_providers",
    "list_providers_shared_with_user",
    "update_private_provider",
    "update_provider_shared_users",
]
