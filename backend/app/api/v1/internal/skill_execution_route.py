from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import get_current_user
from app.models import User
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.schemas.skill_execution import SkillExecutionRequest, SkillExecutionResult
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor

router = APIRouter(tags=["Internal Skill Execution"])


def get_executor(db: AsyncSession = Depends(get_db)) -> SkillRuntimeExecutor:
    repo = SkillRegistryRepository(db)
    return SkillRuntimeExecutor(repo)


@router.post("/skills/{skill_id}/execute", response_model=SkillExecutionResult)
async def execute_skill(
    skill_id: str,
    payload: SkillExecutionRequest,
    user: User = Depends(get_current_user),
    executor: SkillRuntimeExecutor = Depends(get_executor),
) -> SkillExecutionResult:
    try:
        session_id = payload.session_id or f"user:{user.id}"
        result = await executor.execute(
            skill_id,
            session_id=session_id,
            inputs=payload.inputs,
            intent=payload.intent,
        )
        return SkillExecutionResult(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
