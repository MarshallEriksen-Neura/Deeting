from __future__ import annotations

import logging
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

try:
    from redis.asyncio import Redis
except ModuleNotFoundError:  # pragma: no cover - dev env without redis
    Redis = object  # type: ignore[misc,assignment]

from app.deps import get_db, get_redis
from app.jwt_auth import AuthenticatedUser, require_superuser
from app.repositories import provider_metadata_repository
from app.schemas.provider_rules import (
    RuleGenerateRequest,
    MappingGenerateRequest,
    RuleGenerateResponse,
    MappingGenerateResponse,
    ProviderMetadataResponse,
    ProviderMetadataListResponse,
    RollbackRequest,
)
from app.services.provider.rule_generator import RuleGenerator, InvalidSampleError

router = APIRouter(
    prefix="/v1/admin/rules",
    tags=["admin-rules"],
    dependencies=[Depends(require_superuser)],
)
logger = logging.getLogger(__name__)


@router.post("/generate", response_model=RuleGenerateResponse, status_code=status.HTTP_201_CREATED)
def generate_rules(
    payload: RuleGenerateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    # ... existing implementation ...
    pass # Keep it for context match, but I will replace the whole file or use better context


    """
    Generate provider rules from sample /models response.

    This endpoint analyzes the sample response and generates:
    - JMESPath rule for extracting model list
    - Capability rules for inferring model capabilities
    """
    try:
        generator = RuleGenerator()
        result = generator.analyze_sample(payload.sample_response)

        # Store or update the generated rules in provider_metadata
        existing_metadata = provider_metadata_repository.get_metadata_by_slug(
            db, provider_slug=payload.provider_slug
        )

        if existing_metadata:
            # Update existing metadata with new rules
            model_list_config = {
                "jmespath_rule": result["jmespath_rule"],
                "capability_rules": result["capability_rules"],
                "generated_at": datetime.utcnow().isoformat(),
            }

            provider_metadata_repository.update_metadata(
                db,
                metadata_id=existing_metadata.id,
                model_list_config=model_list_config,
                last_verified_at=datetime.utcnow().isoformat(),
            )
        else:
            # Create new metadata entry
            # Note: This requires base_url and auth_config, which should be provided separately
            # For now, we just log a warning
            logger.warning(
                f"Provider metadata not found for {payload.provider_slug}. "
                "Rules generated but not persisted. Create provider metadata first."
            )

        logger.info(f"Generated rules for provider {payload.provider_slug} by user {current_user.id}")

        return RuleGenerateResponse(
            provider_slug=payload.provider_slug,
            jmespath_rule=result["jmespath_rule"],
            capability_rules=result["capability_rules"],
            metadata=result["metadata"],
        )
    except InvalidSampleError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sample response: {e.reason}",
        )
    except Exception as e:
        logger.exception(f"Failed to generate rules for {payload.provider_slug}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rule generation failed: {str(e)}",
        )


@router.get("", response_model=ProviderMetadataListResponse)
def list_rules(
    is_active: bool | None = Query(None, description="Filter by active status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    List all provider metadata entries with rules.
    """
    offset = (page - 1) * page_size
    metadata_list, total = provider_metadata_repository.list_metadata(
        db,
        is_active=is_active,
        limit=page_size,
        offset=offset,
    )

    items = [ProviderMetadataResponse.model_validate(metadata) for metadata in metadata_list]

    return ProviderMetadataListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{metadata_id}", response_model=ProviderMetadataResponse)
def get_rule(
    metadata_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    Get detailed information about a specific provider metadata entry.
    """
    metadata = provider_metadata_repository.get_metadata(db, metadata_id=metadata_id)
    if metadata is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider metadata not found",
        )

    return ProviderMetadataResponse.model_validate(metadata)


@router.post("/{metadata_id}/rollback", response_model=ProviderMetadataResponse)
def rollback_rule(
    metadata_id: UUID,
    payload: RollbackRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_superuser),
):
    """
    Rollback provider metadata to a specific version.

    Note: This is a placeholder implementation. For proper version control,
    you would need to implement a version history table to store previous versions.
    """
    metadata = provider_metadata_repository.get_metadata(db, metadata_id=metadata_id)
    if metadata is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Provider metadata not found",
        )

    # TODO: Implement proper version history and rollback
    # For now, just return a 501 Not Implemented
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Version rollback is not yet implemented. Implement a version history table first.",
    )


__all__ = ["router"]
