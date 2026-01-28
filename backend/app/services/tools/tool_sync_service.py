import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.config import settings
from app.core.plugin_config import plugin_config_loader
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.schemas.tool import ToolDefinition
from app.services.indexing.index_sync_service import QdrantIndexSyncService, stable_fingerprint
from app.services.providers.embedding import EmbeddingService
from app.storage.qdrant_kb_collections import (
    get_kb_user_tool_collection_name,
    get_tool_system_collection_name,
)
from app.storage.qdrant_kb_store import (
    delete_points,
    search_points,
    scroll_points,
)

logger = logging.getLogger(__name__)


def _safe_schema(schema: Any) -> Dict[str, Any]:
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

    def __init__(self, embedding_service: EmbeddingService | None = None):
        self._embedding_service = embedding_service or EmbeddingService()
        self._index_syncer = QdrantIndexSyncService(self._embedding_service)

    # =========================================================================
    # 1. Sync Logic (Write Path)
    # =========================================================================

    async def sync_system_tools(self, tools: List[ToolDefinition]) -> int:
        """
        同步系统级工具到 Qdrant 系统索引。
        仅索引 enabled_by_default=True 且 is_always_on=False 的工具。
        """
        if not qdrant_is_configured():
            return 0

        enabled_plugins = plugin_config_loader.get_enabled_plugins()
        if not enabled_plugins:
            return 0

        core_tool_names: set[str] = set()
        tool_name_to_plugin: dict[str, str] = {}
        allowed_tool_names: set[str] = set()
        for plugin in enabled_plugins:
            allowed_tool_names.update(plugin.tools or [])
            for tool_name in plugin.tools or []:
                tool_name_to_plugin.setdefault(tool_name, plugin.id)
            if plugin.is_always_on:
                core_tool_names.update(plugin.tools or [])

        to_index = [
            tool for tool in tools
            if tool.name in allowed_tool_names and tool.name not in core_tool_names
        ]
        if not to_index:
            return 0

        collection = get_tool_system_collection_name()
        new_items = [
            SystemToolIndexItem(tool=tool, plugin_id=tool_name_to_plugin.get(tool.name, "system"))
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
                "embedding_model": getattr(self._embedding_service, "model", None),
            },
            id_fn=lambda item: _make_point_id("system", item.plugin_id, item.tool.name),
        )
        try:
            ttl = int(getattr(settings, "MCP_TOOL_SYSTEM_INDEX_HASH_TTL_SECONDS", 86400) or 86400)
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
        new_tools: List[ToolDefinition],
        old_disabled: set[str] | None = None,
        new_disabled: set[str] | None = None,
    ) -> int:
        if not qdrant_is_configured():
            return 0

        old_disabled_set = old_disabled or set()
        new_disabled_set = new_disabled or set()

        old_tools = self._payloads_to_tools(old_payloads, old_disabled_set)
        new_enabled_tools = [tool for tool in new_tools if tool.name not in new_disabled_set]

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

    async def _load_system_index_items(self, collection_name: str) -> list[SystemToolIndexItem]:
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
                    query_filter={"must": [{"key": "scope", "match": {"value": "system"}}]},
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
        user_id: Optional[uuid.UUID] = None,
    ) -> List[ToolDefinition]:
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

        embed_start = time.perf_counter()
        vector = await self._embedding_service.embed_text(q)
        logger.info(
            "ToolSyncService: embedding duration_ms=%.2f",
            (time.perf_counter() - embed_start) * 1000,
        )

        sys_limit = int(getattr(settings, "MCP_TOOL_SYSTEM_TOPK", 3) or 3)
        user_limit = int(getattr(settings, "MCP_TOOL_USER_TOPK", 5) or 5)
        total_limit = max(1, sys_limit + user_limit)
        threshold = float(getattr(settings, "MCP_TOOL_SCORE_THRESHOLD", 0.75) or 0.75)

        sys_start = time.perf_counter()
        sys_hits = await self._search_system(vector, limit=total_limit, threshold=threshold)
        logger.info(
            "ToolSyncService: system search duration_ms=%.2f hits=%s",
            (time.perf_counter() - sys_start) * 1000,
            len(sys_hits),
        )
        user_hits: list[dict[str, Any]] = []
        if user_id:
            user_start = time.perf_counter()
            user_hits = await self._search_user(user_id, vector, limit=user_limit, threshold=threshold)
            logger.info(
                "ToolSyncService: user search duration_ms=%.2f hits=%s",
                (time.perf_counter() - user_start) * 1000,
                len(user_hits),
            )

        final_hits = self._merge_hits(user_hits, sys_hits, total_limit)
        result = [self._hit_to_def(hit) for hit in final_hits]
        logger.info(
            "ToolSyncService: search_tools done duration_ms=%.2f final_hits=%s",
            (time.perf_counter() - start_time) * 1000,
            len(result),
        )
        return result

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
            logger.warning("system tool search failed", exc_info=exc)
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
            logger.warning("user tool search failed", exc_info=exc)
            return []

    def _merge_hits(
        self,
        user_hits: Iterable[dict[str, Any]],
        system_hits: Iterable[dict[str, Any]],
        total_limit: int,
    ) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()

        for hit in user_hits:
            name = self._get_hit_name(hit)
            if not name or name in seen:
                continue
            merged.append(hit)
            seen.add(name)
            if len(merged) >= total_limit:
                return merged

        for hit in system_hits:
            name = self._get_hit_name(hit)
            if not name or name in seen:
                continue
            merged.append(hit)
            seen.add(name)
            if len(merged) >= total_limit:
                break

        return merged

    def _get_hit_name(self, hit: dict[str, Any]) -> str:
        payload = hit.get("payload") or {}
        return str(payload.get("tool_name") or payload.get("name") or "").strip()

    def _hit_to_def(self, hit: Dict[str, Any]) -> ToolDefinition:
        payload = hit.get("payload") or {}
        return ToolDefinition(
            name=str(payload.get("tool_name") or ""),
            description=payload.get("description"),
            input_schema=_safe_schema(payload.get("schema_json")),
        )


tool_sync_service = ToolSyncService()
