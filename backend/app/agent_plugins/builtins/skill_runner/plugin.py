import logging
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor

logger = logging.getLogger(__name__)


class SkillRunnerPlugin(AgentPlugin):
    """
    Core plugin for executing dynamic skills from the Skill Registry.
    Interacts with OpenSandbox via SkillRuntimeExecutor.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.execution.skill_runner",
            version="1.0.0",
            description="Executes dynamic skills in a secure sandbox environment.",
            author="System",
        )

    def get_tools(self) -> list[dict[str, Any]]:
        # No static tools to register. Skills are discovered via JIT.
        return []

    def can_handle_tool(self, tool_name: str) -> bool:
        """
        Dynamic dispatch check.
        Returns True if the tool name starts with 'skill__'.
        """
        return tool_name.startswith("skill__")

    async def handle_tool_call(self, tool_name: str, **kwargs) -> Any:
        """
        Universal handler for all skill executions.
        """
        if not self.can_handle_tool(tool_name):
            return {"error": f"SkillRunner cannot handle tool '{tool_name}'"}

        skill_id = tool_name[7:]  # Remove 'skill__' prefix
        logger.info(f"SkillRunner: Executing skill '{skill_id}'")

        # Extract context if passed by AgentExecutor
        ctx = kwargs.pop("__context__", None)
        session_id = ctx.trace_id if ctx else "unknown_session"

        async with AsyncSessionLocal() as session:
            repo = SkillRegistryRepository(session)
            executor = SkillRuntimeExecutor(repo)

            try:
                # We map kwargs directly to 'inputs'
                # The Intent is typically the tool name or user query, but here we can just say "execution"
                result = await executor.execute(
                    skill_id=skill_id,
                    session_id=session_id,
                    inputs=kwargs,
                    intent="execution",
                )

                # Format result for LLM consumption
                # We prioritize artifacts if any, otherwise stdout/result
                artifacts = result.get("artifacts", [])
                stdout = result.get("stdout", [])
                stderr = result.get("stderr", [])

                stdout_str = "\n".join(stdout) if stdout else ""
                stderr_str = "\n".join(stderr) if stderr else ""

                # Truncate logs if too long
                if len(stdout_str) > 2000:
                    stdout_str = stdout_str[:2000] + "... (truncated)"
                if len(stderr_str) > 2000:
                    stderr_str = stderr_str[:2000] + "... (truncated)"

                output = {
                    "status": "success" if result.get("exit_code") == 0 else "failed",
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "artifacts": [
                        a.get("name") for a in artifacts
                    ],  # Simplify artifact list
                }

                if result.get("result"):
                    output["return_value"] = result.get("result")

                return output

            except ValueError as ve:
                logger.warning(f"SkillRunner: Skill not found or invalid: {ve}")
                return {"error": f"Skill '{skill_id}' execution failed: {ve!s}"}
            except Exception as e:
                logger.error(f"SkillRunner: Execution error: {e}", exc_info=True)
                return {"error": f"Skill execution error: {e!s}"}
