from __future__ import annotations

import asyncio
import io
import json
import re
import uuid

import docx
import pypdf
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.models.media_asset import MediaAsset
from app.models.user_document import UserDocument
from app.qdrant_client import (
    close_qdrant_client_for_current_loop,
    get_qdrant_client,
    qdrant_is_configured,
)
from app.services.oss.asset_storage_service import load_asset_bytes
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import get_kb_user_collection_name
from app.storage.qdrant_kb_store import ensure_collection_vector_size, upsert_points

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


@celery_app.task(name="app.tasks.document.index_user_document_task")
def index_user_document_task(doc_id: str):
    """异步处理用户文档：解析、切片、向量化、写入 Qdrant。"""

    return asyncio.run(_index_user_document_async(doc_id))


async def _index_user_document_async(doc_id: str):
    logger.info("user_document_index_start", doc_id=doc_id)

    async with AsyncSessionLocal() as session:
        document = await _load_document(session, doc_id)
        if document is None:
            return

        asset = await session.get(MediaAsset, document.media_asset_id)
        if asset is None:
            await _mark_failed(
                session,
                document,
                "Linked media asset not found",
            )
            return

        try:
            document.status = "processing"
            document.error_message = None
            await session.commit()

            file_bytes, detected_content_type = await load_asset_bytes(asset.object_key)
            raw_text = _parse_document(
                file_bytes,
                content_type=asset.content_type or detected_content_type,
                filename=document.filename,
            )
            clean_text = _clean_text(raw_text)
            if not clean_text:
                await _mark_failed(session, document, "Empty content after parsing")
                return

            splitter = RecursiveCharacterTextSplitter(
                chunk_size=CHUNK_SIZE,
                chunk_overlap=CHUNK_OVERLAP,
                separators=["\n\n", "\n", "。", ".", " ", ""],
            )
            chunks = splitter.split_text(clean_text)
            if not chunks:
                await _mark_failed(session, document, "Chunking produced no content")
                return

            if not qdrant_is_configured():
                await _mark_failed(session, document, "Qdrant not configured")
                return

            embedding_service = EmbeddingService()
            vectors = await embedding_service.embed_documents(chunks)
            if not vectors:
                await _mark_failed(session, document, "Embedding returned empty vectors")
                return

            qdrant_client = get_qdrant_client()
            collection_name = get_kb_user_collection_name(document.user_id)
            await ensure_collection_vector_size(
                qdrant_client,
                collection_name=collection_name,
                vector_size=len(vectors[0]),
            )

            points = []
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=False)):
                point_id = str(uuid.uuid5(document.id, str(index)))
                points.append(
                    {
                        "id": point_id,
                        "vector": vector,
                        "payload": {
                            "text": chunk,
                            "doc_id": str(document.id),
                            "file_id": str(document.id),
                            "user_id": str(document.user_id),
                            "filename": document.filename,
                            "chunk_index": index,
                            "page": 0,
                            "source": "user_upload",
                        },
                    }
                )

            if points:
                await upsert_points(
                    qdrant_client,
                    collection_name=collection_name,
                    points=points,
                )

            document.chunk_count = len(points)
            document.status = "indexed"
            document.error_message = None
            document.embedding_model = getattr(embedding_service, "model", None)
            await session.commit()
            logger.info(
                "user_document_index_success",
                doc_id=doc_id,
                chunk_count=len(points),
            )
        except Exception as exc:  # pragma: no cover - fail-safe
            logger.exception("user_document_index_failed", doc_id=doc_id, error=str(exc))
            await _mark_failed(session, document, str(exc))
        finally:
            await close_qdrant_client_for_current_loop()


async def _load_document(session: AsyncSession, doc_id: str) -> UserDocument | None:
    try:
        document_id = uuid.UUID(doc_id)
    except ValueError:
        logger.error("user_document_index_invalid_id", doc_id=doc_id)
        return None

    document = await session.get(UserDocument, document_id)
    if document is None:
        logger.error("user_document_index_not_found", doc_id=doc_id)
        return None
    return document


async def _mark_failed(session: AsyncSession, document: UserDocument, reason: str) -> None:
    document.status = "failed"
    document.error_message = reason[:2000]
    await session.commit()


def _parse_document(content: bytes, *, content_type: str | None, filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
    mime = (content_type or "").lower()

    if ext == "pdf" or "pdf" in mime:
        return _parse_pdf(content)
    if ext in {"docx", "doc"} or "word" in mime:
        return _parse_docx(content)
    if ext == "html" or "html" in mime:
        return _parse_html(content)
    if ext == "json" or "json" in mime:
        return _parse_json(content)
    if ext == "xlsx":
        logger.warning("user_document_parse_xlsx_not_supported")
        return ""
    return _parse_plain_text(content)


def _parse_pdf(content: bytes) -> str:
    try:
        reader = pypdf.PdfReader(io.BytesIO(content))
        texts = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(texts)
    except Exception as exc:
        logger.warning("user_document_parse_pdf_failed", error=str(exc))
        return ""


def _parse_docx(content: bytes) -> str:
    try:
        document = docx.Document(io.BytesIO(content))
        return "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text)
    except Exception as exc:
        logger.warning("user_document_parse_docx_failed", error=str(exc))
        return ""


def _parse_html(content: bytes) -> str:
    text = _parse_plain_text(content)
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    return soup.get_text("\n")


def _parse_json(content: bytes) -> str:
    text = _parse_plain_text(content)
    if not text:
        return ""
    try:
        payload = json.loads(text)
    except Exception:
        return text
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _parse_plain_text(content: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _clean_text(text: str) -> str:
    if not text:
        return ""

    cleaned = text.replace("\x00", "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\t ]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


__all__ = ["index_user_document_task"]
