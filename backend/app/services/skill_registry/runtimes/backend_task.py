import asyncio
import importlib
import logging
from typing import Any

from app.models.skill_registry import SkillRegistry
from app.services.skill_registry.runtimes.base import BaseRuntimeStrategy, RuntimeContext

logger = logging.getLogger(__name__)


class BackendTaskRuntimeStrategy(BaseRuntimeStrategy):
    """
    Executes skills mapped directly to backend Python functions or Celery tasks.
    """

    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        entrypoint = manifest.get("entrypoint")
        if not entrypoint or ":" not in entrypoint:
            raise ValueError(f"Invalid entrypoint for backend_task: {entrypoint}")

        module_path, func_name = entrypoint.split(":")
        try:
            module = importlib.import_module(module_path)
            func = getattr(module, func_name)
        except (ImportError, AttributeError) as e:
            raise ValueError(
                f"Could not load backend_task entrypoint {entrypoint}: {e!s}"
            )

        # Check if it's a Celery task
        if hasattr(func, "delay"):
            # Execute asynchronously via Celery
            # Inject user_id if it's expected by the task or just pass it as kwarg
            task_kwargs = {**inputs}
            if context.user_id:
                task_kwargs["user_id"] = context.user_id

            task = func.delay(**task_kwargs)
            return {
                "status": "ok",
                "task_id": task.id,
                "stdout": [
                    f"System skill '{skill.id}' triggered via background worker.",
                    f"Task ID: {task.id}",
                ],
                "exit_code": 0,
            }

        # Otherwise, run directly in the current process (caution: might be blocking)
        if asyncio.iscoroutinefunction(func):
            result = await func(**inputs)
        else:
            result = func(**inputs)

        return {
            "status": "ok",
            "result": result,
            "stdout": [f"System skill '{skill.id}' executed successfully."],
            "exit_code": 0,
        }
