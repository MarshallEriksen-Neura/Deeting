import json
import logging
import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.plugin_config import plugin_config_loader
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.repositories.bandit_repository import BanditRepository
from app.schemas.tool import ToolDefinition
from app.services.decision import DecisionCandidate, DecisionService
from app.services.indexing.index_sync_service import (
    QdrantIndexSyncService,
    stable_fingerprint,
)
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import (
    get_kb_user_tool_collection_name,
    get_skill_collection_name,
    get_tool_system_collection_name,
)
from app.storage.qdrant_kb_store import (
    delete_points,
    scroll_points,
    search_points,
)

logger = logging.getLogger(__name__)


def _safe_schema(schema: Any) -> dict[str, Any]:
    if isinstance(schema, dict):
        return schema
    if isinstance(schema, str):
        try:
            parsed = json.loads(schema)
        except Exception:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _build_embedding_text(tool: ToolDefinition) -> str:
    args = ""
    schema = tool.input_schema or {}
    if isinstance(schema, dict):
        props = schema.get("properties")
        if isinstance(props, dict) and props:
            args = ", ".join(sorted([str(k) for k in props.keys()]))
    desc = (tool.description or "").strip()
    return f"Tool Name: {tool.name}. Description: {desc}. Arguments: {args}".strip()


def _make_point_id(*parts: str) -> str:
    raw = "|".join([str(p or "").strip() for p in parts if p is not None])
    if not raw:
        return str(uuid.uuid4())
    return str(uuid.uuid5(uuid.NAMESPACE_URL, raw))


@dataclass(frozen=True)
class SystemToolIndexItem:
    tool: ToolDefinition
    plugin_id: str


class ToolSyncService:
    """
    负责工具索引的同步与检索 (JIT Tool Retrieval).
    """
    _QUERY_EMBED_MAX_CHARS = 3000
    _QUERY_EMBED_HEAD_CHARS = 2000
    _QUERY_EMBED_TAIL_CHARS = 900

    def __init__(
        self,
        embedding_service: EmbeddingService | None = None,
        decision_service: DecisionService | None = None,
    ):
        self._embedding_service = embedding_service or EmbeddingService()
        self._index_syncer = QdrantIndexSyncService(self._embedding_service)
        self._decision_service = decision_service

    # =========================================================================
    # 1. Sync Logic (Write Path)
    # =========================================================================

    async def sync_system_tools(self, tools: list[ToolDefinition]) -> int:
        """
        同步系统级工具到 Qdrant 系统索引。
        仅索引 enabled_by_default=True 且 is_always_on=False 的工具。
        """
        if not qdrant_is_configured():
            return 0

        indexable_plugins = plugin_config_loader.get_indexable_plugins()
        if not indexable_plugins:
            return 0

        core_tool_names: set[str] = set()
        tool_name_to_plugin: dict[str, str] = {}
        allowed_tool_names: set[str] = set()
        for plugin in indexable_plugins:
            allowed_tool_names.update(plugin.tools or [])
            for tool_name in plugin.tools or []:
                tool_name_to_plugin.setdefault(tool_name, plugin.id)
            if plugin.is_always_on:
                core_tool_names.update(plugin.tools or [])

        to_index = [
            tool
            for tool in tools
            if tool.name in allowed_tool_names and tool.name not in core_tool_names
        ]
        if not to_index:
            return 0

        collection = get_tool_system_collection_name()
        new_items = [
            SystemToolIndexItem(
                tool=tool, plugin_id=tool_name_to_plugin.get(tool.name, "system")
            )
            for tool in to_index
        ]
        new_hash = self._system_tools_hash(new_items)
        try:
            cached_hash = await cache.get(CacheKeys.tool_system_index_hash())
        except Exception:
            cached_hash = None
        if cached_hash and cached_hash == new_hash:
            return 0

        old_items = await self._load_system_index_items(collection)
        await self._index_syncer.sync(
            collection_name=collection,
            old_items=old_items,
            new_items=new_items,
            key_fn=lambda item: item.tool.name,
            fingerprint_fn=self._system_tool_fingerprint,
            text_fn=lambda item: _build_embedding_text(item.tool),
            payload_fn=lambda item: {
                "scope": "system",
                "tool_name": item.tool.name,
                "plugin_id": item.plugin_id,
                "description": item.tool.description,
                "schema_json": _safe_schema(item.tool.input_schema),
                "output_schema_json": _safe_schema(item.tool.output_schema),
                "output_description": item.tool.output_description,
                "embedding_model": getattr(self._embedding_service, "model", None),
            },
            id_fn=lambda item: _make_point_id("system", item.plugin_id, item.tool.name),
        )
        try:
            ttl = int(
                getattr(settings, "MCP_TOOL_SYSTEM_INDEX_HASH_TTL_SECONDS", 86400)
                or 86400
            )
            if ttl > 0:
                await cache.set(CacheKeys.tool_system_index_hash(), new_hash, ttl=ttl)
        except Exception:
            pass
        return len(new_items)

    async def sync_user_tools_delta(
        self,
        *,
        user_id: uuid.UUID,
        origin: str,
        old_payloads: list[dict],
        new_tools: list[ToolDefinition],
        old_disabled: set[str] | None = None,
        new_disabled: set[str] | None = None,
    ) -> int:
        if not qdrant_is_configured():
            return 0

        old_disabled_set = old_disabled or set()
        new_disabled_set = new_disabled or set()

        old_tools = self._payloads_to_tools(old_payloads, old_disabled_set)
        new_enabled_tools = [
            tool for tool in new_tools if tool.name not in new_disabled_set
        ]

        collection = get_kb_user_tool_collection_name(user_id)
        delta = await self._index_syncer.sync(
            collection_name=collection,
            old_items=old_tools,
            new_items=new_enabled_tools,
            key_fn=lambda tool: tool.name,
            fingerprint_fn=self._tool_fingerprint,
            text_fn=_build_embedding_text,
            payload_fn=lambda tool: {
                "scope": "user",
                "user_id": str(user_id),
                "origin": origin,
                "tool_name": tool.name,
                "plugin_id": "user_mcp",
                "description": tool.description,
                "schema_json": _safe_schema(tool.input_schema),
                "output_schema_json": _safe_schema(tool.output_schema),
                "output_description": tool.output_description,
                "embedding_model": getattr(self._embedding_service, "model", None),
            },
            id_fn=lambda tool: _make_point_id(str(user_id), origin, tool.name),
        )
        return len(delta.to_upsert) + len(delta.to_delete)

    async def delete_user_tools(self, *, user_id: uuid.UUID, origin: str) -> None:
        if not qdrant_is_configured():
            return
        collection = get_kb_user_tool_collection_name(user_id)
        client = get_qdrant_client()
        try:
            await delete_points(
                client,
                collection_name=collection,
                query_filter={
                    "must": [
                        {"key": "user_id", "match": {"value": str(user_id)}},
                        {"key": "origin", "match": {"value": origin}},
                    ]
                },
                wait=True,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("user tool index delete failed", exc_info=exc)

    def _payloads_to_tools(
        self, payloads: list[dict], disabled: set[str] | None = None
    ) -> list[ToolDefinition]:
        disabled_set = disabled or set()
        tools: list[ToolDefinition] = []
        for item in payloads:
            name = item.get("name")
            if not name or name in disabled_set:
                continue
            try:
                tools.append(ToolDefinition(**item))
            except Exception:
                continue
        return tools

    def _tool_fingerprint(self, tool: ToolDefinition) -> str:
        payload = {
            "name": tool.name,
            "description": tool.description or "",
            "schema": _safe_schema(tool.input_schema),
        }
        return stable_fingerprint(payload)

    def _system_tool_fingerprint(self, item: SystemToolIndexItem) -> str:
        payload = {
            "name": item.tool.name,
            "description": item.tool.description or "",
            "schema": _safe_schema(item.tool.input_schema),
            "plugin_id": item.plugin_id,
        }
        return stable_fingerprint(payload)

    def _system_tools_hash(self, items: list[SystemToolIndexItem]) -> str:
        entries = []
        for item in items:
            entries.append(
                {
                    "name": item.tool.name,
                    "description": item.tool.description or "",
                    "schema": _safe_schema(item.tool.input_schema),
                    "plugin_id": item.plugin_id,
                }
            )
        entries.sort(key=lambda it: (it["plugin_id"], it["name"]))
        return stable_fingerprint({"items": entries})

    async def _load_system_index_items(
        self, collection_name: str
    ) -> list[SystemToolIndexItem]:
        if not qdrant_is_configured():
            return []
        client = get_qdrant_client()
        items: list[SystemToolIndexItem] = []
        seen: set[str] = set()
        offset = None
        try:
            while True:
                points, offset = await scroll_points(
                    client,
                    collection_name=collection_name,
                    limit=100,
                    query_filter={
                        "must": [{"key": "scope", "match": {"value": "system"}}]
                    },
                    offset=offset,
                )
                if not points:
                    break
                for point in points:
                    payload = point.get("payload") or {}
                    name = str(payload.get("tool_name") or "").strip()
                    if not name or name in seen:
                        continue
                    tool = ToolDefinition(
                        name=name,
                        description=payload.get("description"),
                        input_schema=_safe_schema(payload.get("schema_json")),
                    )
                    items.append(
                        SystemToolIndexItem(
                            tool=tool,
                            plugin_id=str(payload.get("plugin_id") or "system"),
                        )
                    )
                    seen.add(name)
                if offset is None:
                    break
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("load system tool index failed", exc_info=exc)
            return []
        return items

    # =========================================================================
    # 2. Retrieval Logic (Read Path)
    # =========================================================================

    async def search_tools(
        self,
        query: str,
        user_id: uuid.UUID | None = None,
    ) -> list[ToolDefinition]:
        start_time = time.perf_counter()
        logger.info(
            "ToolSyncService: search_tools start query_len=%s user_id=%s",
            len(query or ""),
            user_id,
        )
        if not qdrant_is_configured():
            return []

        q = (query or "").strip()
        if not q:
            return []
        q_for_embedding = self._prepare_query_for_embedding(q)

        embed_start = time.perf_counter()
        try:
            vector = await self._embedding_service.embed_text(q_for_embedding)
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning(
                "ToolSyncService: embedding failed query_len=%s prepared_len=%s",
                len(q),
                len(q_for_embedding),
                exc_info=exc,
            )
            return []
        logger.info(
            "ToolSyncService: embedding duration_ms=%.2f",
            (time.perf_counter() - embed_start) * 1000,
        )

        sys_limit = int(getattr(settings, "MCP_TOOL_SYSTEM_TOPK", 3) or 3)
        user_limit = int(getattr(settings, "MCP_TOOL_USER_TOPK", 5) or 5)
        skill_limit = int(getattr(settings, "MCP_TOOL_SKILL_TOPK", 3) or 3)
        total_limit = max(1, sys_limit + user_limit + skill_limit)
        threshold = float(getattr(settings, "MCP_TOOL_SCORE_THRESHOLD", 0.40) or 0.40)

        sys_start = time.perf_counter()
        sys_hits = await self._search_system(
            vector, limit=total_limit, threshold=threshold
        )
        logger.info(
            "ToolSyncService: system search duration_ms=%.2f hits=%s",
            (time.perf_counter() - sys_start) * 1000,
            len(sys_hits),
        )

        skill_start = time.perf_counter()
        installed_skill_ids: set[str] | None = None
        if user_id:
            installed_skill_ids = await self._list_user_installed_skill_ids(user_id)
        skill_hits = await self._search_skills(
            vector, limit=skill_limit, threshold=threshold
        )
        if user_id:
            skill_hits = self._filter_skill_hits_for_user(
                skill_hits, installed_skill_ids or set()
            )
        logger.info(
            "ToolSyncService: skill search duration_ms=%.2f hits=%s",
            (time.perf_counter() - skill_start) * 1000,
            len(skill_hits),
        )
        skill_hits = await self._rerank_skill_hits(skill_hits)

        user_hits: list[dict[str, Any]] = []
        if user_id:
            user_start = time.perf_counter()
            user_hits = await self._search_user(
                user_id, vector, limit=user_limit, threshold=threshold
            )
            logger.info(
                "ToolSyncService: user search duration_ms=%.2f hits=%s",
                (time.perf_counter() - user_start) * 1000,
                len(user_hits),
            )

        final_hits = self._merge_hits(user_hits, sys_hits, skill_hits, total_limit)
        
        # New: Expand Skills into individual Tools
        result: list[ToolDefinition] = []
        existing_names: set[str] = set()
        
        for hit in final_hits:
            payload = hit.get("payload") or {}
            if payload.get("is_skill"):
                skill_id = payload.get("skill_id")
                # Fetch skill from DB to get all tools
                async with AsyncSessionLocal() as session:
                    from app.repositories.skill_registry_repository import SkillRegistryRepository
                    repo = SkillRegistryRepository(session)
                    skill_obj = await repo.get_by_id(skill_id)
                    if skill_obj:
                        manifest = skill_obj.manifest_json or {}
                        tools_defs = manifest.get("tools", [])
                        pkg_name = skill_obj.id.split('.')[-1] if skill_obj.id else None
                        
                        for t_def in tools_defs:
                            t_name = t_def.get("name")
                            if t_name and t_name not in existing_names:
                                result.append(ToolDefinition(
                                    name=t_name,
                                    description=t_def.get("description", ""),
                                    input_schema=_safe_schema(t_def.get("parameters") or t_def.get("input_schema")),
                                    output_schema=_safe_schema(t_def.get("output_schema")),
                                    output_description=t_def.get("output_description"),
                                    extra_meta={"pkg_name": pkg_name} if pkg_name else None
                                ))
                                existing_names.add(t_name)
            else:
                tool_def = self._hit_to_def(hit)
                if tool_def.name not in existing_names:
                    result.append(tool_def)
                    existing_names.add(tool_def.name)
        
        # 确保关键引导工具在特定意图下可见，但不截断结果
        result = await self._ensure_onboarding_tools_visibility(result, q, user_id)

        logger.info(
            "ToolSyncService: search_tools done duration_ms=%.2f final_hits=%s",
            (time.perf_counter() - start_time) * 1000,
            len(result),
        )
        return result

    @classmethod
    def _prepare_query_for_embedding(cls, query: str) -> str:
        q = str(query or "").strip()
        max_chars = max(1, int(cls._QUERY_EMBED_MAX_CHARS))
        if len(q) <= max_chars:
            return q

        head_chars = min(max_chars, max(1, int(cls._QUERY_EMBED_HEAD_CHARS)))
        tail_budget = max_chars - head_chars
        tail_chars = min(
            max(0, tail_budget),
            max(0, int(cls._QUERY_EMBED_TAIL_CHARS)),
        )
        if tail_chars <= 0:
            prepared = q[:max_chars]
        else:
            prepared = f"{q[:head_chars]}\n...\n{q[-tail_chars:]}"
            if len(prepared) > max_chars:
                prepared = prepared[:max_chars]

        logger.info(
            "ToolSyncService: truncate query for embedding original_len=%s prepared_len=%s",
            len(q),
            len(prepared),
        )
        return prepared

    async def _ensure_onboarding_tools_visibility(
        self, 
        current_tools: list[ToolDefinition],
        query: str,
        user_id: uuid.UUID | None
    ) -> list[ToolDefinition]:
        """对于学习、接入、注册等意图，强制确保 onboarding 技能可见"""
        lower_query = query.lower()
        onboarding_triggers = {"学习", "接入", "注册", "install", "learn", "github", "repo", "repository", "skill", "assistant"}
        
        is_onboarding_intent = any(trigger in lower_query for trigger in onboarding_triggers)
        if not is_onboarding_intent:
            return current_tools

        onboarding_ids = {"system.skill_onboarding", "system.assistant_onboarding"}
        existing_names = {t.name for t in current_tools}
        
        added_tools = []
        for oid in onboarding_ids:
            tool_name = f"skill__{oid}"
            if tool_name in existing_names:
                continue
            
            async with AsyncSessionLocal() as session:
                from app.repositories.skill_registry_repository import SkillRegistryRepository
                repo = SkillRegistryRepository(session)
                skill = await repo.get_by_id(oid)
                if skill and skill.status == "active":
                    manifest = skill.manifest_json or {}
                    schema = manifest.get("io_schema", {})
                    added_tools.append(ToolDefinition(
                        name=tool_name,
                        description=skill.description,
                        input_schema=_safe_schema(schema)
                    ))
                    logger.info("Injected onboarding tool %s due to intent match", tool_name)
                    
        # 置于首位且不截断原始结果（除非超过更大上限）
        return (added_tools + current_tools)[:40]

    async def _search_system(
        self,
        vector: list[float],
        *,
        limit: int,
        threshold: float,
    ) -> list[dict[str, Any]]:
        collection = get_tool_system_collection_name()
        client = get_qdrant_client()
        try:
            return await search_points(
                client,
                collection_name=collection,
                vector=vector,
                limit=limit,
                with_payload=True,
                score_threshold=threshold,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("system tool search failed col=%s err=%s", collection, exc)
            return []

    async def _search_skills(
        self,
        vector: list[float],
        *,
        limit: int,
        threshold: float,
    ) -> list[dict[str, Any]]:
        collection = get_skill_collection_name()
        client = get_qdrant_client()
        try:
            return await search_points(
                client,
                collection_name=collection,
                vector=vector,
                limit=limit,
                with_payload=True,
                score_threshold=threshold,
                query_filter={
                    "must": [{"key": "status", "match": {"value": "active"}}]
                },
            )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("skill search failed col=%s err=%s", collection, exc)
            return []

    async def _search_user(
        self,
        user_id: uuid.UUID,
        vector: list[float],
        *,
        limit: int,
        threshold: float,
    ) -> list[dict[str, Any]]:
        collection = get_kb_user_tool_collection_name(user_id)
        client = get_qdrant_client()
        try:
            return await search_points(
                client,
                collection_name=collection,
                vector=vector,
                limit=limit,
                with_payload=True,
                score_threshold=threshold,
            )
        except Exception as exc:  # pragma: no cover - fail-open
            error_msg = str(exc).lower()
            if "404" in error_msg or "not found" in error_msg:
                logger.info("User tool collection %s not found, triggering background sync", collection)
                self._trigger_background_user_sync(user_id)
            else:
                logger.warning("user tool search failed col=%s err=%s", collection, exc)
            return []

    def _trigger_background_user_sync(self, user_id: uuid.UUID):
        """异步触发用户工具同步任务"""
        from app.services.mcp.discovery import mcp_discovery_service
        
        async def _sync():
            try:
                # 重新获取 session 进行同步
                from app.core.database import AsyncSessionLocal
                async with AsyncSessionLocal() as session:
                    await mcp_discovery_service.sync_user_tools(session, user_id)
            except Exception as e:
                logger.error("Background tool sync failed for user %s: %s", user_id, e)

        try:
            import asyncio
            asyncio.create_task(_sync())
        except Exception as e:
            logger.error("Failed to create background sync task: %s", e)

    async def _rerank_skill_hits(
        self, skill_hits: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if not skill_hits:
            return skill_hits

        candidates: list[DecisionCandidate] = []
        hit_map: dict[str, dict[str, Any]] = {}
        for hit in skill_hits:
            payload = hit.get("payload") or {}
            skill_id = str(payload.get("skill_id") or "").strip()
            if not skill_id:
                continue
            arm_id = f"skill__{skill_id}"
            base_score = float(hit.get("score") or 0.0)
            candidates.append(DecisionCandidate(arm_id=arm_id, base_score=base_score))
            hit_map[arm_id] = hit

        if not candidates:
            return skill_hits

        try:
            decision_service = self._decision_service
            if decision_service is None:
                async with AsyncSessionLocal() as session:
                    repo = BanditRepository(session)
                    decision_service = DecisionService(
                        repo,
                        vector_weight=float(
                            getattr(settings, "DECISION_VECTOR_WEIGHT", 0.75) or 0.75
                        ),
                        bandit_weight=float(
                            getattr(settings, "DECISION_BANDIT_WEIGHT", 0.25) or 0.25
                        ),
                        exploration_bonus=float(
                            getattr(settings, "DECISION_EXPLORATION_BONUS", 0.3) or 0.3
                        ),
                        strategy=str(
                            getattr(settings, "DECISION_STRATEGY", "thompson")
                        ),
                        final_score=str(
                            getattr(settings, "DECISION_FINAL_SCORE", "weighted_sum")
                        ),
                        ucb_c=float(getattr(settings, "DECISION_UCB_C", 1.5) or 1.5),
                        ucb_min_trials=int(
                            getattr(settings, "DECISION_UCB_MIN_TRIALS", 5) or 5
                        ),
                        thompson_prior_alpha=float(
                            getattr(settings, "DECISION_THOMPSON_PRIOR_ALPHA", 1.0)
                            or 1.0
                        ),
                        thompson_prior_beta=float(
                            getattr(settings, "DECISION_THOMPSON_PRIOR_BETA", 1.0)
                            or 1.0
                        ),
                    )
                    ranked = await decision_service.rank_candidates(
                        "retrieval:skill",
                        candidates,
                    )
            else:
                ranked = await decision_service.rank_candidates(
                    "retrieval:skill",
                    candidates,
                )
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning("ToolSyncService: skill rerank failed", exc_info=exc)
            return skill_hits

        reranked: list[dict[str, Any]] = []
        for item in ranked:
            hit = hit_map.get(item.arm_id)
            if hit:
                reranked.append(hit)

        if len(reranked) < len(skill_hits):
            reranked.extend([hit for hit in skill_hits if hit not in reranked])

        return reranked

    def _merge_hits(
        self,
        user_hits: Iterable[dict[str, Any]],
        system_hits: Iterable[dict[str, Any]],
        skill_hits: Iterable[dict[str, Any]],
        total_limit: int,
    ) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()

        # 优先保证 Skill 命中的可见性（多样性保障）
        # 即使分值较低，只要过阈值，也给至少 3 个席位
        skill_list = list(skill_hits)
        system_list = list(system_hits)
        user_list = list(user_hits)

        # 1. 先加入 User Hits (最高权)
        for hit in user_list:
            name = self._get_hit_name(hit)
            if not name or name in seen:
                continue
            merged.append(hit)
            seen.add(name)
            if len(merged) >= total_limit:
                return merged

        # 2. 加入前 3 个 Skill Hits (保障位)
        for hit in skill_list[:3]:
            name = self._get_skill_name(hit)
            if not name or name in seen:
                continue
            if "payload" in hit:
                hit["payload"]["is_skill"] = True
            merged.append(hit)
            seen.add(name)

        # 3. 加入 System Hits
        for hit in system_list:
            name = self._get_hit_name(hit)
            if not name or name in seen:
                continue
            merged.append(hit)
            seen.add(name)
            if len(merged) >= total_limit:
                break

        # 4. 补齐剩余的 Skill Hits
        if len(merged) < total_limit:
            for hit in skill_list[3:]:
                name = self._get_skill_name(hit)
                if not name or name in seen:
                    continue
                if "payload" in hit:
                    hit["payload"]["is_skill"] = True
                merged.append(hit)
                seen.add(name)
                if len(merged) >= total_limit:
                    break

        return merged

    def _get_hit_name(self, hit: dict[str, Any]) -> str:
        payload = hit.get("payload") or {}
        return str(payload.get("tool_name") or payload.get("name") or "").strip()

    def _get_skill_name(self, hit: dict[str, Any]) -> str:
        payload = hit.get("payload") or {}
        skill_id = str(payload.get("skill_id") or "").strip()
        return f"skill__{skill_id}" if skill_id else ""

    def _hit_to_def(self, hit: dict[str, Any]) -> ToolDefinition:
        payload = hit.get("payload") or {}

        if payload.get("is_skill"):
            # Special handling for Skills
            skill_id = str(payload.get("skill_id") or "")
            name = f"skill__{skill_id}"
            # For skills, schema might need to be fetched or is simplified in payload
            # Assuming payload contains minimal info, we might need a richer payload in _search_skills
            # Ideally, Qdrant payload for skills should have 'manifest_json' or 'schema_json'
            # If not, we might need to fetch from DB, but that's slow.
            # Let's assume the ingestion task puts 'schema_json' or similar in payload.
            # Checking app/tasks/skill_registry.py: payload has 'name', 'status', 'description' but NOT schema.
            # WE NEED TO FIX INGESTION TO INCLUDE SCHEMA IN PAYLOAD for this to work effectively without DB lookup.
            # For now, we return a stub schema or rely on what's available.
            description = payload.get("description")
            return ToolDefinition(
                name=name,
                description=description,
                input_schema=_safe_schema(payload.get("schema_json")),
            )

        return ToolDefinition(
            name=str(payload.get("tool_name") or ""),
            description=payload.get("description"),
            input_schema=_safe_schema(payload.get("schema_json")),
            output_schema=_safe_schema(payload.get("output_schema_json")),
            output_description=payload.get("output_description"),
        )

    def _filter_skill_hits_for_user(
        self, skill_hits: list[dict[str, Any]], installed_skill_ids: set[str]
    ) -> list[dict[str, Any]]:
        filtered: list[dict[str, Any]] = []
        for hit in skill_hits:
            payload = hit.get("payload") or {}
            skill_id = str(payload.get("skill_id") or "").strip()
            if not skill_id:
                continue
            
            # Builtin skills (official system skills) bypass the installation check
            runtime = payload.get("runtime")
            if runtime == "builtin":
                filtered.append(hit)
                continue

            source_repo = str(payload.get("source_repo") or "").strip()
            # Repo-based marketplace plugins require user installation.
            if source_repo and skill_id not in installed_skill_ids:
                continue
            filtered.append(hit)
        return filtered

    async def _list_user_installed_skill_ids(self, user_id: uuid.UUID) -> set[str]:
        from app.models.user_skill_installation import UserSkillInstallation

        try:
            async with AsyncSessionLocal() as session:
                stmt = select(UserSkillInstallation.skill_id).where(
                    UserSkillInstallation.user_id == user_id,
                    UserSkillInstallation.is_enabled == True,
                )
                result = await session.execute(stmt)
                return {str(row[0]) for row in result.all() if row and row[0]}
        except Exception as exc:  # pragma: no cover - fail-open
            logger.warning(
                "ToolSyncService: failed to load installed skills user_id=%s",
                user_id,
                exc_info=exc,
            )
            return set()


tool_sync_service = ToolSyncService()
