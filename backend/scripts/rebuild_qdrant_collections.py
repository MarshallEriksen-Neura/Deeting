import argparse
import asyncio
import os
import sys
from typing import Iterable

from loguru import logger
from sqlalchemy import select

# Add backend to path
sys.path.append(os.getcwd())

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.assistant import Assistant
from app.models.knowledge import KnowledgeArtifact
from app.models.skill_registry import SkillRegistry
from app.qdrant_client import (
    close_qdrant_client_for_current_loop,
    get_qdrant_client,
    qdrant_is_configured,
)
from app.services.memory.qdrant_service import (
    COLLECTION_PLUGIN_MARKETPLACE,
    COLLECTION_SEMANTIC_CACHE,
    system_qdrant,
)
from app.storage.qdrant_kb_collections import (
    get_kb_candidates_collection_name,
    get_kb_system_collection_name,
    get_skill_collection_name,
    get_tool_system_collection_name,
)
from app.storage.qdrant_kb_store import ensure_collection_vector_size
from app.tasks.assistant import ASSISTANT_COLLECTION_NAME, _run_sync_assistant
from app.tasks.knowledge_tasks import _index_knowledge_artifact_async
from app.tasks.skill_registry import _run_sync_skill


def _unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        cleaned = (item or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _system_collections() -> list[str]:
    return _unique(
        [
            COLLECTION_PLUGIN_MARKETPLACE,
            COLLECTION_SEMANTIC_CACHE,
            get_kb_system_collection_name(),
            get_kb_candidates_collection_name(),
            get_tool_system_collection_name(),
            get_skill_collection_name(),
            ASSISTANT_COLLECTION_NAME,
        ]
    )


def _user_collection_names(all_collections: list[str]) -> list[str]:
    prefix = str(
        getattr(settings, "QDRANT_KB_USER_COLLECTION", "kb_user") or "kb_user"
    ).strip()
    tool_prefix = str(
        getattr(settings, "QDRANT_TOOL_USER_COLLECTION_PREFIX", "kb_user") or "kb_user"
    ).strip()
    shared = str(
        getattr(settings, "QDRANT_KB_USER_SHARED_COLLECTION", "kb_shared_v1")
        or "kb_shared_v1"
    ).strip()

    user_names: list[str] = []
    for name in all_collections:
        if shared and name == shared:
            user_names.append(name)
            continue
        if prefix and name.startswith(f"{prefix}_"):
            user_names.append(name)
            continue
        if tool_prefix and name.startswith(f"{tool_prefix}_") and name.endswith("_tools"):
            user_names.append(name)
            continue
    return _unique(user_names)


async def _list_collections() -> list[str]:
    client = get_qdrant_client()
    resp = await client.get("/collections")
    resp.raise_for_status()
    data = resp.json().get("result", {}).get("collections", [])
    return _unique([item.get("name") for item in data if isinstance(item, dict)])


async def _delete_collections(names: list[str]) -> None:
    client = get_qdrant_client()
    for name in names:
        resp = await client.delete(f"/collections/{name}")
        if resp.status_code == 404:
            logger.info("Skip missing collection: {}", name)
            continue
        resp.raise_for_status()
        logger.info("Deleted collection: {}", name)


async def _init_system_collections() -> None:
    from app.services.agent import agent_service
    from app.services.tools.tool_sync_service import tool_sync_service

    await system_qdrant.initialize_collections()
    await agent_service.initialize()
    synced = await tool_sync_service.sync_system_tools(agent_service.tools)
    logger.info("Synced {} system tools to Qdrant tool index.", synced)
    await ensure_collection_vector_size(
        get_qdrant_client(),
        collection_name=get_skill_collection_name(),
        vector_size=1536,
    )
    logger.info("Ensured skill registry collection: {}", get_skill_collection_name())


async def _reindex_skills() -> None:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(select(SkillRegistry.id))
        skill_ids = [str(item) for item in rows.scalars().all()]
    if not skill_ids:
        logger.info("No skills found to reindex.")
        return
    for skill_id in skill_ids:
        await _run_sync_skill(skill_id)


async def _reindex_assistants() -> None:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(select(Assistant.id))
        assistant_ids = rows.scalars().all()
    if not assistant_ids:
        logger.info("No assistants found to reindex.")
        return
    for assistant_id in assistant_ids:
        await _run_sync_assistant(assistant_id)


async def _reindex_knowledge_artifacts() -> None:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            select(KnowledgeArtifact.id).where(KnowledgeArtifact.status == "indexed")
        )
        artifact_ids = [str(item) for item in rows.scalars().all()]
    if not artifact_ids:
        logger.info("No knowledge artifacts found to reindex.")
        return
    for artifact_id in artifact_ids:
        try:
            await _index_knowledge_artifact_async(artifact_id)
        except Exception as exc:
            logger.warning("Reindex artifact failed: {} err={}", artifact_id, exc)


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rebuild Qdrant collections for this project."
    )
    parser.add_argument(
        "--include-user",
        action="store_true",
        help="Also delete user collections (kb_user* / shared / *_tools).",
    )
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Reindex skills + assistants + knowledge artifacts after rebuild.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Execute deletion. Without this flag, only prints plan.",
    )
    args = parser.parse_args()

    if not qdrant_is_configured():
        logger.error("Qdrant is not configured. Aborting.")
        return

    all_collections = await _list_collections()
    system_names = _system_collections()
    target_names = [name for name in system_names if name in all_collections]

    if args.include_user:
        target_names.extend(_user_collection_names(all_collections))
        target_names = _unique(target_names)

    logger.info("Existing collections: {}", all_collections)
    logger.info("Collections to delete: {}", target_names)

    if not args.force:
        logger.warning("Dry-run only. Re-run with --force to execute deletion.")
        return

    try:
        await _delete_collections(target_names)
        await _init_system_collections()
        if args.reindex:
            await _reindex_skills()
            await _reindex_assistants()
            await _reindex_knowledge_artifacts()
    finally:
        await close_qdrant_client_for_current_loop()


if __name__ == "__main__":
    asyncio.run(main())
