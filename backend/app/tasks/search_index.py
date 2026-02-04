from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_, select

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.meilisearch_client import meilisearch_is_configured
from app.models.assistant import (
    Assistant,
    AssistantStatus,
    AssistantVersion,
    AssistantVisibility,
)
from app.models.provider_preset import ProviderPreset
from app.models.review import ReviewStatus, ReviewTask
from app.repositories.assistant_tag_repository import (
    AssistantTagLinkRepository,
    AssistantTagRepository,
)
from app.repositories.mcp_market_repository import McpMarketRepository
from app.repositories.provider_preset_repository import ProviderPresetRepository
from app.services.assistant.assistant_market_service import ASSISTANT_MARKET_ENTITY
from app.services.assistant.assistant_tag_service import AssistantTagService
from app.services.search.indexers import MeilisearchIndexService

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 200


def _index_prefix() -> str:
    return settings.MEILISEARCH_INDEX_PREFIX or "ai_gateway"


def _assistants_public_index() -> str:
    return f"{_index_prefix()}_assistants_public"


def _assistants_market_index() -> str:
    return f"{_index_prefix()}_assistants_market"


def _mcp_market_index() -> str:
    return f"{_index_prefix()}_mcp_market_tools"


def _provider_presets_index() -> str:
    return f"{_index_prefix()}_provider_presets"


def _chunked(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def _enum_value(value: Any) -> str:
    if hasattr(value, "value"):
        return str(value.value)
    return str(value)


def _build_assistant_doc(
    assistant: Assistant,
    version: AssistantVersion,
    tags: list[str],
) -> dict[str, Any]:
    return {
        "id": str(assistant.id),
        "assistant_id": str(assistant.id),
        "name": version.name,
        "description": version.description,
        "summary": assistant.summary,
        "system_prompt": version.system_prompt,
        "tags": tags,
        "visibility": _enum_value(assistant.visibility),
        "status": _enum_value(assistant.status),
        "created_at": (
            assistant.created_at.isoformat() if assistant.created_at else None
        ),
        "published_at": (
            assistant.published_at.isoformat() if assistant.published_at else None
        ),
    }


def _build_provider_preset_doc(preset: ProviderPreset) -> dict[str, Any]:
    return {
        "id": preset.slug,
        "slug": preset.slug,
        "name": preset.name,
        "provider": preset.provider,
        "category": preset.category or "",
        "icon": preset.icon,
        "theme_color": preset.theme_color,
        "is_active": preset.is_active,
    }


async def _load_assistant_tags(session, assistant_ids: list[UUID]):
    if not assistant_ids:
        return {}
    tag_service = AssistantTagService(
        AssistantTagRepository(session),
        AssistantTagLinkRepository(session),
    )
    return await tag_service.list_tags_for_assistants(assistant_ids)


async def _fetch_public_assistants(session) -> list[tuple[Assistant, AssistantVersion]]:
    stmt = (
        select(Assistant, AssistantVersion)
        .join(AssistantVersion, AssistantVersion.id == Assistant.current_version_id)
        .where(
            Assistant.visibility == AssistantVisibility.PUBLIC.value,
            Assistant.status == AssistantStatus.PUBLISHED.value,
        )
    )
    result = await session.execute(stmt)
    return list(result.all())


async def _fetch_market_assistants(session) -> list[tuple[Assistant, AssistantVersion]]:
    stmt = (
        select(Assistant, AssistantVersion)
        .join(AssistantVersion, AssistantVersion.id == Assistant.current_version_id)
        .outerjoin(
            ReviewTask,
            and_(
                ReviewTask.entity_type == ASSISTANT_MARKET_ENTITY,
                ReviewTask.entity_id == Assistant.id,
            ),
        )
        .where(
            Assistant.visibility == AssistantVisibility.PUBLIC.value,
            Assistant.status == AssistantStatus.PUBLISHED.value,
            or_(
                Assistant.owner_user_id.is_(None),
                ReviewTask.status == ReviewStatus.APPROVED.value,
            ),
        )
    )
    result = await session.execute(stmt)
    return list(result.all())


async def _upsert_documents(
    svc: MeilisearchIndexService,
    *,
    index: str,
    docs: list[dict[str, Any]],
) -> None:
    for chunk in _chunked(docs, DEFAULT_BATCH_SIZE):
        await svc.upsert_documents(index=index, docs=chunk)


async def _safe_delete_all(svc: MeilisearchIndexService, *, index: str) -> None:
    try:
        await svc.delete_all_documents(index=index)
    except RuntimeError as exc:
        logger.warning("meilisearch_delete_all_failed", exc_info=exc)


async def _rebuild_mcp_tools(session, svc: MeilisearchIndexService) -> None:
    repo = McpMarketRepository(session)
    tools = await repo.list_market_tools()
    docs = [MeilisearchIndexService.build_mcp_tool_doc(tool) for tool in tools]
    await _safe_delete_all(svc, index=_mcp_market_index())
    await _upsert_documents(svc, index=_mcp_market_index(), docs=docs)


async def _rebuild_provider_presets(session, svc: MeilisearchIndexService) -> None:
    repo = ProviderPresetRepository(session)
    presets = await repo.get_active_presets()
    docs = [_build_provider_preset_doc(preset) for preset in presets]
    await _safe_delete_all(svc, index=_provider_presets_index())
    await _upsert_documents(svc, index=_provider_presets_index(), docs=docs)


async def _rebuild_public_assistants(session, svc: MeilisearchIndexService) -> None:
    rows = await _fetch_public_assistants(session)
    assistant_ids = [assistant.id for assistant, _ in rows]
    tags_map = await _load_assistant_tags(session, assistant_ids)
    docs = [
        _build_assistant_doc(assistant, version, tags_map.get(assistant.id, []))
        for assistant, version in rows
    ]
    await _safe_delete_all(svc, index=_assistants_public_index())
    await _upsert_documents(svc, index=_assistants_public_index(), docs=docs)


async def _rebuild_market_assistants(session, svc: MeilisearchIndexService) -> None:
    rows = await _fetch_market_assistants(session)
    assistant_ids = [assistant.id for assistant, _ in rows]
    tags_map = await _load_assistant_tags(session, assistant_ids)
    docs = [
        _build_assistant_doc(assistant, version, tags_map.get(assistant.id, []))
        for assistant, version in rows
    ]
    await _safe_delete_all(svc, index=_assistants_market_index())
    await _upsert_documents(svc, index=_assistants_market_index(), docs=docs)


async def _run_rebuild_all() -> str:
    if not meilisearch_is_configured():
        return "skipped"
    async with AsyncSessionLocal() as session:
        svc = MeilisearchIndexService()
        await _rebuild_mcp_tools(session, svc)
        await _rebuild_provider_presets(session, svc)
        await _rebuild_public_assistants(session, svc)
        await _rebuild_market_assistants(session, svc)
    return "ok"


async def _run_upsert_mcp_tool(tool_id: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    try:
        tool_uuid = UUID(tool_id)
    except Exception:
        return "invalid_id"

    async with AsyncSessionLocal() as session:
        repo = McpMarketRepository(session)
        tool = await repo.get_market_tool(tool_uuid)
        svc = MeilisearchIndexService()
        if not tool:
            await svc.delete_documents(
                index=_mcp_market_index(),
                ids=[tool_id],
            )
            return "deleted"
        doc = MeilisearchIndexService.build_mcp_tool_doc(tool)
        await svc.upsert_documents(
            index=_mcp_market_index(),
            docs=[doc],
        )
        return "upserted"


async def _run_delete_mcp_tool(tool_id: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    await MeilisearchIndexService().delete_documents(
        index=_mcp_market_index(),
        ids=[tool_id],
    )
    return "deleted"


async def _run_upsert_provider_preset(slug: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    cleaned = str(slug or "").strip()
    if not cleaned:
        return "invalid_slug"

    async with AsyncSessionLocal() as session:
        repo = ProviderPresetRepository(session)
        preset = await repo.get_by_slug(cleaned)
        svc = MeilisearchIndexService()
        if not preset or not preset.is_active:
            await svc.delete_documents(
                index=_provider_presets_index(),
                ids=[cleaned],
            )
            return "deleted"
        doc = _build_provider_preset_doc(preset)
        await svc.upsert_documents(
            index=_provider_presets_index(),
            docs=[doc],
        )
        return "upserted"


async def _run_delete_provider_preset(slug: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    cleaned = str(slug or "").strip()
    if not cleaned:
        return "invalid_slug"
    await MeilisearchIndexService().delete_documents(
        index=_provider_presets_index(),
        ids=[cleaned],
    )
    return "deleted"


async def _run_upsert_assistant(assistant_id: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    try:
        assistant_uuid = UUID(assistant_id)
    except Exception:
        return "invalid_id"

    async with AsyncSessionLocal() as session:
        stmt = (
            select(Assistant, AssistantVersion)
            .join(AssistantVersion, AssistantVersion.id == Assistant.current_version_id)
            .where(Assistant.id == assistant_uuid)
        )
        result = await session.execute(stmt)
        row = result.first()
        svc = MeilisearchIndexService()
        if not row:
            await svc.delete_documents(
                index=_assistants_public_index(),
                ids=[assistant_id],
            )
            await svc.delete_documents(
                index=_assistants_market_index(),
                ids=[assistant_id],
            )
            return "deleted"

        assistant, version = row
        visibility = _enum_value(assistant.visibility)
        status = _enum_value(assistant.status)
        if (
            visibility != AssistantVisibility.PUBLIC.value
            or status != AssistantStatus.PUBLISHED.value
        ):
            await svc.delete_documents(
                index=_assistants_public_index(),
                ids=[assistant_id],
            )
            await svc.delete_documents(
                index=_assistants_market_index(),
                ids=[assistant_id],
            )
            return "deleted"

        tags_map = await _load_assistant_tags(session, [assistant.id])
        doc = _build_assistant_doc(assistant, version, tags_map.get(assistant.id, []))
        await svc.upsert_documents(index=_assistants_public_index(), docs=[doc])

        if assistant.owner_user_id is None:
            await svc.upsert_documents(index=_assistants_market_index(), docs=[doc])
            return "upserted"

        review_stmt = select(ReviewTask).where(
            ReviewTask.entity_type == ASSISTANT_MARKET_ENTITY,
            ReviewTask.entity_id == assistant.id,
        )
        review = (await session.execute(review_stmt)).scalar_one_or_none()
        status_value = _enum_value(review.status) if review else ""
        if status_value == ReviewStatus.APPROVED.value:
            await svc.upsert_documents(index=_assistants_market_index(), docs=[doc])
            return "upserted"

        await svc.delete_documents(index=_assistants_market_index(), ids=[assistant_id])
        return "upserted"


async def _run_delete_assistant(assistant_id: str) -> str:
    if not meilisearch_is_configured():
        return "skipped"
    await MeilisearchIndexService().delete_documents(
        index=_assistants_public_index(),
        ids=[assistant_id],
    )
    await MeilisearchIndexService().delete_documents(
        index=_assistants_market_index(),
        ids=[assistant_id],
    )
    return "deleted"


@celery_app.task(name="search_index.rebuild_all")
def rebuild_all_task() -> str:
    try:
        return asyncio.run(_run_rebuild_all())
    except Exception as exc:
        logger.exception("search_index_rebuild_all_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.upsert_mcp_tool")
def upsert_mcp_tool_task(tool_id: str) -> str:
    try:
        return asyncio.run(_run_upsert_mcp_tool(tool_id))
    except Exception as exc:
        logger.exception("search_index_upsert_mcp_tool_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.delete_mcp_tool")
def delete_mcp_tool_task(tool_id: str) -> str:
    try:
        return asyncio.run(_run_delete_mcp_tool(tool_id))
    except Exception as exc:
        logger.exception("search_index_delete_mcp_tool_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.upsert_provider_preset")
def upsert_provider_preset_task(slug: str) -> str:
    try:
        return asyncio.run(_run_upsert_provider_preset(slug))
    except Exception as exc:
        logger.exception("search_index_upsert_provider_preset_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.delete_provider_preset")
def delete_provider_preset_task(slug: str) -> str:
    try:
        return asyncio.run(_run_delete_provider_preset(slug))
    except Exception as exc:
        logger.exception("search_index_delete_provider_preset_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.upsert_assistant")
def upsert_assistant_task(assistant_id: str) -> str:
    try:
        return asyncio.run(_run_upsert_assistant(assistant_id))
    except Exception as exc:
        logger.exception("search_index_upsert_assistant_failed: %s", exc)
        return "failed"


@celery_app.task(name="search_index.delete_assistant")
def delete_assistant_task(assistant_id: str) -> str:
    try:
        return asyncio.run(_run_delete_assistant(assistant_id))
    except Exception as exc:
        logger.exception("search_index_delete_assistant_failed: %s", exc)
        return "failed"
