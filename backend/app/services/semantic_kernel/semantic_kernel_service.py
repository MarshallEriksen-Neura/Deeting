"""
SemanticKernelService: 语义内核服务

负责动态组装 System Prompt，实现：
1. Contextual Memory Injection - 基于意图检索长期记忆
2. Persona Adaptation - 基于 Skill 类型自动切换人设
3. Bandit 集成 - Persona 选择也能"越用越准"

分层 Prompt 架构：
- Layer 0: Core Identity (不可变)
- Layer 1: Persona (动态)
- Layer 2: Context Memory (动态)
- Layer 3: Time & Environment (由 TemplateRenderStep 注入)
- Layer 4: Tool Definitions (由 ToolContextService 处理)
- Layer 5: Assistant Custom Prompt (用户自定义)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# 场景常量
SCENE_PERSONA = "prompt:persona"

# 核心身份 Prompt (Layer 0)
CORE_IDENTITY_PROMPT = """You are a highly capable AI assistant powered by DeetingOS.
You adapt your communication style and expertise based on the task at hand.
Always strive to be helpful, accurate, and thoughtful in your responses."""


@dataclass
class PromptAssemblyResult:
    """Prompt 组装结果"""
    final_prompt: str
    persona_id: str
    persona_name: str
    injected_memory_ids: list[str] = field(default_factory=list)
    assembly_duration_ms: float = 0.0
    assembly_metadata: dict = field(default_factory=dict)


class SemanticKernelService:
    """
    语义内核服务：动态组装 System Prompt

    设计原则：
    - 各层独立演进，便于 A/B 测试
    - Persona 和 Memory 检索可并行
    - 支持 fail-open，任一层失败不影响整体
    - 会话级 Persona 锁定，保证一致性
    """

    def __init__(
        self,
        *,
        memory_budget_tokens: int = 500,
        memory_high_threshold: float = 0.9,
        memory_medium_threshold: float = 0.7,
        persona_cache_ttl: int = 300,
    ) -> None:
        """
        初始化语义内核服务

        Args:
            memory_budget_tokens: Memory 注入的 token 预算
            memory_high_threshold: 高相关度阈值 (完整注入)
            memory_medium_threshold: 中等相关度阈值 (摘要注入)
            persona_cache_ttl: 会话级 Persona 缓存 TTL (秒)
        """
        self.memory_budget_tokens = memory_budget_tokens
        self.memory_high_threshold = memory_high_threshold
        self.memory_medium_threshold = memory_medium_threshold
        self.persona_cache_ttl = persona_cache_ttl

        # 会话级 Persona 缓存: session_id -> (persona_id, persona_name, timestamp)
        self._session_persona_cache: dict[str, tuple[str, str, float]] = {}

    async def assemble_prompt(
        self,
        *,
        query: str,
        tools: list[Any],
        user_id: str | None = None,
        session_id: str | None = None,
        base_prompt: str | None = None,
        db_session: Any | None = None,
    ) -> PromptAssemblyResult:
        """
        组装动态 Prompt

        Args:
            query: 用户当前意图
            tools: JIT 检索到的工具列表
            user_id: 用户 ID (用于个性化)
            session_id: 会话 ID (用于会话级 Persona 锁定)
            base_prompt: 基础 Prompt (如 Assistant 自定义 Prompt)
            db_session: 数据库会话 (用于 Bandit 查询)

        Returns:
            PromptAssemblyResult: 组装结果
        """
        start_time = time.perf_counter()

        # 并行执行 Persona 解析和 Memory 检索
        persona_task = self._resolve_persona_safe(tools, user_id, session_id, db_session)
        memory_task = self._retrieve_memories_safe(query, user_id)

        persona_result, memory_result = await asyncio.gather(
            persona_task,
            memory_task,
        )

        persona_id, persona_name, persona_prompt = persona_result
        memory_injection, memory_ids = memory_result

        # 组装最终 Prompt
        layers = [
            CORE_IDENTITY_PROMPT,     # Layer 0
            persona_prompt,            # Layer 1
            memory_injection,          # Layer 2
            base_prompt or "",         # Layer 5 (用户自定义)
        ]

        final_prompt = "\n\n".join(filter(None, layers))

        duration_ms = (time.perf_counter() - start_time) * 1000

        logger.info(
            "SemanticKernelService.assemble_prompt: "
            "duration_ms=%.2f persona=%s memory_count=%d tool_count=%d",
            duration_ms,
            persona_id,
            len(memory_ids),
            len(tools),
        )

        return PromptAssemblyResult(
            final_prompt=final_prompt,
            persona_id=persona_id,
            persona_name=persona_name,
            injected_memory_ids=memory_ids,
            assembly_duration_ms=duration_ms,
            assembly_metadata={
                "tool_count": len(tools),
                "memory_count": len(memory_ids),
                "persona_source": "session_cache" if self._is_persona_cached(session_id) else "computed",
                "layers_used": ["core", "persona", "memory", "base"] if base_prompt else ["core", "persona", "memory"],
            },
        )

    async def _resolve_persona_safe(
        self,
        tools: list[Any],
        user_id: str | None,
        session_id: str | None,
        db_session: Any | None,
    ) -> tuple[str, str, str]:
        """
        安全地解析人设 (带异常处理)

        Returns:
            (persona_id, persona_name, persona_prompt)
        """
        try:
            return await self._resolve_persona(tools, user_id, session_id, db_session)
        except Exception as exc:
            logger.warning("SemanticKernelService: persona resolution failed", exc_info=exc)
            return "default", "General Assistant", ""

    async def _resolve_persona(
        self,
        tools: list[Any],
        user_id: str | None,
        session_id: str | None,
        db_session: Any | None,
    ) -> tuple[str, str, str]:
        """
        基于工具集解析最佳人设

        策略：
        1. 检查会话级缓存
        2. 提取 tools 的标签分布
        3. 匹配候选 Personas
        4. 调用 Bandit 进行 rerank
        5. 返回最佳 Persona
        """
        from app.services.semantic_kernel.persona_service import (
            DEFAULT_PERSONA,
            persona_service,
        )

        # 1. 会话级缓存检查
        if session_id:
            cached = self._get_session_persona(session_id)
            if cached:
                persona_id, persona_name = cached
                persona = await persona_service.get_persona(persona_id)
                if persona:
                    return persona.id, persona.name, persona.prompt
                # 缓存的 persona 已不存在，清除缓存
                self._clear_session_persona(session_id)

        # 2. 提取工具标签分布
        tag_distribution = self._extract_tag_distribution(tools)

        if not tag_distribution:
            return DEFAULT_PERSONA.id, DEFAULT_PERSONA.name, DEFAULT_PERSONA.prompt

        # 3. 匹配候选 Personas
        candidates = await persona_service.match_personas(tag_distribution)

        if not candidates:
            return DEFAULT_PERSONA.id, DEFAULT_PERSONA.name, DEFAULT_PERSONA.prompt

        # 4. Bandit rerank (如果有 db_session)
        best_persona = candidates[0]  # 默认取匹配度最高的

        if db_session is not None and len(candidates) > 1:
            try:
                best_persona = await self._bandit_rerank_personas(
                    candidates, db_session
                )
            except Exception as exc:
                logger.warning("SemanticKernelService: bandit rerank failed", exc_info=exc)
                # 回退到匹配度最高的

        # 5. 缓存到会话
        if session_id:
            self._set_session_persona(session_id, best_persona.id, best_persona.name)

        return best_persona.id, best_persona.name, best_persona.prompt

    async def _bandit_rerank_personas(
        self,
        candidates: list[Any],
        db_session: Any,
    ) -> Any:
        """
        使用 Bandit 对 Persona 候选进行 rerank

        Returns:
            最佳 Persona
        """
        from app.repositories.bandit_repository import BanditRepository
        from app.services.decision.decision_service import DecisionCandidate, DecisionService

        repo = BanditRepository(db_session)
        decision_service = DecisionService(
            repo,
            vector_weight=float(getattr(settings, "DECISION_VECTOR_WEIGHT", 0.75) or 0.75),
            bandit_weight=float(getattr(settings, "DECISION_BANDIT_WEIGHT", 0.25) or 0.25),
            exploration_bonus=float(getattr(settings, "DECISION_EXPLORATION_BONUS", 0.3) or 0.3),
            strategy=str(getattr(settings, "DECISION_STRATEGY", "thompson")),
            final_score=str(getattr(settings, "DECISION_FINAL_SCORE", "weighted_sum")),
            ucb_c=float(getattr(settings, "DECISION_UCB_C", 1.5) or 1.5),
            ucb_min_trials=int(getattr(settings, "DECISION_UCB_MIN_TRIALS", 5) or 5),
            thompson_prior_alpha=float(getattr(settings, "DECISION_THOMPSON_PRIOR_ALPHA", 1.0) or 1.0),
            thompson_prior_beta=float(getattr(settings, "DECISION_THOMPSON_PRIOR_BETA", 1.0) or 1.0),
        )

        # 构建 DecisionCandidate 列表
        decision_candidates = [
            DecisionCandidate(arm_id=p.id, base_score=p.match_score)
            for p in candidates
        ]

        # Bandit rerank
        ranked = await decision_service.rank_candidates(SCENE_PERSONA, decision_candidates)

        if not ranked:
            return candidates[0]

        # 找到排名最高的 persona
        best_arm_id = ranked[0].arm_id
        for persona in candidates:
            if persona.id == best_arm_id:
                return persona

        return candidates[0]

    def _extract_tag_distribution(self, tools: list[Any]) -> dict[str, float]:
        """
        提取工具标签分布

        Returns:
            标签 -> 权重 映射，如 {"code": 0.6, "data": 0.3}
        """
        tag_counts: dict[str, int] = {}
        total = 0

        for tool in tools:
            # 尝试多种方式获取 tags
            tags = None
            if hasattr(tool, "tags"):
                tags = tool.tags
            elif isinstance(tool, dict):
                tags = tool.get("tags")

            if not tags:
                continue

            for tag in tags:
                if isinstance(tag, str):
                    tag_lower = tag.lower()
                    tag_counts[tag_lower] = tag_counts.get(tag_lower, 0) + 1
                    total += 1

        if total == 0:
            return {}

        return {tag: count / total for tag, count in tag_counts.items()}

    async def _retrieve_memories_safe(
        self,
        query: str,
        user_id: str | None,
    ) -> tuple[str, list[str]]:
        """
        安全地检索记忆 (带异常处理)

        Returns:
            (memory_injection_text, memory_ids)
        """
        try:
            return await self._retrieve_and_inject_memories(query, user_id)
        except Exception as exc:
            logger.warning("SemanticKernelService: memory retrieval failed", exc_info=exc)
            return "", []

    async def _retrieve_and_inject_memories(
        self,
        query: str,
        user_id: str | None,
    ) -> tuple[str, list[str]]:
        """
        检索相关记忆并按策略注入

        三级策略：
        1. 高相关度 (>0.9): 完整注入 (最多 2 条)
        2. 中等相关度 (0.7-0.9): 摘要注入
        3. 低相关度 (<0.7): 忽略

        Returns:
            (memory_injection_text, memory_ids)
        """
        if not user_id:
            return "", []

        from app.services.semantic_kernel.memory_service import memory_service

        memories = await memory_service().search(
            query=query,
            user_id=user_id,
            top_k=10,
            threshold=self.memory_medium_threshold,
        )

        if not memories:
            return "", []

        # 分层处理
        high_relevance = [m for m in memories if m.score > self.memory_high_threshold][:2]
        medium_relevance = [
            m for m in memories
            if self.memory_medium_threshold < m.score <= self.memory_high_threshold
        ]

        injected_ids: list[str] = []
        injection_parts: list[str] = []
        used_tokens = 0

        # 高相关度完整注入
        for mem in high_relevance:
            mem_tokens = self._estimate_tokens(mem.content)
            if used_tokens + mem_tokens > self.memory_budget_tokens * 0.6:
                break
            injection_parts.append(f"[Memory] {mem.content}")
            injected_ids.append(mem.id)
            used_tokens += mem_tokens

        # 中等相关度摘要注入
        if medium_relevance and used_tokens < self.memory_budget_tokens:
            remaining_budget = self.memory_budget_tokens - used_tokens
            summary = await memory_service().summarize(
                memories=medium_relevance,
                max_tokens=remaining_budget,
            )
            if summary:
                injection_parts.append(f"[Context Summary] {summary}")
                injected_ids.extend([m.id for m in medium_relevance])

        if not injection_parts:
            return "", []

        header = "## Relevant Context from Previous Conversations"
        injection = f"{header}\n" + "\n\n".join(injection_parts)

        return injection, injected_ids

    def _estimate_tokens(self, text: str) -> int:
        """粗略估算 token 数"""
        # 1 token ≈ 4 字符 (英文) 或 1.5 字符 (中文)
        return len(text) // 3

    def _is_persona_cached(self, session_id: str | None) -> bool:
        """检查会话 Persona 是否已缓存"""
        if not session_id:
            return False
        return session_id in self._session_persona_cache

    def _get_session_persona(self, session_id: str) -> tuple[str, str] | None:
        """获取会话级 Persona 缓存"""
        cached = self._session_persona_cache.get(session_id)
        if not cached:
            return None

        persona_id, persona_name, timestamp = cached
        if time.time() - timestamp > self.persona_cache_ttl:
            # 缓存过期
            del self._session_persona_cache[session_id]
            return None

        return persona_id, persona_name

    def _set_session_persona(self, session_id: str, persona_id: str, persona_name: str) -> None:
        """设置会话级 Persona 缓存"""
        self._session_persona_cache[session_id] = (persona_id, persona_name, time.time())

        # 简单的缓存清理 (超过 1000 条时清理过期的)
        if len(self._session_persona_cache) > 1000:
            self._cleanup_expired_cache()

    def _clear_session_persona(self, session_id: str) -> None:
        """清除会话级 Persona 缓存"""
        self._session_persona_cache.pop(session_id, None)

    def _cleanup_expired_cache(self) -> None:
        """清理过期的缓存"""
        current_time = time.time()
        expired_keys = [
            key for key, (_, _, timestamp) in self._session_persona_cache.items()
            if current_time - timestamp > self.persona_cache_ttl
        ]
        for key in expired_keys:
            del self._session_persona_cache[key]

    async def record_persona_feedback(
        self,
        persona_id: str,
        reward: float,
        *,
        db_session: Any,
    ) -> None:
        """
        记录 Persona 反馈到 Bandit

        Args:
            persona_id: 人设 ID
            reward: 奖励值 (-1.0 ~ 1.0)
            db_session: 数据库会话
        """
        if persona_id == "default":
            return

        try:
            from app.repositories.bandit_repository import BanditRepository
            from app.services.decision.decision_service import DecisionService

            repo = BanditRepository(db_session)
            decision_service = DecisionService(repo)
            await decision_service.record_feedback(
                scene=SCENE_PERSONA,
                arm_id=persona_id,
                reward=reward,
                success=reward > 0,
            )
            logger.info(
                "SemanticKernelService: recorded persona feedback persona=%s reward=%.2f",
                persona_id,
                reward,
            )
        except Exception as exc:
            logger.warning("SemanticKernelService: failed to record feedback", exc_info=exc)


def get_semantic_kernel_service() -> SemanticKernelService:
    """
    获取语义内核服务实例

    从配置读取参数
    """
    return SemanticKernelService(
        memory_budget_tokens=int(
            getattr(settings, "SEMANTIC_KERNEL_MEMORY_BUDGET_TOKENS", 500) or 500
        ),
        memory_high_threshold=float(
            getattr(settings, "SEMANTIC_KERNEL_MEMORY_HIGH_THRESHOLD", 0.9) or 0.9
        ),
        memory_medium_threshold=float(
            getattr(settings, "SEMANTIC_KERNEL_MEMORY_MEDIUM_THRESHOLD", 0.7) or 0.7
        ),
        persona_cache_ttl=int(
            getattr(settings, "SEMANTIC_KERNEL_PERSONA_CACHE_TTL", 300) or 300
        ),
    )


# 模块级单例 (延迟初始化)
_semantic_kernel_service: SemanticKernelService | None = None


def semantic_kernel_service() -> SemanticKernelService:
    """获取语义内核服务单例"""
    global _semantic_kernel_service
    if _semantic_kernel_service is None:
        _semantic_kernel_service = get_semantic_kernel_service()
    return _semantic_kernel_service
