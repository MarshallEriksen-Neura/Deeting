import logging
import asyncio
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.models.assistant import Assistant, AssistantVersion
from app.services.assistant.skill_resolver import resolve_skill_refs
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.services.assistant.assistant_retrieval_service import AssistantRetrievalService
from app.services.orchestrator.registry import step_registry
from app.services.vector.qdrant_user_service import QdrantUserVectorService
from app.services.workflow.steps.base import BaseStep, StepResult, StepStatus

if TYPE_CHECKING:
    from app.services.orchestrator.context import WorkflowContext

logger = logging.getLogger(__name__)


@step_registry.register
class SemanticKernelStep(BaseStep):
    """
    Semantic Kernel Active Injection Step.

    Responsibilities:
    - Active Perception: Embed user query and search for relevant memories/context.
    - Context Injection: Inject high-relevance memories into the context *before* LLM generation.
    - (Future) Persona Adaptation: Switch system prompt based on intent.

    This enables "One-Shot" answers where the model already knows the context,
    without needing a tool call round-trip.
    """

    name = "semantic_kernel"
    depends_on = ["validation", "mcp_discovery"]  # Runs after we know the user and tools

    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """Execute semantic kernel perception loop."""
        # 1. Check Prerequisites
        if not qdrant_is_configured():
            self._log_usage_summary(ctx, reason="qdrant_disabled")
            return StepResult(status=StepStatus.SUCCESS, message="qdrant_disabled")

        user_id = ctx.user_id
        if not user_id:
            self._log_usage_summary(ctx, reason="no_user_id")
            return StepResult(status=StepStatus.SUCCESS, message="no_user_id")

        # 2. Extract Query
        query = ""
        conv_msgs = ctx.get("conversation", "merged_messages")
        if isinstance(conv_msgs, list) and conv_msgs:
            for msg in reversed(conv_msgs):
                if msg.get("role") == "user":
                    query = str(msg.get("content") or "").strip()
                    break

        if not query:
            req = ctx.get("validation", "request")
            if req and getattr(req, "messages", None):
                for msg in reversed(req.messages):
                    if msg.role == "user":
                        query = str(msg.content or "").strip()
                        break

        if not query:
            self._log_usage_summary(ctx, reason="no_query")
            return StepResult(status=StepStatus.SUCCESS, message="no_query")

        # 3. Active Perception (Parallel Execution)
        try:
            results = await asyncio.gather(
                self._search_memories(user_id, query),
                self._search_active_persona(ctx, query),
                return_exceptions=True,
            )

            memories, persona = results[0], results[1]

            data = {}

            # Handle Memories
            if isinstance(memories, list) and memories:
                ctx.set("semantic_kernel", "memories", memories)
                data["memory_count"] = len(memories)
                logger.info(
                    f"SemanticKernel: Injected {len(memories)} memories for user={user_id}"
                )

            # Handle Persona
            if isinstance(persona, dict) and persona:
                ctx.set("semantic_kernel", "active_persona", persona)
                data["active_persona"] = persona.get("name")
                logger.info(
                    f"SemanticKernel: Activated persona '{persona.get('name')}' (Score: {persona.get('score')})"
                )

                # Inject skill_refs tools into mcp_discovery.tools
                skill_tools = persona.get("skill_tools", [])
                if skill_tools:
                    existing_tools = ctx.get("mcp_discovery", "tools") or []
                    existing_names = {t.name for t in existing_tools}
                    new_tools = [t for t in skill_tools if t.name not in existing_names]
                    existing_tools.extend(new_tools)
                    ctx.set("mcp_discovery", "tools", existing_tools)
                    data["injected_skill_tools"] = len(new_tools)
                    logger.info(
                        f"SemanticKernel: Injected {len(new_tools)} skill tools from persona '{persona.get('name')}'"
                    )

            if data:
                ctx.emit_status(
                    stage="perception",
                    step=self.name,
                    state="success",
                    code="kernel.perception_done",
                    meta=data,
                )

            memory_count = len(memories) if isinstance(memories, list) else 0
            persona_info = persona if isinstance(persona, dict) else {}
            self._log_usage_summary(
                ctx,
                reason="perception_done",
                memory_count=memory_count,
                assistant_id=persona_info.get("assistant_id"),
                assistant_name=persona_info.get("name"),
                assistant_score=persona_info.get("score"),
            )

            return StepResult(status=StepStatus.SUCCESS, data=data)

        except Exception as e:
            logger.exception("SemanticKernel: Perception failed")
            self._log_usage_summary(ctx, reason=f"perception_failed:{e}")
            return StepResult(
                status=StepStatus.SUCCESS, message=f"perception_failed: {e}"
            )

    def _log_usage_summary(
        self,
        ctx: "WorkflowContext",
        *,
        reason: str,
        memory_count: int = 0,
        assistant_id: str | None = None,
        assistant_name: str | None = None,
        assistant_score: float | None = None,
    ) -> None:
        memory_used = memory_count > 0
        semantic_assistant_used = bool(assistant_id)
        score_text = (
            f"{assistant_score:.4f}"
            if isinstance(assistant_score, (int, float))
            else ""
        )
        logger.info(
            "semantic_kernel_usage trace_id=%s user_id=%s reason=%s "
            "memory_used=%s memory_count=%s "
            "semantic_assistant_used=%s semantic_assistant_id=%s "
            "semantic_assistant_name=%s semantic_assistant_score=%s",
            ctx.trace_id,
            ctx.user_id or "",
            reason,
            memory_used,
            memory_count,
            semantic_assistant_used,
            assistant_id or "",
            assistant_name or "",
            score_text,
        )

    async def _search_memories(self, user_id: Any, query: str) -> list[dict] | None:
        """Search contextual memories."""
        try:
            client = get_qdrant_client()
            vector_store = QdrantUserVectorService(
                client=client,
                user_id=user_id,
                fail_open=True,
            )
            # Threshold 0.8 ensures we only inject highly relevant context
            return await vector_store.search(query=query, limit=3, score_threshold=0.8)
        except Exception as e:
            logger.warning(f"SemanticKernel: Memory search failed: {e}")
            return None

    async def _search_active_persona(
        self, ctx: "WorkflowContext", query: str
    ) -> dict | None:
        """Search and load active persona if confidence is high."""
        if not ctx.db_session:
            return None

        try:
            retrieval = AssistantRetrievalService(ctx.db_session)
            # Limit 1 because we only want to dominate the persona if it's a very strong match
            candidates = await retrieval.search_candidates(query, limit=1)

            if not candidates:
                return None

            top = candidates[0]
            # High threshold for Active Injection (Passive tool use has lower threshold)
            if top.get("score", 0) < 0.90:
                return None

            assistant_id = top.get("assistant_id")
            if not assistant_id:
                return None

            # Fetch full system prompt and skill_refs
            prompt, skill_refs = await self._fetch_assistant_data(ctx.db_session, assistant_id)
            if not prompt:
                return None

            # Resolve skill_refs to ToolDefinition objects
            skill_tools = []
            if skill_refs:
                try:
                    skill_tools = await resolve_skill_refs(skill_refs)
                except Exception as e:
                    logger.warning(f"SemanticKernel: Failed to resolve skill_refs: {e}")

            return {
                "name": top.get("name"),
                "prompt": prompt,
                "score": top.get("score"),
                "assistant_id": assistant_id,
                "skill_tools": skill_tools,
            }
        except Exception as e:
            logger.warning(f"SemanticKernel: Persona search failed: {e}")
            return None

    async def _fetch_assistant_data(
        self, session: Any, assistant_id: str
    ) -> tuple[str | None, list | None]:
        """Fetch the system prompt and skill_refs for an assistant."""
        try:
            stmt = (
                select(AssistantVersion.system_prompt, AssistantVersion.skill_refs)
                .join(Assistant, Assistant.current_version_id == AssistantVersion.id)
                .where(Assistant.id == assistant_id)
            )
            result = await session.execute(stmt)
            row = result.first()
            if not row:
                return None, None
            return row[0], row[1]
        except Exception:
            return None, None
