import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.superuser import get_current_superuser
from app.schemas.provider_credential import (
    ProviderCredentialCreate,
    ProviderCredentialResponse,
)
from app.services.provider_instance_service import ProviderInstanceService

router = APIRouter(prefix="/admin/provider-instances", tags=["ProviderCredentials"])


@router.get("/{instance_id}/credentials", response_model=List[ProviderCredentialResponse])
async def list_credentials(
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        creds = await svc.list_credentials(instance_uuid, getattr(user, "id", None))
    except ValueError:
        raise HTTPException(status_code=404, detail="instance not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return creds


@router.post(
    "/{instance_id}/credentials",
    response_model=ProviderCredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_credential(
    instance_id: str,
    payload: ProviderCredentialCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid instance_id")

    svc = ProviderInstanceService(db)
    try:
        cred = await svc.create_credential(
            instance_id=instance_uuid,
            user_id=getattr(user, "id", None),
            alias=payload.alias,
            secret_ref_id=payload.secret_ref_id,
            weight=payload.weight,
            priority=payload.priority,
            is_active=payload.is_active,
        )
    except ValueError as e:
        if str(e) == "alias_exists":
            raise HTTPException(status_code=409, detail="alias already exists")
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return cred


@router.delete("/{instance_id}/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    instance_id: str,
    credential_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    try:
        instance_uuid = uuid.UUID(instance_id)
        cred_uuid = uuid.UUID(credential_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid id")

    svc = ProviderInstanceService(db)
    try:
        await svc.delete_credential(instance_uuid, cred_uuid, getattr(user, "id", None))
    except ValueError:
        raise HTTPException(status_code=404, detail="credential not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden")
    return None
