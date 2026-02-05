import logging
import asyncio
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.models.assistant import Assistant, AssistantVersion
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
            return StepResult(status=StepStatus.SUCCESS, message="qdrant_disabled")

        user_id = ctx.user_id
        if not user_id:
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

            if data:
                ctx.emit_status(
                    stage="perception",
                    step=self.name,
                    state="success",
                    code="kernel.perception_done",
                    meta=data,
                )

            return StepResult(status=StepStatus.SUCCESS, data=data)

        except Exception as e:
            logger.exception("SemanticKernel: Perception failed")
            return StepResult(
                status=StepStatus.SUCCESS, message=f"perception_failed: {e}"
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
                
            # Fetch full system prompt
            prompt = await self._fetch_system_prompt(ctx.db_session, assistant_id)
            if not prompt:
                return None
                
            return {
                "name": top.get("name"),
                "prompt": prompt,
                "score": top.get("score"),
                "assistant_id": assistant_id
            }
        except Exception as e:
            logger.warning(f"SemanticKernel: Persona search failed: {e}")
            return None

    async def _fetch_system_prompt(self, session: Any, assistant_id: str) -> str | None:
        """Fetch the system prompt for an assistant."""
        try:
            stmt = (
                select(AssistantVersion.system_prompt)
                .join(Assistant, Assistant.current_version_id == AssistantVersion.id)
                .where(Assistant.id == assistant_id)
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()
        except Exception:
            return None
