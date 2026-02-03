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
from app.schemas.skill_self_heal import SkillSelfHealResult
from app.services.skill_registry.dry_run_service import SkillDryRunService
from app.services.skill_registry.skill_metrics_service import SkillMetricsService
from app.services.skill_registry.skill_registry_service import SkillRegistryService
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor
from app.services.skill_registry.skill_self_heal_service import SkillSelfHealService

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


def get_self_heal_service(db: AsyncSession = Depends(get_db)) -> SkillSelfHealService:
    repo = SkillRegistryRepository(db)
    executor = SkillRuntimeExecutor(repo)
    metrics = SkillMetricsService(repo, failure_threshold=2)
    dry_run_service = SkillDryRunService(
        repo,
        executor,
        metrics,
        failure_threshold=2,
        self_heal_service=None,
        self_heal_max_attempts=2,
    )
    self_heal_service = SkillSelfHealService(repo, dry_run_service=dry_run_service)
    dry_run_service.self_heal_service = self_heal_service
    return self_heal_service


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


@router.post(
    "/{skill_id}/self-heal",
    response_model=SkillSelfHealResult,
    dependencies=[Depends(require_permissions(["assistant.manage"]))],
)
async def self_heal_skill(
    skill_id: str,
    service: SkillSelfHealService = Depends(get_self_heal_service),
) -> SkillSelfHealResult:
    try:
        result = await service.self_heal(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return result
