from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User


async def get_current_superuser(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # db kept for compatibility if future checks needed
) -> User:
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Superuser privileges required"
        )
    return user
