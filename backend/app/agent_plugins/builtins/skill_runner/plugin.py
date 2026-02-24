import logging
import uuid
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.plugin_ui_gateway_service import PluginUiGatewayService

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
        session_id = None
        if ctx:
            if hasattr(ctx, "session_id") and ctx.session_id:
                session_id = ctx.session_id
            elif hasattr(ctx, "trace_id"):
                session_id = ctx.trace_id
        
        if not session_id:
            session_id = self.context.session_id or "unknown_session"
            
        user_id = ctx.user_id if ctx else self.context.user_id

        async with AsyncSessionLocal() as session:
            from app.services.skill_registry.skill_runtime_executor import (
                SkillRuntimeExecutor,
            )

            repo = SkillRegistryRepository(session)
            executor = SkillRuntimeExecutor(repo)

            try:
                runtime_inputs = dict(kwargs)
                runtime_inputs.setdefault("__tool_name__", skill_id)
                # We map kwargs directly to 'inputs'
                # The Intent is typically the tool name or user query, but here we can just say "execution"
                result = await executor.execute(
                    skill_id=skill_id,
                    session_id=session_id,
                    user_id=user_id,
                    inputs=runtime_inputs,
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
                ui_blocks = await self._build_ui_blocks(
                    result=result,
                    skill_id=skill_id,
                    user_id=user_id,
                    ctx=ctx,
                    session=session,
                )
                if ui_blocks:
                    output["ui"] = {"blocks": ui_blocks}

                return output

            except ValueError as ve:
                logger.warning(f"SkillRunner: Skill not found or invalid: {ve}")
                return {"error": f"Skill '{skill_id}' execution failed: {ve!s}"}
            except Exception as e:
                logger.error(f"SkillRunner: Execution error: {e}", exc_info=True)
                return {"error": f"Skill execution error: {e!s}"}

    async def _build_ui_blocks(
        self,
        *,
        result: dict[str, Any],
        skill_id: str,
        user_id: str | uuid.UUID | None,
        ctx: Any,
        session: Any,
    ) -> list[dict[str, Any]]:
        raw_blocks = result.get("render_blocks")
        if not isinstance(raw_blocks, list) or not raw_blocks:
            return []

        renderer_url: str | None = None
        user_uuid: uuid.UUID | None = None
        try:
            if user_id is not None:
                user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        except Exception:
            user_uuid = None

        if user_uuid is not None:
            try:
                ui_gateway_service = PluginUiGatewayService(session)
                base_url = ""
                if ctx and hasattr(ctx, "get"):
                    base_url = str(ctx.get("request", "base_url", "") or "").rstrip("/")
                if base_url:
                    issued = await ui_gateway_service.issue_renderer_session(
                        user_id=user_uuid,
                        skill_id=skill_id,
                        base_url=base_url,
                    )
                    renderer_url = issued.renderer_url
            except Exception as exc:
                logger.warning(
                    "SkillRunner: failed to issue renderer_url skill_id=%s user_id=%s err=%s",
                    skill_id,
                    user_uuid,
                    exc,
                )

        normalized: list[dict[str, Any]] = []
        for item in raw_blocks:
            if not isinstance(item, dict):
                continue
            payload = item.get("payload")
            if payload is None:
                payload = {}
            metadata = item.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
            metadata = dict(metadata)
            metadata.setdefault("skill_id", skill_id)
            source_view_type = str(item.get("view_type") or item.get("viewType") or "").strip()
            if source_view_type:
                metadata.setdefault("plugin_view_type", source_view_type)
            view_type = source_view_type or "plugin.iframe"
            if renderer_url:
                metadata["renderer_url"] = renderer_url
                view_type = "plugin.iframe"

            block: dict[str, Any] = {
                "type": "ui",
                "view_type": view_type,
                "viewType": view_type,
                "payload": payload,
                "metadata": metadata,
            }
            title = item.get("title")
            if title is not None:
                block["title"] = title
            normalized.append(block)
        return normalized
