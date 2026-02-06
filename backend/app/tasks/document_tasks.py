import asyncio
import io
import uuid
import tempfile
import os
from typing import Any

from loguru import logger
# Text Splitters
from langchain_text_splitters import RecursiveCharacterTextSplitter
# PDF Parsing
import pypdf
# Docx Parsing
import docx

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.media_asset import MediaAsset
from app.models.user_document import UserDocument
from app.qdrant_client import (
    close_qdrant_client_for_current_loop,
    get_qdrant_client,
    qdrant_is_configured,
)
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_points

# --- Configuration ---
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

# --- Celery Task ---
@celery_app.task(name="app.tasks.document.index_user_document_task")
def index_user_document_task(doc_id: str):
    """
    Background task to process, chunk, embed and index a user document.
    """
    return asyncio.run(_index_user_document_async(doc_id))

async def _index_user_document_async(doc_id: str):
    logger.info(f"Starting indexing for user document: {doc_id}")

    async with AsyncSessionLocal() as session:
        # Fetch Document
        doc = await session.get(UserDocument, uuid.UUID(doc_id))
        if not doc:
            logger.error(f"UserDocument {doc_id} not found.")
            return

        # Fetch MediaAsset (to get content)
        asset = await session.get(MediaAsset, doc.media_asset_id)
        if not asset:
             logger.error(f"MediaAsset {doc.media_asset_id} not found for doc {doc_id}.")
             doc.status = "failed"
             doc.error_message = "Linked media asset not found"
             await session.commit()
             return

        try:
            doc.status = "processing"
            await session.commit()

            # 1. Load Content (Download from OSS/Local)
            # NOTE: Assuming we can get a file-like object or bytes.
            # Ideally, use AssetUploadService or similar.
            # For now, we simulate reading from 'object_key' if it's a local path or handled by a service.
            # Since I don't see a direct 'download' method exposed in a simple way, I'll assume we can rely on 
            # standard OSS libraries or Local storage logic.
            # FOR SIMPLICITY/DEMO: Check if object_key is local path (common in dev).
            # If not, we might need to instantiate the OSS client.
            
            # Use a temporary file to handle downloads safely
            with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
                temp_path = tmp_file.name
            
            try:
                # Retrieve content to temp_path
                await _download_asset_to_path(asset, temp_path)
                
                # 2. Parse Content based on MIME type or extension
                raw_text = await _parse_document(temp_path, asset.content_type, doc.filename)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

            if not raw_text.strip():
                logger.warning(f"Document {doc_id} yielded no text.")
                doc.status = "failed"
                doc.error_message = "Empty content after parsing"
                await session.commit()
                return

            # 3. Clean Text (Basic)
            clean_text = _clean_text(raw_text)

            # 4. Chunking (Recursive)
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=CHUNK_SIZE,
                chunk_overlap=CHUNK_OVERLAP,
                separators=["

", "
", "。", ".", " ", ""]
            )
            chunks = splitter.split_text(clean_text)
            logger.info(f"Document {doc_id} split into {len(chunks)} chunks.")

            # 5. Embedding & Upsert
            if not qdrant_is_configured():
                logger.warning("Qdrant not configured, skipping vector indexing.")
                doc.status = "failed"
                doc.error_message = "Qdrant not configured"
                await session.commit()
                return

            # Initialize Embedding Service (System Default)
            embedding_service = EmbeddingService()
            # You might want to store which model was used
            # doc.embedding_model = "default" 

            qdrant_client = get_qdrant_client()
            try:
                # Determine Collection Name (Per User Strategy)
                collection_name = get_kb_user_collection_name(doc.user_id)
                
                points_to_upsert = []
                
                # Embed Loop (Batching could be improved for huge docs)
                for i, text_chunk in enumerate(chunks):
                    vector = await embedding_service.embed_text(text_chunk)
                    
                    # Ensure collection size matches
                    await ensure_collection_vector_size(
                        qdrant_client,
                        collection_name=collection_name,
                        vector_size=len(vector)
                    )

                    # Point ID: Deterministic UUID based on DocID + Index to allow idempotent updates
                    # or simple UUIDv4. Let's use deterministic for safer retries.
                    point_id = str(uuid.uuid5(uuid.UUID(doc_id), str(i)))

                    payload = {
                        "text": text_chunk,
                        "doc_id": str(doc.id),
                        "file_id": str(doc.id), # Alias for compatibility
                        "user_id": str(doc.user_id), # Redundant but safe for filtering
                        "filename": doc.filename,
                        "chunk_index": i,
                        "page": 0, # TODO: specific page number support in parser
                        "source": "user_upload"
                    }

                    points_to_upsert.append({
                        "id": point_id,
                        "vector": vector,
                        "payload": payload
                    })

                if points_to_upsert:
                    await upsert_points(
                        qdrant_client,
                        collection_name=collection_name,
                        points=points_to_upsert
                    )
                
                doc.chunk_count = len(points_to_upsert)
                doc.status = "indexed"
                await session.commit()
                logger.info(f"Successfully indexed document {doc_id}")

            finally:
                await close_qdrant_client_for_current_loop()

        except Exception as e:
            logger.exception(f"Failed to index document {doc_id}")
            doc.status = "failed"
            doc.error_message = str(e)
            await session.commit()

async def _download_asset_to_path(asset: MediaAsset, path: str):
    """
    Download asset content to local path.
    TODO: Integrate with real OSS service.
    For now, assume local storage or basic read if accessible.
    """
    # Quick hack for local dev environment where object_key might be a path
    if os.path.exists(asset.object_key):
         import shutil
         shutil.copy(asset.object_key, path)
         return

    # TODO: Fetch from OSS using asset.object_key
    # from app.services.oss.client import get_oss_client
    # client = get_oss_client()
    # client.download_file(asset.object_key, path)
    
    # Mock behavior for safety if no real OSS
    raise NotImplementedError("OSS Download not implemented in this snippet")

async def _parse_document(path: str, content_type: str, filename: str) -> str:
    """
    Parse document content based on type.
    """
    ext = os.path.splitext(filename)[1].lower()
    
    if ext == ".pdf" or "pdf" in content_type:
        text = []
        try:
            reader = pypdf.PdfReader(path)
            for page in reader.pages:
                text.append(page.extract_text() or "")
            return "
".join(text)
        except Exception as e:
            logger.error(f"PDF parse error: {e}")
            return ""
            
    elif ext in [".docx", ".doc"] or "word" in content_type:
        try:
            doc = docx.Document(path)
            return "
".join([p.text for p in doc.paragraphs])
        except Exception as e:
            logger.error(f"Docx parse error: {e}")
            return ""
            
    else:
        # Fallback to text
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception:
            return ""

def _clean_text(text: str) -> str:
    # Remove null bytes
    text = text.replace("\x00", "")
    # Normalize whitespace (optional, but good for embedding)
    import re
    text = re.sub(r'\s+', ' ', text).strip()
    return text
