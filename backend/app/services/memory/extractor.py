import json
import uuid
from typing import List
from loguru import logger

from app.services.qdrant_service import system_qdrant
from app.services.embedding import EmbeddingService
from app.services.vector.qdrant_user_service import QdrantUserVectorService
from app.services.sanitizer import sanitizer

class MemoryExtractorService:
    """
    负责从对话历史中提取用户记忆，并去重入库。
    """

    def __init__(self, *, embedding_service: EmbeddingService | None = None, fail_open: bool = True):
        self.embedding_service = embedding_service or EmbeddingService()
        self.qdrant = system_qdrant
        self._vector_service_factory = lambda user_id: QdrantUserVectorService(
            client=self.qdrant.client,
            user_id=user_id,
            embedding_model=getattr(self.embedding_service, "model", None),
            embedding_service=self.embedding_service,
            fail_open=fail_open,
        )

    async def extract_and_save(self, user_id: uuid.UUID, messages: List[dict], secretary_id: uuid.UUID = None):
        """
        主入口：执行 提取 -> 去重 -> 入库
        """
        # 1. 提取 (Extraction)
        facts = await self._llm_extract_facts(messages)
        if not facts:
            return

        # 2. 逐条处理 (Deduplication & Ingest)
        new_facts_count = 0
        for fact in facts:
            is_duplicate, collection_name = await self._check_is_duplicate(user_id, fact)
            if not is_duplicate and collection_name:
                await self._save_fact(user_id, fact, collection_name, secretary_id)
                new_facts_count += 1
        
        if new_facts_count > 0:
            logger.info(f"Memory: Extracted {new_facts_count} new facts for User {user_id}")

    async def _llm_extract_facts(self, messages: List[dict]) -> List[str]:
        """
        调用 LLM 提取事实。
        """
        # 构造对话文本
        conversation_text = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            conversation_text += f"{role}: {content}\n"

        # 构造消息列表给 LLM
        llm_messages = [
            {"role": "system", "content": MEMORY_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Please extract facts from the following conversation:\n\n{conversation_text}"}
        ]

        try:
            # 使用 LLMService 进行请求
            # 预留设置: MEMORY_EXTRACTOR_PRESET_ID (可在 .env 配置)
            preset_id = getattr(settings, "MEMORY_EXTRACTOR_PRESET_ID", None)
            response_text = await llm_service.chat_completion(
                messages=llm_messages,
                preset_id=preset_id,
                temperature=0.0
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
                logger.error(f"Failed to parse LLM memory extraction response as JSON: {response_text}")
                return []
                
        except Exception as e:
            logger.error(f"Memory Extraction LLM Error: {e}")
            return []

    async def _check_is_duplicate(
        self, user_id: uuid.UUID, fact: str, threshold: float = 0.92
    ) -> tuple[bool, str | None]:
        """
        去重检查：如果在向量库里找到了极其相似的（相似度 > 0.92），则认为是重复。
        """
        vs = self._vector_service_factory(user_id)
        fact_masked = sanitizer.mask_text(fact)
        results = await vs.search(fact_masked, limit=1, score_threshold=threshold)
        if results:
            logger.debug(f"Memory Duplicate Found: '{fact_masked}' matches existing (score: {results[0]['score']})")
            return True, getattr(vs, "_collection_name", None)
        return False, getattr(vs, "_collection_name", None)

    async def _save_fact(
        self, user_id: uuid.UUID, fact: str, collection_name: str, secretary_id: uuid.UUID = None
    ):
        """
        写入 Qdrant。
        """
        vector_service = self._vector_service_factory(user_id)
        payload = {
            "type": "extracted_fact",
            "created_at": "TODO_TIMESTAMP"
        }
        if secretary_id:
            payload["secretary_id"] = str(secretary_id)
        fact_masked = sanitizer.mask_text(fact)
        # QdrantUserVectorService 会自动补全 user_id / embedding_model / content
        await vector_service.upsert(fact_masked, payload=payload)

memory_extractor = MemoryExtractorService()
