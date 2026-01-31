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
        logger.info(f"Scout returned {len(artifacts_data)} artifacts. Ingesting...")
        
        saved_ids = []
        for item in artifacts_data:
            try:
                meta = item.get("metadata", {})
                meta["depth"] = item.get("depth")
                
                artifact = await self._save_and_index_artifact(
                    item["url"],
                    item["markdown"],
                    artifact_type,
                    meta,
                    title=item.get("title"),
                    embedding_config=embedding_config
                )
                saved_ids.append(str(artifact.id))
            except Exception as e:
                logger.error(f"Failed to save artifact {item['url']}: {e}")
                
        return {
            "status": "success",
            "seed_url": seed_url,
            "total_pages": len(artifacts_data),
            "ingested_ids": saved_ids,
            "topology": result.get("topology")
        }

    async def _save_and_index_artifact(
        self, 
        url: str, 
        markdown: str, 
        artifact_type: str, 
        meta_info: Dict[str, Any],
        title: Optional[str] = None,
        embedding_config: Optional[Dict[str, Any]] = None
    ) -> KnowledgeArtifact:
        """Helper to deduplicate logic"""
        content_hash = hashlib.md5(markdown.encode()).hexdigest()

        # Determine which model will be used
        # Note: Even if config is None, EmbeddingService defaults to settings.EMBEDDING_MODEL
        # We try to resolve it here for the DB record.
        model_name = getattr(settings, "EMBEDDING_MODEL", "text-embedding-3-small")
        if embedding_config and embedding_config.get("model"):
            model_name = embedding_config["model"]

        existing = await self.repo.get_artifact_by_url(url)
        if existing:
            # If content hash AND model matches, skip.
            # If model changed, we must re-process even if content is same.
            if existing.content_hash == content_hash and existing.embedding_model == model_name:
                logger.info(f"Content for {url} unchanged and model matches. Skipping.")
                return existing
            
            # Update existing
            artifact = await self.repo.update(existing, {
                "raw_content": markdown,
                "content_hash": content_hash,
                "status": "processing",
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
                "status": "processing",
                "meta_info": meta_info,
                "title": title,
                "embedding_model": model_name
            })

        # Trigger Indexing Task (Celery) with Dynamic Config
        index_knowledge_artifact_task.delay(str(artifact.id), embedding_config)
        
        return artifact