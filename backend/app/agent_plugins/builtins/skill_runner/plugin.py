import base64
import binascii
import json
import logging
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.plugin_ui_gateway_service import PluginUiGatewayService
from app.services.oss.asset_storage_service import build_signed_asset_url, store_asset_bytes

logger = logging.getLogger(__name__)
_MAX_ARTIFACT_UI_BLOCKS = 3
_MAX_INLINE_TEXT_PREVIEW_CHARS = 12000


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
                    trace_id=getattr(ctx, "trace_id", None),
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
                    # 核心修复：如果当前有上下文，主动推送渲染指令，确保嵌套调用时 UI 也能冒泡
                    if ctx and hasattr(ctx, "push_blocks"):
                        for block in ui_blocks:
                            await ctx.push_blocks(block)
                        logger.info(f"SkillRunner: Pushed {len(ui_blocks)} UI blocks to active context.")

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
        if not isinstance(raw_blocks, list):
            raw_blocks = []
        artifacts = result.get("artifacts")
        if not isinstance(artifacts, list):
            artifacts = []
        if not raw_blocks and not artifacts:
            return []

        base_url = self._resolve_request_base_url(ctx)

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
        normalized.extend(
            await self._build_artifact_ui_blocks(
                artifacts=artifacts, skill_id=skill_id, base_url=base_url
            )
        )
        return normalized

    @staticmethod
    def _resolve_request_base_url(ctx: Any) -> str:
        if ctx and hasattr(ctx, "get"):
            return str(ctx.get("request", "base_url", "") or "").rstrip("/")
        return ""

    @staticmethod
    def _resolve_artifact_name(artifact: dict[str, Any], index: int) -> str:
        name = str(artifact.get("name") or "").strip()
        if name:
            return name
        path = str(artifact.get("path") or "").strip()
        if path:
            return Path(path).name
        return f"artifact-{index + 1}"

    @staticmethod
    def _guess_artifact_content_type(artifact: dict[str, Any], artifact_name: str) -> str:
        explicit = str(artifact.get("content_type") or "").strip()
        if explicit:
            return explicit
        path_hint = str(artifact.get("path") or artifact_name).strip()
        guessed, _ = mimetypes.guess_type(path_hint)
        return guessed or "application/octet-stream"

    @staticmethod
    def _resolve_preview_kind(*, artifact_name: str, content_type: str) -> str:
        suffix = Path(artifact_name).suffix.lower()
        lower_type = content_type.lower()
        if suffix in {".html", ".htm"} or lower_type.startswith("text/html"):
            return "html"
        if suffix in {".md", ".markdown"} or "markdown" in lower_type:
            return "markdown"
        if (
            lower_type.startswith("text/")
            or suffix in {".txt", ".json", ".csv"}
            or lower_type == "application/json"
        ):
            return "text"
        return "none"

    @staticmethod
    def _extract_text_preview(
        raw_bytes: bytes,
        *,
        preview_kind: str,
        content_type: str,
    ) -> tuple[str | None, bool]:
        if preview_kind not in {"text", "markdown", "html"}:
            return None, False
        text = ""
        for encoding in ("utf-8", "utf-16", "gb18030"):
            try:
                text = raw_bytes.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if not text:
            text = raw_bytes.decode("utf-8", errors="ignore")

        if preview_kind == "text" and content_type.lower() == "application/json":
            try:
                parsed = json.loads(text)
                text = json.dumps(parsed, ensure_ascii=False, indent=2)
            except Exception:
                pass

        truncated = len(text) > _MAX_INLINE_TEXT_PREVIEW_CHARS
        if truncated:
            text = text[:_MAX_INLINE_TEXT_PREVIEW_CHARS]
        return text, truncated

    async def _build_artifact_ui_blocks(
        self,
        *,
        artifacts: list[Any],
        skill_id: str,
        base_url: str,
    ) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        for index, raw_item in enumerate(artifacts):
            if len(blocks) >= _MAX_ARTIFACT_UI_BLOCKS:
                break
            if not isinstance(raw_item, dict):
                continue

            artifact_name = self._resolve_artifact_name(raw_item, index)
            content_b64 = str(raw_item.get("content_base64") or "").strip()
            if not content_b64:
                continue

            try:
                raw_bytes = base64.b64decode(content_b64, validate=True)
            except binascii.Error:
                try:
                    raw_bytes = base64.b64decode(content_b64)
                except Exception:
                    logger.warning(
                        "SkillRunner: failed to decode artifact base64 skill_id=%s artifact=%s",
                        skill_id,
                        artifact_name,
                    )
                    continue

            content_type = self._guess_artifact_content_type(raw_item, artifact_name)
            try:
                stored = await store_asset_bytes(
                    raw_bytes,
                    content_type=content_type,
                    kind="skill-artifacts",
                )
                download_url = build_signed_asset_url(
                    stored.object_key,
                    base_url=base_url or None,
                )
            except Exception as exc:
                logger.warning(
                    "SkillRunner: failed to store artifact skill_id=%s artifact=%s err=%s",
                    skill_id,
                    artifact_name,
                    exc,
                )
                continue

            preview_kind = self._resolve_preview_kind(
                artifact_name=artifact_name, content_type=content_type
            )
            preview_text, truncated = self._extract_text_preview(
                raw_bytes,
                preview_kind=preview_kind,
                content_type=content_type,
            )

            payload: dict[str, Any] = {
                "name": artifact_name,
                "path": str(raw_item.get("path") or artifact_name),
                "size": int(raw_item.get("size") or len(raw_bytes) or 0),
                "content_type": content_type,
                "download_url": download_url,
                "preview_kind": preview_kind,
            }
            if preview_text is not None:
                payload["preview_text"] = preview_text
            if truncated:
                payload["truncated"] = True

            blocks.append(
                {
                    "type": "ui",
                    "view_type": "generated.file",
                    "viewType": "generated.file",
                    "title": artifact_name,
                    "payload": payload,
                    "metadata": {
                        "skill_id": skill_id,
                        "artifact_type": str(raw_item.get("type") or "file"),
                    },
                }
            )
        return blocks
