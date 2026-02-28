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
            # Strip internal meta keys injected by SkillRunner (e.g. __tool_name__)
            # to avoid leaking reserved params into backend task signatures.
            task_kwargs = {
                key: value
                for key, value in (inputs or {}).items()
                if not str(key).startswith("__")
            }
            should_wait = task_kwargs.pop("wait", False)
            is_onboarding_skill = skill.id in (
                "system.skill_onboarding",
                "system.assistant_onboarding",
            )
            # Force wait for onboarding tasks to provide better DX for AI
            if is_onboarding_skill:
                should_wait = True

            if context.user_id:
                task_kwargs["user_id"] = context.user_id

            if should_wait:
                # Use apply_async + get() to wait for results
                # We limit wait time to avoid blocking gateway indefinitely
                try:
                    task = func.apply_async(kwargs=task_kwargs)
                    result = task.get(timeout=30) # Wait up to 30s
                    return {
                        "status": "ok",
                        "result": result,
                        "stdout": [
                            f"System skill '{skill.id}' executed successfully via background worker.",
                        ],
                        "exit_code": 0,
                    }
                except Exception as e:
                    logger.error(f"BackendTask: failed to wait for celery task {skill.id}: {e}")
                    # Onboarding must fail fast with explicit error to avoid ambiguous
                    # "task triggered" messages that can mislead follow-up actions.
                    if is_onboarding_skill:
                        return {
                            "status": "failed",
                            "error": f"System skill '{skill.id}' failed: {e!s}",
                            "error_code": "SYSTEM_ONBOARDING_TASK_FAILED",
                            "stdout": [
                                "Onboarding task failed. Please report failure to the user.",
                            ],
                            "exit_code": 1,
                        }
                    # Keep historical behavior for non-onboarding skills.
                    return {
                        "status": "partial",
                        "error": f"Failed to get synchronous result: {e!s}",
                        "stdout": [f"Task triggered but wait failed. Check task logs for details."],
                        "exit_code": 1,
                    }

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
