"""
技能注册表管理 API (/api/v1/admin/skills)

端点:
- POST   /admin/skills            创建技能
- GET    /admin/skills            列出技能
- GET    /admin/skills/{skill_id} 获取技能详情
- PATCH  /admin/skills/{skill_id} 更新技能
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.deps.auth import require_permissions
from app.repositories.skill_artifact_repository import SkillArtifactRepository
from app.repositories.skill_capability_repository import SkillCapabilityRepository
from app.repositories.skill_dependency_repository import SkillDependencyRepository
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.schemas.skill_registry import SkillRegistryCreate, SkillRegistryDTO, SkillRegistryUpdate
from app.services.skill_registry.skill_registry_service import SkillRegistryService

router = APIRouter(prefix="/admin/skills", tags=["Admin - Skills"])


def get_skill_service(db: AsyncSession = Depends(get_db)) -> SkillRegistryService:
    repo = SkillRegistryRepository(db)
    capability_repo = SkillCapabilityRepository(db)
    dependency_repo = SkillDependencyRepository(db)
    artifact_repo = SkillArtifactRepository(db)
    return SkillRegistryService(
        repo,
        capability_repo=capability_repo,
        dependency_repo=dependency_repo,
        artifact_repo=artifact_repo,
    )


@router.post(
    "",
    response_model=SkillRegistryDTO,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def create_skill(
    payload: SkillRegistryCreate,
    service: SkillRegistryService = Depends(get_skill_service),
) -> SkillRegistryDTO:
    try:
        skill = await service.create(payload.model_dump())
        return SkillRegistryDTO.model_validate(skill)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get(
    "",
    response_model=list[SkillRegistryDTO],
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def list_skills(
    skip: int = 0,
    limit: int = 50,
    service: SkillRegistryService = Depends(get_skill_service),
) -> list[SkillRegistryDTO]:
    limit = max(1, min(limit, 100))
    skills = await service.repo.get_multi(skip=skip, limit=limit)
    return [SkillRegistryDTO.model_validate(skill) for skill in skills]


@router.get(
    "/{skill_id}",
    response_model=SkillRegistryDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def get_skill(
    skill_id: str,
    service: SkillRegistryService = Depends(get_skill_service),
) -> SkillRegistryDTO:
    skill = await service.get(skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    return SkillRegistryDTO.model_validate(skill)


@router.patch(
    "/{skill_id}",
    response_model=SkillRegistryDTO,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def update_skill(
    skill_id: str,
    payload: SkillRegistryUpdate,
    service: SkillRegistryService = Depends(get_skill_service),
) -> SkillRegistryDTO:
    skill = await service.get(skill_id)
    if not skill:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    updated = await service.repo.update(skill, update_data)
    return SkillRegistryDTO.model_validate(updated)
