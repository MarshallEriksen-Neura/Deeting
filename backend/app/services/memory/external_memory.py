from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
import uuid
from pathlib import Path

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.prompts.memory_extraction import MEMORY_PERSIST_DECISION_SYSTEM_PROMPT
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories import UserSecretaryRepository
from app.services.providers.embedding import EmbeddingService
from app.services.providers.sanitizer import sanitizer
from app.services.vector.qdrant_user_service import QdrantUserVectorService


DEDUP_SCORE_THRESHOLD = 0.92
TRAIN_SAMPLE_RATE = 1.0
TRAIN_LABEL_FACT = "__label__fact"
TRAIN_LABEL_CHAT = "__label__chat"
_TRAINING_LOCK = asyncio.Lock()


def _training_sample_path() -> Path:
    return Path(__file__).resolve().parents[3] / "scripts" / "data" / "fact_train_samples.txt"


def _normalize_label(decision: bool) -> str:
    return TRAIN_LABEL_FACT if decision else TRAIN_LABEL_CHAT


def extract_user_message(request_obj: object | None) -> str | None:
    if not request_obj:
        return None
    messages = getattr(request_obj, "messages", None)
    if not messages:
        return None

    def _content_to_text(content: object) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text_val = item.get("text")
                    if isinstance(text_val, str):
                        parts.append(text_val)
            return " ".join(parts)
        if isinstance(content, dict):
            text_val = content.get("text")
            return text_val if isinstance(text_val, str) else ""
        return ""

    for msg in reversed(messages):
        if getattr(msg, "role", None) == "user":
            return _content_to_text(getattr(msg, "content", None)).strip() or None
    return None


def _parse_decision(content: str | None) -> tuple[bool | None, float | None]:
    if not content:
        return None, None
    raw = content.strip()
    match = re.search(r"\{.*\}", raw, flags=re.S)
    if match:
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}

    if data:
        save_value = (
            data.get("save")
            if "save" in data
            else data.get("should_save") or data.get("need_save") or data.get("persist")
        )
        if isinstance(save_value, bool):
            confidence = data.get("confidence")
            return save_value, float(confidence) if isinstance(confidence, (int, float)) else None
        if isinstance(save_value, str):
            lowered = save_value.strip().lower()
            if lowered in {"true", "yes", "y", "1"}:
                return True, None
            if lowered in {"false", "no", "n", "0"}:
                return False, None
        label = str(data.get("label") or data.get("decision") or "").strip().lower()
        if label in {"fact", "memory", "save", "yes", "true"}:
            return True, data.get("confidence") if isinstance(data.get("confidence"), (int, float)) else None
        if label in {"chat", "no", "false", "skip"}:
            return False, data.get("confidence") if isinstance(data.get("confidence"), (int, float)) else None

    lowered = raw.lower()
    if lowered in {"yes", "true", "是", "需要"}:
        return True, None
    if lowered in {"no", "false", "否", "不需要"}:
        return False, None
    return None, None


async def _resolve_secretary_model(
    *,
    db_session: AsyncSession | None,
    user_id: uuid.UUID | None,
) -> str | None:
    if not db_session or not user_id:
        return None
    repo = UserSecretaryRepository(db_session)
    secretary = await repo.get_by_user_id(user_id)
    if not secretary or not secretary.model_name:
        return None
    return secretary.model_name


async def _classify_with_llm(text: str, *, model: str | None) -> tuple[bool | None, float | None]:
    from app.services.providers.llm import llm_service

    messages = [
        {"role": "system", "content": MEMORY_PERSIST_DECISION_SYSTEM_PROMPT.strip()},
        {"role": "user", "content": f"用户输入：{text}\n请严格输出 JSON 对象。"},
    ]
    try:
        response = await llm_service.chat_completion(
            messages=messages,
            model=model,
            temperature=0.0,
            max_tokens=128,
        )
    except Exception as exc:
        logger.warning(f"external memory classify failed: {exc}")
        return None, None

    if not isinstance(response, str):
        return None, None
    return _parse_decision(response)


async def _append_training_sample(text: str, decision: bool) -> None:
    if TRAIN_SAMPLE_RATE < 1.0 and random.random() > TRAIN_SAMPLE_RATE:
        return
    masked = sanitizer.mask_text(text).replace("\n", " ").replace("\r", " ").strip()
    if not masked:
        return
    line = f"{_normalize_label(decision)} {masked}\n"
    path = _training_sample_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    def _write_line(target: Path, content: str) -> None:
        with target.open("a", encoding="utf-8") as handle:
            handle.write(content)

    async with _TRAINING_LOCK:
        await asyncio.to_thread(_write_line, path, line)


async def should_persist_text(
    text: str,
    *,
    user_id: uuid.UUID | None = None,
    db_session: AsyncSession | None = None,
    record_sample: bool = True,
) -> bool:
    content = (text or "").strip()
    if not content:
        return False

    model = await _resolve_secretary_model(db_session=db_session, user_id=user_id)
    decision, _confidence = await _classify_with_llm(content, model=model)
    if decision is None and model:
        decision, _confidence = await _classify_with_llm(content, model=None)
    if decision is None:
        return False
    if record_sample:
        await _append_training_sample(content, decision)
    return decision


async def persist_external_memory(
    *,
    user_id: uuid.UUID,
    text: str,
    db_session: AsyncSession | None = None,
    path: str | None = None,
) -> bool:
    decision = await should_persist_text(text, user_id=user_id, db_session=db_session)
    if not decision:
        return False
    return await write_external_memory(user_id=user_id, text=text, path=path)


def derive_external_user_id(raw_key: str) -> uuid.UUID:
    digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    return uuid.uuid5(uuid.NAMESPACE_URL, f"external:{digest}")


async def write_external_memory(
    *,
    user_id: uuid.UUID,
    text: str,
    path: str | None = None,
) -> bool:
    if not text:
        return False
    if not qdrant_is_configured():
        return False

    masked = sanitizer.mask_text(text)
    embedding_service = EmbeddingService()
    vector_service = QdrantUserVectorService(
        client=get_qdrant_client(),
        user_id=user_id,
        embedding_service=embedding_service,
        embedding_model=getattr(embedding_service, "model", None),
        fail_open=True,
    )

    try:
        results = await vector_service.search(
            masked,
            limit=1,
            score_threshold=DEDUP_SCORE_THRESHOLD,
        )
        if results:
            return False

        payload = {"source": "external", "path": path}
        await vector_service.upsert(masked, payload=payload)
        return True
    except Exception as exc:  # pragma: no cover - fail-open
        logger.warning(f"external memory write failed: {exc}")
        return False


__all__ = [
    "derive_external_user_id",
    "extract_user_message",
    "persist_external_memory",
    "should_persist_text",
    "write_external_memory",
]
