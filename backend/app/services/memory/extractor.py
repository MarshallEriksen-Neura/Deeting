import json
import time
import uuid

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.prompts.memory_extraction import MEMORY_EXTRACTION_SYSTEM_PROMPT
from app.services.memory.external_memory import (
    WRITE_GUARD_NOOP_THRESHOLD,
    WRITE_GUARD_UPDATE_THRESHOLD,
)
from app.services.memory.qdrant_service import system_qdrant
from app.services.providers.embedding import EmbeddingService
from app.services.providers.sanitizer import sanitizer
from app.services.vector.qdrant_user_service import QdrantUserVectorService


class MemoryExtractorService:
    """
    负责从对话历史中提取用户记忆，并去重入库。
    """

    def __init__(
        self,
        *,
        embedding_service: EmbeddingService | None = None,
        fail_open: bool = True,
    ):
        self.embedding_service = embedding_service or EmbeddingService()
        self.qdrant = system_qdrant
        self._vector_service_factory = lambda user_id: QdrantUserVectorService(
            client=self.qdrant.client,
            user_id=user_id,
            embedding_model=getattr(self.embedding_service, "model", None),
            embedding_service=self.embedding_service,
            fail_open=fail_open,
        )

    async def extract_and_save(
        self,
        user_id: uuid.UUID,
        messages: list[dict],
        secretary_id: uuid.UUID = None,
        db_session: AsyncSession | None = None,
    ):
        """
        主入口：执行 提取 -> Write Guard 去重 -> 入库
        Write Guard: score < 0.85 = ADD, 0.85-0.95 = UPDATE (merge), >= 0.95 = NOOP
        """
        # 1. 提取 (Extraction)
        facts = await self._llm_extract_facts(
            messages, user_id=user_id, db_session=db_session
        )
        if not facts:
            return

        # 2. 逐条处理 (Write Guard Deduplication & Ingest)
        new_facts_count = 0
        updated_facts_count = 0
        for fact in facts:
            action = await self._write_guard_save(user_id, fact, secretary_id)
            if action == "add":
                new_facts_count += 1
            elif action == "update":
                updated_facts_count += 1

        if new_facts_count > 0 or updated_facts_count > 0:
            logger.info(
                f"Memory: {new_facts_count} new, {updated_facts_count} merged for User {user_id}"
            )

    async def _llm_extract_facts(
        self,
        messages: list[dict],
        *,
        user_id: uuid.UUID | None = None,
        db_session: AsyncSession | None = None,
    ) -> list[str]:
        """
        调用 LLM 提取事实。
        """
        from app.services.memory.external_memory import _resolve_secretary_model
        from app.services.providers.llm import llm_service

        # 构造对话文本
        conversation_text = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            conversation_text += f"{role}: {content}\n"

        # 构造消息列表给 LLM
        llm_messages = [
            {"role": "system", "content": MEMORY_EXTRACTION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Please extract facts from the following conversation:\n\n{conversation_text}",
            },
        ]

        try:
            # 解析该用户对应的秘书模型
            model = await _resolve_secretary_model(
                db_session=db_session, user_id=user_id
            )

            if not model:
                logger.warning(f"Memory extraction skipped: no secretary model resolved for user {user_id}")
                return []

            # 使用 LLMService 进行请求
            response_text = await llm_service.chat_completion(
                messages=llm_messages,
                model=model,
                temperature=0.0,
                user_id=str(user_id) if user_id else None,
                tenant_id=str(user_id) if user_id else None,
                api_key_id=str(user_id) if user_id else None,
            )

            # 解析 JSON 结果
            try:
                # 去掉可能的 Markdown 代码块包裹
                clean_json = response_text.strip()
                if clean_json.startswith("```json"):
                    clean_json = clean_json[7:-3].strip()
                elif clean_json.startswith("```"):
                    clean_json = clean_json[3:-3].strip()

                facts = json.loads(clean_json)
                if isinstance(facts, list):
                    return [str(f) for f in facts]
                return []
            except json.JSONDecodeError:
                logger.error(
                    f"Failed to parse LLM memory extraction response as JSON: {response_text}"
                )
                return []

        except Exception as e:
            logger.error(f"Memory Extraction LLM Error: {e}")
            return []

    async def _write_guard_save(
        self,
        user_id: uuid.UUID,
        fact: str,
        secretary_id: uuid.UUID = None,
    ) -> str:
        """
        Write Guard: 3-tier deduplication for a single fact.
        Returns: "add", "update", or "noop".
        """
        vs = self._vector_service_factory(user_id)
        fact_masked = sanitizer.mask_text(fact)

        try:
            results = await vs.search(
                fact_masked,
                limit=1,
                score_threshold=WRITE_GUARD_UPDATE_THRESHOLD,
            )
        except Exception as exc:
            logger.warning(f"write guard search failed, falling back to ADD: {exc}")
            results = []

        payload = {"type": "extracted_fact", "vitality": 1.0, "last_accessed_at": time.time()}
        if secretary_id:
            payload["secretary_id"] = str(secretary_id)

        if results:
            score = results[0].get("score", 0.0)
            existing_id = results[0].get("id")
            existing_content = results[0].get("content", "")

            if score >= WRITE_GUARD_NOOP_THRESHOLD:
                logger.debug(
                    f"write guard: NOOP (score={score:.3f}) — discarding duplicate fact"
                )
                return "noop"

            if score >= WRITE_GUARD_UPDATE_THRESHOLD:
                logger.debug(
                    f"write guard: UPDATE (score={score:.3f}) — merging into {existing_id}"
                )
                merged = f"{existing_content}\n\n---\n\n{fact_masked.strip()}"
                await vs.upsert(merged, payload=payload, id=existing_id)
                return "update"

        # ADD: new distinct fact
        await vs.upsert(fact_masked, payload=payload)
        return "add"

    async def _check_is_duplicate(
        self, user_id: uuid.UUID, fact: str, threshold: float = 0.92
    ) -> tuple[bool, str | None]:
        """
        Legacy dedup check (kept for backward compatibility).
        """
        vs = self._vector_service_factory(user_id)
        fact_masked = sanitizer.mask_text(fact)
        results = await vs.search(fact_masked, limit=1, score_threshold=threshold)
        if results:
            return True, getattr(vs, "_collection_name", None)
        return False, getattr(vs, "_collection_name", None)

    async def _save_fact(
        self,
        user_id: uuid.UUID,
        fact: str,
        collection_name: str,
        secretary_id: uuid.UUID = None,
    ):
        """
        Legacy direct write (kept for backward compatibility).
        """
        vector_service = self._vector_service_factory(user_id)
        payload = {"type": "extracted_fact", "vitality": 1.0, "last_accessed_at": time.time()}
        if secretary_id:
            payload["secretary_id"] = str(secretary_id)
        fact_masked = sanitizer.mask_text(fact)
        await vector_service.upsert(fact_masked, payload=payload)


memory_extractor = MemoryExtractorService()
