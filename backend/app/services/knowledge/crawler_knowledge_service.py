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

    async def trigger_recon_mission(
        self, 
        url: str, 
        artifact_type: str = "documentation",
        js_mode: bool = True
    ) -> KnowledgeArtifact:
        """
        1. Send Scout to the URL (Single Page).
        2. Save Raw Intelligence as KnowledgeArtifact.
        3. Trigger Async Indexing.
        """
        logger.info(f"Triggering recon mission for: {url}")
        
        # 1. Call Scout
        scout_url = f"{settings.SCOUT_SERVICE_URL}/v1/scout/inspect"
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    scout_url, 
                    json={"url": url, "js_mode": js_mode},
                    timeout=120.0
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.error(f"Scout mission failed: {e}")
                raise Exception(f"Failed to communicate with Scout: {str(e)}")

        if data.get("status") == "failed":
            raise Exception(f"Scout reported failure: {data.get('error')}")

        return await self._save_and_index_artifact(
            url, 
            data.get("markdown", ""), 
            artifact_type, 
            data.get("metadata", {})
        )

    async def ingest_deep_dive(
        self, 
        seed_url: str, 
        max_depth: int = 2, 
        max_pages: int = 20,
        artifact_type: str = "documentation"
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
                # Merge deep dive metadata (like depth) with page metadata
                meta = item.get("metadata", {})
                meta["depth"] = item.get("depth")
                
                artifact = await self._save_and_index_artifact(
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
        title: Optional[str] = None
    ) -> KnowledgeArtifact:
        """Helper to deduplicate logic"""
        content_hash = hashlib.md5(markdown.encode()).hexdigest()

        existing = await self.repo.get_artifact_by_url(url)
        if existing:
            if existing.content_hash == content_hash:
                logger.info(f"Content for {url} unchanged. Skipping.")
                return existing
            
            # Update existing
            artifact = await self.repo.update(existing, {
                "raw_content": markdown,
                "content_hash": content_hash,
                "status": "processing",
                "meta_info": meta_info,
                "title": title or existing.title
            })
        else:
            artifact = await self.repo.create_artifact({
                "source_url": url,
                "raw_content": markdown,
                "content_hash": content_hash,
                "artifact_type": artifact_type,
                "status": "processing",
                "meta_info": meta_info,
                "title": title
            })

        # Trigger Indexing Task (Celery)
        index_knowledge_artifact_task.delay(str(artifact.id))
        
        return artifact

    async def get_artifact_status(self, artifact_id: uuid.UUID) -> Dict[str, Any]:
        artifact = await self.repo.get(artifact_id)
        if not artifact:
            return {"status": "not_found"}
        
        return {
            "id": str(artifact.id),
            "url": artifact.source_url,
            "status": artifact.status,
            "type": artifact.artifact_type,
            "updated_at": artifact.updated_at
        }