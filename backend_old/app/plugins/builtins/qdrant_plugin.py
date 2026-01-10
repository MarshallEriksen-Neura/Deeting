import asyncio
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import ValidationError

from app.auth import AuthenticatedAPIKey
from app.http_client import CurlCffiClient
from app.models import APIKey, User
from app.plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.qdrant_client import get_qdrant_client
from app.redis_client import get_redis_client
from app.services.knowledge_pipeline import ingest_chunks
from app.services.project_eval_config_service import (
    DEFAULT_PROVIDER_SCOPES,
    get_effective_provider_ids_for_user,
    get_or_default_project_eval_config,
)
from app.services.system_config_service import get_kb_global_embedding_logical_model


class QdrantPlugin(AgentPlugin):
    """
    Qdrant 向量存储插件。
    提供知识库入库（Ingest）和检索（Query - 未来扩展）能力。
    """

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="core.vector_store.qdrant",
            version="1.0.0",
            description="Provides Qdrant vector database capabilities for knowledge base ingestion and retrieval.",
            author="Gemini CLI",
            dependencies=[]
        )

    def on_activate(self) -> None:
        self.context.get_logger().info("QdrantPlugin activated.")
        # 在这里可以检查 Qdrant 连接是否正常，但为了加快启动速度，通常留到调用时检查
        pass

    def get_tools(self) -> List[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "ingest_knowledge_chunks",
                    "description": "Ingest text chunks into Qdrant vector database.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {"type": "string", "description": "User UUID"},
                            "api_key_id": {"type": "string", "description": "API Key UUID"},
                            "chunks": {
                                "type": "array",
                                "items": {"type": "object"},
                                "description": "List of chunks (text + metadata)"
                            },
                            "collection_name": {"type": "string", "description": "Target collection name (optional)"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags"},
                            "task_id": {"type": "string", "description": "Associated task ID (optional)"},
                            "source_type": {"type": "string", "description": "Source type e.g. 'file', 'url'"},
                            "metadata": {"type": "object", "description": "Additional global metadata"}
                        },
                        "required": ["user_id", "api_key_id", "chunks"]
                    }
                }
            }
        ]

    def handle_ingest_knowledge_chunks(
        self,
        user_id: str,
        api_key_id: str,
        chunks: List[dict],
        collection_name: Optional[str] = None,
        tags: Optional[List[str]] = None,
        task_id: Optional[str] = None,
        source_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """
        Handler for the 'ingest_knowledge_chunks' tool.
        """
        logger = self.context.get_logger()
        db = self.context.get_db_session()
        
        try:
            # 1. Validate User & API Key
            user_uuid = UUID(user_id)
            api_key_uuid = UUID(api_key_id)
            
            user = db.get(User, user_uuid)
            api_key = db.get(APIKey, api_key_uuid)
            
            if not user or not api_key:
                raise ValueError("User or API Key not found")
            if not user.is_active or not api_key.is_active:
                raise ValueError("User or API Key is inactive")

            # 2. Determine Embedding Model
            embedding_model = (get_kb_global_embedding_logical_model(db) or "").strip()
            if not embedding_model:
                embedding_model = (getattr(api_key, "kb_embedding_logical_model", None) or "").strip()
            if not embedding_model:
                raise ValueError("No embedding model configured")

            # 3. Determine Provider Scopes
            cfg = get_or_default_project_eval_config(db, project_id=UUID(str(api_key.id)))
            effective_provider_ids = get_effective_provider_ids_for_user(
                db,
                user_id=user_uuid,
                api_key=api_key,
                provider_scopes=list(getattr(cfg, "provider_scopes", None) or DEFAULT_PROVIDER_SCOPES),
            )

            # 4. Construct Auth Object
            auth_key = AuthenticatedAPIKey(
                id=api_key_uuid,
                user_id=user_uuid,
                user_username=str(user.username or ""),
                is_superuser=bool(user.is_superuser),
                name=str(api_key.name or ""),
                is_active=bool(api_key.is_active),
                disabled_reason=getattr(api_key, "disabled_reason", None),
                has_provider_restrictions=bool(api_key.has_provider_restrictions),
                allowed_provider_ids=list(api_key.allowed_provider_ids),
            )

            # 5. Get Clients
            # Note: For strict isolation, these should be injected or created via context.
            # But for a built-in plugin, using the app's standard getters is acceptable for now.
            redis = get_redis_client()
            qdrant = get_qdrant_client()
            
            target_collection = (
                collection_name
                or str(self.context.get_config("qdrant_kb_system_collection", "kb_system") or "kb_system").strip()
                or "kb_system"
            )

            # 6. Run Async Ingestion Logic
            async def _run():
                async with CurlCffiClient(timeout=60.0, impersonate="chrome120", trust_env=True) as client:
                    return await ingest_chunks(
                        db=db,
                        redis=redis,
                        client=client,
                        qdrant=qdrant,
                        api_key=auth_key,
                        effective_provider_ids=effective_provider_ids,
                        embedding_logical_model=embedding_model,
                        chunks=chunks,
                        collection_name=target_collection,
                        task_id=task_id,
                        source_type=source_type,
                        tags=tags or [],
                        metadata=metadata or {},
                    )

            result = asyncio.run(_run())
            
            logger.info(f"Ingested {result.get('ingested')} chunks into {target_collection}")
            
            return {
                "ingested": result.get("ingested"),
                "skipped_duplicate": result.get("skipped_duplicate"),
                "failed": result.get("failed"),
                "collection_name": target_collection,
            }

        except ValidationError as ve:
            logger.error(f"Validation error: {ve}")
            raise ValueError(str(ve)) from ve
        except Exception as e:
            logger.exception("Qdrant ingestion failed")
            raise RuntimeError(str(e)) from e
        finally:
            db.close()
