import uuid
import httpx
from typing import Optional, Dict, Any, List
from loguru import logger
import hashlib

from app.core.config import settings
from app.repositories.knowledge_repository import KnowledgeRepository
from app.models.knowledge import KnowledgeArtifact
from app.tasks.knowledge_tasks import index_knowledge_artifact_task

class CrawlerKnowledgeService:
    """
    Service to manage knowledge ingestion from Scout.
    Connects the Brain (Backend) with the Sensors (Scout).
    """

    def __init__(self, repository: KnowledgeRepository):
        self.repo = repository

    async def ingest_deep_dive(
        self, 
        seed_url: str, 
        max_depth: int = 2, 
        max_pages: int = 20,
        artifact_type: str = "documentation",
        embedding_config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Trigger a Deep Dive on Scout and ingest ALL returned artifacts.
        """
        logger.info(f"Triggering Deep Dive for: {seed_url}")
        
        scout_url = f"{settings.SCOUT_SERVICE_URL}/v1/scout/deep-dive"
        async with httpx.AsyncClient() as client:
            try:
                # High timeout for deep dives
                resp = await client.post(
                    scout_url, 
                    json={"url": seed_url, "max_depth": max_depth, "max_pages": max_pages},
                    timeout=600.0 
                )
                resp.raise_for_status()
                result = resp.json()
            except Exception as e:
                logger.error(f"Scout Deep Dive failed: {e}")
                raise Exception(f"Failed to communicate with Scout: {str(e)}")
        
        if result.get("status") != "completed":
             raise Exception(f"Scout failed to complete deep dive: {result}")

        artifacts_data = result.get("artifacts", [])
        logger.info(f"Scout returned {len(artifacts_data)} artifacts. Ingesting to Review Buffer...")
        
        saved_ids = []
        for item in artifacts_data:
            try:
                meta = item.get("metadata", {})
                meta["depth"] = item.get("depth")
                
                # Store potential embedding config in meta for later use during approval
                if embedding_config:
                    meta["_embedding_config"] = embedding_config

                artifact = await self._save_to_review_buffer(
                    item["url"],
                    item["markdown"],
                    artifact_type,
                    meta,
                    title=item.get("title")
                )
                saved_ids.append(str(artifact.id))
            except Exception as e:
                logger.error(f"Failed to save artifact {item['url']}: {e}")
                
        return {
            "status": "success",
            "message": "Content captured and waiting for review.",
            "seed_url": seed_url,
            "total_pages": len(artifacts_data),
            "review_ids": saved_ids,
            "topology": result.get("topology")
        }

    async def _save_to_review_buffer(
        self, 
        url: str, 
        markdown: str, 
        artifact_type: str, 
        meta_info: Dict[str, Any],
        title: Optional[str] = None
    ) -> KnowledgeArtifact:
        """
        Save content to DB but DO NOT trigger indexing.
        Status set to 'pending_review'.
        """
        content_hash = hashlib.md5(markdown.encode()).hexdigest()
        
        # We record the intended model but don't use it yet
        model_name = getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")

        existing = await self.repo.get_artifact_by_url(url)
        if existing:
            # If content hasn't changed, we might still want to put it in review if it was rejected before?
            # For now, if it's already indexed and same hash, we skip.
            if existing.content_hash == content_hash and existing.status == "indexed":
                logger.info(f"Content for {url} unchanged and already indexed. Skipping.")
                return existing
            
            # Update existing to pending_review
            artifact = await self.repo.update(existing, {
                "raw_content": markdown,
                "content_hash": content_hash,
                "status": "pending_review", # <--- CRITICAL CHANGE
                "meta_info": meta_info,
                "title": title or existing.title,
                "embedding_model": model_name
            })
        else:
            artifact = await self.repo.create_artifact({
                "source_url": url,
                "raw_content": markdown,
                "content_hash": content_hash,
                "artifact_type": artifact_type,
                "status": "pending_review", # <--- CRITICAL CHANGE
                "meta_info": meta_info,
                "title": title,
                "embedding_model": model_name
            })

        return artifact

    # --- Review Actions ---

    async def approve_artifact(self, artifact_id: uuid.UUID) -> KnowledgeArtifact:
        """
        Admin approves the artifact. Trigger indexing.
        """
        artifact = await self.repo.get(artifact_id)
        if not artifact:
            raise Exception("Artifact not found")
        
        # Retrieve stored config if any
        embedding_config = artifact.meta_info.get("_embedding_config")
        
        # Update status
        updated = await self.repo.update(artifact, {"status": "processing"})
        
        # Trigger Task
        index_knowledge_artifact_task.delay(str(updated.id), embedding_config)
        
        return updated

    async def reject_artifact(self, artifact_id: uuid.UUID) -> None:
        """
        Admin rejects the artifact. Delete it.
        """
        artifact = await self.repo.get(artifact_id)
        if not artifact:
            return # Already gone
            
        await self.repo.delete(artifact.id)
