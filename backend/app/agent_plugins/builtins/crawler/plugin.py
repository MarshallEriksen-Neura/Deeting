import uuid
from typing import Any

from celery.result import AsyncResult

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.http_client import create_async_http_client


class CrawlerPlugin(AgentPlugin):
    """
    Web Crawler Plugin (Remote Scout Adapter).
    Delegates crawl tasks to the 'Deeting Scout' microservice.
    Provides atomic capabilities for single-page inspection and full-site deep dives.
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.tools.crawler",
            version="2.5.0",  # Added repo ingestion polling tool
            description="Provides web crawling capabilities via Deeting Scout Service.",
            author="Gemini CLI",
        )

    def get_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_web_content",
                    "description": "Fetch and extract content from a SINGLE URL. Use this for quick lookups.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "The target URL to crawl.",
                            },
                            "js_mode": {
                                "type": "boolean",
                                "default": True,
                                "description": "Whether to render JavaScript (slower but more accurate).",
                            },
                        },
                        "required": ["url"],
                    },
                    "output_description": "Returns a dict containing 'markdown' (primary content), 'title', and 'status'.",
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string", "enum": ["success", "error"]},
                            "markdown": {"type": "string", "description": "The extracted main content in markdown format."},
                            "content": {"type": "string", "description": "Alias for markdown content for compatibility."},
                            "title": {"type": "string", "description": "The page title."},
                            "metadata": {"type": "object"}
                        }
                    }
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "crawl_website",
                    "description": "Recursively crawl a website. CRITICAL: If the user intent is to 'learn', 'clone' or 'register' a new assistant/skill from a URL, you MUST follow up by calling 'convert_artifact_to_assistant' with the returned IDs.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "The root URL to start crawling from.",
                            },
                            "max_depth": {
                                "type": "integer",
                                "default": 2,
                                "description": "How deep to follow links.",
                            },
                            "max_pages": {
                                "type": "integer",
                                "default": 20,
                                "description": "Maximum number of pages to ingest.",
                            },
                        },
                        "required": ["url"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "submit_repo_ingestion",
                    "description": "Ingest a skill repository and build a skill manifest asynchronously.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "repo_url": {
                                "type": "string",
                                "description": "Git repository URL to ingest.",
                            },
                            "revision": {
                                "type": "string",
                                "default": "main",
                                "description": "Git branch/tag/commit to ingest.",
                            },
                            "skill_id": {
                                "type": "string",
                                "description": "Optional skill ID to use when persisting.",
                            },
                            "runtime_hint": {
                                "type": "string",
                                "description": "Optional runtime hint (e.g. python_library, node_library).",
                            },
                        },
                        "required": ["repo_url"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "poll_repo_ingestion",
                    "description": "Poll status for a repository ingestion task submitted by submit_repo_ingestion.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "task_id": {
                                "type": "string",
                                "description": "Task ID returned by submit_repo_ingestion.",
                            }
                        },
                        "required": ["task_id"],
                    },
                    "output_description": "Returns task state, readiness, and final result or error when available.",
                    "output_schema": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "enum": ["queued", "running", "completed", "failed", "error"],
                            },
                            "task_id": {"type": "string"},
                            "state": {"type": "string"},
                            "ready": {"type": "boolean"},
                            "successful": {"type": "boolean"},
                            "result": {"type": "object"},
                            "error": {"type": "string"},
                        },
                        "required": ["status", "task_id", "state", "ready"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "convert_artifact_to_assistant",
                    "description": "Convert one crawled Knowledge Artifact into a single structured AI Assistant.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "artifact_id": {
                                "type": "string",
                                "description": "The UUID of the ingested Knowledge Artifact.",
                            },
                            "target_scope": {
                                "type": "string",
                                "enum": ["user", "system"],
                                "default": "user",
                                "description": "Storage scope for the generated assistant. 'system' requires superuser.",
                            },
                        },
                        "required": ["artifact_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "batch_convert_artifact_to_assistants",
                    "description": "Split one crawled Knowledge Artifact into multiple structured AI Assistants.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "artifact_id": {
                                "type": "string",
                                "description": "The UUID of the ingested Knowledge Artifact.",
                            },
                            "max_assistants": {
                                "type": "integer",
                                "default": 20,
                                "description": "Maximum number of assistants to create in this batch run.",
                            },
                            "target_scope": {
                                "type": "string",
                                "enum": ["user", "system"],
                                "default": "user",
                                "description": "Storage scope for generated assistants. 'system' requires superuser.",
                            },
                        },
                        "required": ["artifact_id"],
                    },
                },
            },
        ]

    async def _resolve_owner_user_id(
        self,
        *,
        target_scope: str,
        session,
    ) -> uuid.UUID | None:
        scope = (target_scope or "user").strip().lower()
        if scope not in {"user", "system"}:
            raise ValueError("target_scope must be 'user' or 'system'")
        if scope == "user":
            return self.context.user_id

        actor_user_id = self.context.user_id
        if not actor_user_id:
            raise PermissionError("system scope requires authenticated user context")

        from app.repositories.user_repository import UserRepository

        user_repo = UserRepository(session)
        actor = await user_repo.get_by_id(actor_user_id)
        if not actor or not actor.is_superuser:
            raise PermissionError("Only superuser can write assistants to system scope")
        return None

    async def handle_fetch_web_content(
        self, url: str, js_mode: bool = True, **kwargs
    ) -> dict[str, Any]:
        """
        Tool Handler: Single Page Inspection (Stateless).
        Directly calls Scout API for speed.
        """
        logger = self.context.get_logger()
        scout_url = f"{settings.SCOUT_SERVICE_URL}/v1/scout/inspect"

        logger.info(f"Dispatching Scout to: {url}")

        try:
            async with create_async_http_client() as client:
                response = await client.post(
                    scout_url, json={"url": url, "js_mode": js_mode}, timeout=60.0
                )
                response.raise_for_status()
                data = response.json()

                if data.get("status") == "failed":
                    return {"status": "error", "error": data.get("error")}

                markdown = data.get("markdown")
                return {
                    "status": "success",
                    "title": data.get("metadata", {}).get("title"),
                    "markdown": markdown,
                    "content": markdown,  # Added for compatibility with AI expectations
                    "metadata": data.get("metadata"),
                }
        except Exception as e:
            return {"status": "error", "error": f"Scout Service Unavailable: {e!s}"}

    async def handle_crawl_website(
        self, url: str, max_depth: int = 2, max_pages: int = 20, **kwargs
    ) -> dict[str, Any]:
        """
        Tool Handler: Deep Dive Ingestion (Stateful).
        Calls internal Service to ensure data persistence.
        """
        from app.repositories.knowledge_repository import KnowledgeRepository
        from app.services.knowledge.crawler_knowledge_service import (
            CrawlerKnowledgeService,
        )

        logger = self.context.get_logger()
        logger.info(f"Starting Deep Dive Ingestion for: {url}")

        async with AsyncSessionLocal() as session:
            repo = KnowledgeRepository(session)
            service = CrawlerKnowledgeService(repo)

            try:
                result = await service.ingest_deep_dive(
                    seed_url=url,
                    max_depth=max_depth,
                    max_pages=max_pages,
                    artifact_type="assistant",  # Default to assistant type if intention is cloning
                )
                await session.commit() # Commit the changes to persist artifacts
                artifact_ids = result.get("review_ids") or result.get("ingested_ids") or []

                # We return the list of artifact IDs so the Agent can pick one to convert
                return {
                    "status": "success",
                    "message": (
                        f"Successfully ingested {len(artifact_ids)} pages. "
                        "Use 'convert_artifact_to_assistant' for one-by-one conversion "
                        "or 'batch_convert_artifact_to_assistants' for split conversion."
                    ),
                    "artifact_ids": artifact_ids,
                }
            except Exception as e:
                logger.error(f"Deep Dive failed: {e}")
                return {"status": "error", "error": str(e)}

    async def handle_convert_artifact_to_assistant(
        self,
        artifact_id: str,
        target_scope: str = "user",
        **kwargs,
    ) -> dict[str, Any]:
        """
        Tool Handler: Refine Artifact -> Create Assistant -> Sync Qdrant.
        """
        from app.repositories.assistant_repository import (
            AssistantRepository,
            AssistantVersionRepository,
        )
        from app.repositories.knowledge_repository import KnowledgeRepository
        from app.services.assistant.assistant_ingestion_service import (
            AssistantIngestionService,
        )
        from app.services.assistant.assistant_service import AssistantService

        async with AsyncSessionLocal() as session:
            knowledge_repo = KnowledgeRepository(session)
            assistant_service = AssistantService(
                AssistantRepository(session), AssistantVersionRepository(session)
            )
            ingestion_service = AssistantIngestionService(
                assistant_service, knowledge_repo
            )

            try:
                uuid_obj = uuid.UUID(artifact_id)
            except ValueError:
                return {"status": "error", "message": "Invalid Artifact ID format"}

            try:
                owner_user_id = await self._resolve_owner_user_id(
                    target_scope=target_scope,
                    session=session,
                )
                result = await ingestion_service.refine_and_create_assistant(
                    uuid_obj, user_id=owner_user_id
                )
                result["target_scope"] = (
                    "system" if owner_user_id is None else "user"
                )
                await session.commit()
                return result
            except PermissionError as e:
                return {"status": "error", "message": str(e)}
            except ValueError as e:
                return {"status": "error", "message": str(e)}
            except Exception as e:
                self.context.get_logger().error(f"Assistant conversion failed: {e}")
                return {"status": "error", "message": str(e)}

    async def handle_batch_convert_artifact_to_assistants(
        self,
        artifact_id: str,
        max_assistants: int = 20,
        target_scope: str = "user",
        **kwargs,
    ) -> dict[str, Any]:
        """
        Tool Handler: Refine Artifact -> Create Multiple Assistants -> Sync Qdrant.
        """
        from app.repositories.assistant_repository import (
            AssistantRepository,
            AssistantVersionRepository,
        )
        from app.repositories.knowledge_repository import KnowledgeRepository
        from app.services.assistant.assistant_ingestion_service import (
            AssistantIngestionService,
        )
        from app.services.assistant.assistant_service import AssistantService

        async with AsyncSessionLocal() as session:
            knowledge_repo = KnowledgeRepository(session)
            assistant_service = AssistantService(
                AssistantRepository(session), AssistantVersionRepository(session)
            )
            ingestion_service = AssistantIngestionService(
                assistant_service, knowledge_repo
            )

            try:
                uuid_obj = uuid.UUID(artifact_id)
            except ValueError:
                return {"status": "error", "message": "Invalid Artifact ID format"}

            try:
                owner_user_id = await self._resolve_owner_user_id(
                    target_scope=target_scope,
                    session=session,
                )
                result = await ingestion_service.batch_refine_and_create_assistants(
                    uuid_obj,
                    user_id=owner_user_id,
                    max_items=max_assistants,
                )
                result["target_scope"] = (
                    "system" if owner_user_id is None else "user"
                )
                await session.commit()
                return result
            except PermissionError as e:
                return {"status": "error", "message": str(e)}
            except ValueError as e:
                return {"status": "error", "message": str(e)}
            except Exception as e:
                self.context.get_logger().error(
                    f"Batch assistant conversion failed: {e}"
                )
                return {"status": "error", "message": str(e)}

    async def handle_submit_repo_ingestion(
        self,
        repo_url: str,
        revision: str = "main",
        skill_id: str | None = None,
        runtime_hint: str | None = None,
        **kwargs,
    ) -> dict[str, Any]:
        from app.core.celery_app import celery_app

        task = celery_app.send_task(
            "skill_registry.ingest_repo",
            args=[repo_url, revision, skill_id, runtime_hint, str(self.context.user_id)],
        )
        return {"status": "queued", "task_id": task.id}

    async def handle_poll_repo_ingestion(
        self,
        task_id: str,
        **kwargs,
    ) -> dict[str, Any]:
        from app.core.celery_app import celery_app

        task_key = str(task_id or "").strip()
        if not task_key:
            return {"status": "error", "error": "task_id is required"}

        try:
            result = AsyncResult(task_key, app=celery_app)
            state = str(result.state or "PENDING").upper()
            ready = bool(result.ready())
            status = "running"
            if state == "PENDING":
                status = "queued"
            elif state in {"SUCCESS"}:
                status = "completed"
            elif state in {"FAILURE", "REVOKED"}:
                status = "failed"

            payload: dict[str, Any] = {
                "status": status,
                "task_id": task_key,
                "state": state,
                "ready": ready,
            }
            if ready:
                successful = bool(result.successful())
                payload["successful"] = successful
                if successful:
                    payload["result"] = result.result
                else:
                    payload["error"] = str(result.result)
            return payload
        except Exception as exc:
            return {
                "status": "error",
                "task_id": task_key,
                "state": "UNKNOWN",
                "ready": False,
                "error": f"failed to poll repo ingestion task: {exc}",
            }
