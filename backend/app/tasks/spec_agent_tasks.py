import asyncio
import uuid
import logging
from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.spec_agent_service import spec_agent_service
from app.repositories.spec_agent_repository import SpecAgentRepository

logger = logging.getLogger(__name__)

async def _run_spec_execution(plan_id_str: str, user_id_str: str):
    plan_id = uuid.UUID(plan_id_str)
    user_id = uuid.UUID(user_id_str)
    
    async with AsyncSessionLocal() as session:
        try:
            logger.info(f"Task: Initializing executor for plan {plan_id}")
            executor = await spec_agent_service.execute_plan(session, user_id, plan_id)
            
            while True:
                logger.debug(f"Task: Running step for plan {plan_id}")
                result = await executor.run_step()
                status = result.get("status")
                logger.info(f"Task: Plan {plan_id} step result: {status}")
                
                if status in ["completed", "stalled", "waiting_approval", "check_in_required"]:
                    logger.info(f"Task: Plan {plan_id} finished execution cycle with status: {status}")
                    break
                
                # Yield control briefly
                await asyncio.sleep(0.1)
                
        except Exception as e:
            logger.exception(f"Task: Execution failed for plan {plan_id}: {e}")
            try:
                repo = SpecAgentRepository(session)
                await repo.update_plan_status(plan_id, "FAILED")
                await session.commit()
            except Exception:
                logger.exception("Task: Failed to mark plan as FAILED for %s", plan_id)

@celery_app.task(queue="agent_tasks", name="app.tasks.spec_agent.execute_plan")
def execute_plan_task(plan_id: str, user_id: str):
    """
    Celery task to run the Spec Agent execution loop.
    Typically triggered after Plan creation or User Approval.
    """
    asyncio.run(_run_spec_execution(plan_id, user_id))
