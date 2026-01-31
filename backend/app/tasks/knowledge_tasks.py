import asyncio
import uuid
import re
import hashlib
from typing import List, Dict, Any, Optional
from loguru import logger
import httpx

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.repositories.knowledge_repository import KnowledgeRepository
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_store import upsert_points, ensure_collection_vector_size

# --- Light Markdown Chunker (Sync/Util) ---
class MarkdownChunker:
    def split_text(self, text: str, source_url: str) -> List[Dict[str, Any]]:
        lines = text.split('\n')
        chunks = []
        current_chunk = []
        current_header = "Introduction"
        code_block_open = False
        
        for line in lines:
            if line.strip().startswith('```'):
                code_block_open = not code_block_open
                current_chunk.append(line)
                continue
            
            if not code_block_open and re.match(r'^#{1,3}\s', line):
                if current_chunk:
                    chunk_text = '\n'.join(current_chunk).strip()
                    if len(chunk_text) > 50:
                        chunks.append({"content": chunk_text, "header": current_header})
                current_header = line.strip().lstrip('#').strip()
                current_chunk = [line]
            else:
                current_chunk.append(line)
        
        if current_chunk:
            chunk_text = '\n'.join(current_chunk).strip()
            if len(chunk_text) > 50:
                chunks.append({"content": chunk_text, "header": current_header})
                
        return chunks

chunker = MarkdownChunker()

# --- Celery Task ---

@celery_app.task(name="app.tasks.knowledge.index_knowledge_artifact_task")
def index_knowledge_artifact_task(artifact_id: str, embedding_config: Optional[Dict[str, Any]] = None):
    """
    Background task to process, chunk, embed and index a knowledge artifact.
    Accepts optional embedding_config to override system defaults (passed from API).
    """
    # Celery tasks are sync by default, but we need async for DB/Qdrant
    return asyncio.run(_index_knowledge_artifact_async(artifact_id, embedding_config))

async def _index_knowledge_artifact_async(artifact_id: str, embedding_config: Optional[Dict[str, Any]] = None):
    logger.info(f"Starting indexing for artifact: {artifact_id}")
    
    async with AsyncSessionLocal() as session:
        repo = KnowledgeRepository(session)
        artifact = await repo.get(uuid.UUID(artifact_id))
        
        if not artifact:
            logger.error(f"Artifact {artifact_id} not found in DB.")
            return

        try:
            # 1. Chunking
            chunks_data = chunker.split_text(artifact.raw_content, artifact.source_url)
            logger.info(f"Split artifact into {len(chunks_data)} chunks.")
            
            # 2. Embedding & Vector Sync (Inject Config)
            embedding_service = EmbeddingService(config=embedding_config)
            
            # We use a system-level Qdrant client
            async with httpx.AsyncClient(base_url=settings.QDRANT_URL) as qdrant_client:
                # Ensure collection exists (using system collection name from settings)
                collection_name = settings.QDRANT_KB_SYSTEM_COLLECTION
                
                if not chunks_data:
                    logger.warning(f"No valid chunks for artifact {artifact_id}")
                    await repo.update(artifact, {"status": "indexed"})
                    await session.commit()
                    return

                # Process chunks in batches
                points_to_upsert = []
                
                # Delete old chunks if any (re-indexing)
                await repo.delete_chunks_by_artifact(artifact.id)
                
                for i, c_data in enumerate(chunks_data):
                    content = c_data["content"]
                    header = c_data["header"]
                    
                    # Generate Embedding (using dynamic config)
                    vector = await embedding_service.embed_text(content)
                    
                    # Ensure collection matches vector size
                    await ensure_collection_vector_size(
                        qdrant_client, 
                        collection_name=collection_name, 
                        vector_size=len(vector)
                    )
                    
                    # Create Chunk in DB
                    chunk_id = uuid.uuid4()
                    await repo.create_chunk({
                        "id": chunk_id,
                        "artifact_id": artifact.id,
                        "chunk_index": i,
                        "text_content": content,
                        "metadata_summary": {"header": header},
                        "embedding_id": chunk_id # We use the same UUID for Qdrant Point
                    })
                    
                    points_to_upsert.append({
                        "id": str(chunk_id),
                        "vector": vector,
                        "payload": {
                            "content": content,
                            "source": artifact.source_url,
                            "section": header,
                            "artifact_id": str(artifact.id),
                            "type": artifact.artifact_type
                        }
                    })

                # 3. Upsert to Qdrant
                if points_to_upsert:
                    await upsert_points(
                        qdrant_client,
                        collection_name=collection_name,
                        points=points_to_upsert
                    )
                
            # 4. Finalize
            await repo.update(artifact, {"status": "indexed"})
            await session.commit()
            logger.info(f"Indexing completed for artifact {artifact_id}")
            
        except Exception as e:
            logger.error(f"Failed to index artifact {artifact_id}: {e}")
            meta_info = dict(artifact.meta_info or {})
            meta_info["error"] = str(e)
            await repo.update(
                artifact,
                {
                    "status": "failed",
                    "meta_info": meta_info,
                },
            )
            await session.commit()
            raise
