from typing import Any, List

import logging

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.services.assistant.assistant_retrieval_service import AssistantRetrievalService

logger = logging.getLogger(__name__)


class ExpertNetworkPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/expert_network",
            version="1.0.0",
            description="Retrieve expert assistants for a given intent query.",
            author="System",
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert assistants by intent query and return top candidates.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": {
                                "type": "string",
                                "description": "The intent or task description to search for expert assistants.",
                            },
                            "k": {
                                "type": "integer",
                                "description": "Number of candidates to return.",
                                "default": 3,
                            },
                        },
                        "required": ["intent_query"],
                    },
                },
            }
        ]

    async def handle_consult_expert_network(
        self,
        intent_query: str,
        k: int = 3,
        __context__=None,
    ) -> list[dict[str, Any]]:
        ctx = __context__
        session = None
        owns_session = False

        if ctx and getattr(ctx, "db_session", None):
            session = ctx.db_session
        else:
            session = self.context.get_db_session()
            owns_session = True

        try:
            service = AssistantRetrievalService(session)
            candidates = await service.search_candidates(intent_query, limit=k)
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("expert network retrieval failed", exc_info=exc)
            candidates = []
        finally:
            if owns_session and session is not None:
                await session.close()

        if ctx is not None:
            ctx.set("assistant", "candidates", candidates)
            if candidates:
                top = candidates[0]
                ctx.set("assistant", "id", str(top.get("assistant_id") or ""))
                ctx.set("assistant", "name", top.get("name"))
                ctx.set("assistant", "summary", top.get("summary"))
                if "system_prompt" in top:
                    ctx.set("assistant", "system_prompt", top.get("system_prompt"))

        return [
            {
                "assistant_id": item.get("assistant_id"),
                "name": item.get("name"),
                "summary": item.get("summary"),
                "score": item.get("score", 0.0),
            }
            for item in candidates
        ]
