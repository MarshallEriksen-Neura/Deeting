from fastapi import APIRouter, Depends, HTTPException, status
from app.schemas.discovery import DiscoveryTaskRequest, DiscoveryTaskResponse
from app.tasks.agent import run_discovery_task
from app.deps.superuser import get_current_superuser  # 超管校验

router = APIRouter()

@router.post("/discovery/tasks", response_model=DiscoveryTaskResponse)
async def create_discovery_task(
    payload: DiscoveryTaskRequest,
    # current_user = Depends(get_current_superuser) 
):
    """
    提交一个自动化厂商/能力接入任务。
    """
    # 异步发送到 Celery agent_tasks 队列
    task = run_discovery_task.apply_async(
        kwargs={
            "target_url": payload.target_url,
            "capability": payload.capability,
            "model_hint": payload.model_hint,
            "provider_name_hint": payload.provider_name_hint
        }
    )
    
    return DiscoveryTaskResponse(task_id=task.id, status="queued")
