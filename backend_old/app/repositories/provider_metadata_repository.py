from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Select, select, func
from sqlalchemy.orm import Session

from app.models.provider_metadata import ProviderMetadata


def create_metadata(
    db: Session,
    *,
    provider_slug: str,
    name: str | None = None,
    base_url: str,
    auth_config: dict[str, Any],
    endpoints_config: dict[str, Any] | None = None,
    model_list_config: dict[str, Any] | None = None,
    is_active: bool = True,
    version: str = "1.0.0",
    last_verified_at: str | None = None,
) -> ProviderMetadata:
    """Create a new provider metadata entry."""
    metadata = ProviderMetadata(
        provider_slug=provider_slug,
        name=name,
        base_url=base_url,
        auth_config=auth_config,
        endpoints_config=endpoints_config,
        model_list_config=model_list_config,
        is_active=is_active,
        version=version,
        last_verified_at=last_verified_at,
    )
    db.add(metadata)
    db.commit()
    db.refresh(metadata)
    return metadata


def get_metadata(db: Session, *, metadata_id: UUID) -> ProviderMetadata | None:
    """Get metadata by ID."""
    stmt: Select[tuple[ProviderMetadata]] = select(ProviderMetadata).where(ProviderMetadata.id == metadata_id)
    return db.execute(stmt).scalars().first()


def get_metadata_by_slug(db: Session, *, provider_slug: str) -> ProviderMetadata | None:
    """Get metadata by provider slug."""
    stmt: Select[tuple[ProviderMetadata]] = select(ProviderMetadata).where(
        ProviderMetadata.provider_slug == provider_slug
    )
    return db.execute(stmt).scalars().first()


def list_metadata(
    db: Session,
    *,
    is_active: bool | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[ProviderMetadata], int]:
    """List provider metadata with optional filtering and pagination."""
    stmt: Select[tuple[ProviderMetadata]] = select(ProviderMetadata)

    if is_active is not None:
        stmt = stmt.where(ProviderMetadata.is_active == is_active)

    # Get total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.execute(count_stmt).scalar() or 0

    # Apply pagination
    stmt = stmt.order_by(ProviderMetadata.created_at.desc()).limit(limit).offset(offset)
    metadata_list = list(db.execute(stmt).scalars().all())

    return metadata_list, total


def update_metadata(
    db: Session,
    *,
    metadata_id: UUID,
    name: str | None = None,
    base_url: str | None = None,
    auth_config: dict[str, Any] | None = None,
    endpoints_config: dict[str, Any] | None = None,
    model_list_config: dict[str, Any] | None = None,
    is_active: bool | None = None,
    version: str | None = None,
    last_verified_at: str | None = None,
) -> ProviderMetadata | None:
    """Update provider metadata."""
    metadata = get_metadata(db, metadata_id=metadata_id)
    if metadata is None:
        return None

    if name is not None:
        metadata.name = name
    if base_url is not None:
        metadata.base_url = base_url
    if auth_config is not None:
        metadata.auth_config = auth_config
    if endpoints_config is not None:
        metadata.endpoints_config = endpoints_config
    if model_list_config is not None:
        metadata.model_list_config = model_list_config
    if is_active is not None:
        metadata.is_active = is_active
    if version is not None:
        metadata.version = version
    if last_verified_at is not None:
        metadata.last_verified_at = last_verified_at

    db.commit()
    db.refresh(metadata)
    return metadata


def delete_metadata(db: Session, *, metadata_id: UUID) -> bool:
    """Delete provider metadata."""
    metadata = get_metadata(db, metadata_id=metadata_id)
    if metadata is None:
        return False

    db.delete(metadata)
    db.commit()
    return True


__all__ = [
    "create_metadata",
    "get_metadata",
    "get_metadata_by_slug",
    "list_metadata",
    "update_metadata",
    "delete_metadata",
]
