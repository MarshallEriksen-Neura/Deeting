import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.getcwd())

from loguru import logger

from app.core.config import settings
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.services.agent import agent_service
from app.services.memory.qdrant_service import (
    COLLECTION_KB_CANDIDATES,
    COLLECTION_KB_SYSTEM,
    COLLECTION_PLUGIN_MARKETPLACE,
    COLLECTION_SEMANTIC_CACHE,
    COLLECTION_SYS_TOOL_INDEX,
    system_qdrant,
)
from app.services.tools.tool_sync_service import tool_sync_service
from app.storage.qdrant_kb_store import (
    QDRANT_DEFAULT_VECTOR_NAME,
    ensure_collection_vector_size,
)
from app.tasks.assistant import ASSISTANT_COLLECTION_NAME
from app.tasks.skill_registry import (
    SKILL_COLLECTION_NAME,
    _run_sync_all_active_skills,
)


async def _list_collections() -> list[str]:
    client = get_qdrant_client()
    resp = await client.get("/collections")
    resp.raise_for_status()
    payload = resp.json()
    collections = payload.get("result", {}).get("collections", [])
    return [
        item.get("name")
        for item in collections
        if isinstance(item, dict) and item.get("name")
    ]


async def _inspect_collection(
    name: str, *, expected_size: int
) -> tuple[str, int | list[str] | None]:
    client = get_qdrant_client()
    resp = await client.get(f"/collections/{name}")
    if resp.status_code == 404:
        return "missing", None
    resp.raise_for_status()
    payload = resp.json()
    vectors = (
        payload.get("result", {})
        .get("config", {})
        .get("params", {})
        .get("vectors")
    )
    if not isinstance(vectors, dict):
        return "invalid_vectors", None
    if "size" in vectors:
        size = vectors.get("size")
        return "unnamed_vector", size if isinstance(size, int) else None
    names = [key for key in vectors.keys() if isinstance(key, str) and key]
    if QDRANT_DEFAULT_VECTOR_NAME not in names:
        return "vector_name_mismatch", names
    size = vectors.get(QDRANT_DEFAULT_VECTOR_NAME, {}).get("size")
    if isinstance(size, int) and size != expected_size:
        return "size_mismatch", size
    return "ok", size if isinstance(size, int) else None


def _filter_user_collections(all_collections: list[str]) -> list[str]:
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
    return user_names


async def _self_check() -> None:
    if not qdrant_is_configured():
        logger.warning("Qdrant is not configured; skip self-check.")
        return
    all_collections = await _list_collections()
    expected = [
        COLLECTION_PLUGIN_MARKETPLACE,
        COLLECTION_SEMANTIC_CACHE,
        COLLECTION_KB_SYSTEM,
        COLLECTION_KB_CANDIDATES,
        COLLECTION_SYS_TOOL_INDEX,
        SKILL_COLLECTION_NAME,
        ASSISTANT_COLLECTION_NAME,
    ]
    issues: list[str] = []
    for name in expected:
        status, detail = await _inspect_collection(name, expected_size=1536)
        if status == "missing":
            logger.warning("Missing collection: {}", name)
            continue
        if status != "ok":
            issues.append(f"{name} => {status} ({detail})")
    for name in _filter_user_collections(all_collections):
        status, detail = await _inspect_collection(name, expected_size=1536)
        if status != "ok":
            issues.append(f"{name} => {status} ({detail})")
    if issues:
        logger.error("Qdrant self-check failed:")
        for item in issues:
            logger.error(" - {}", item)
        raise RuntimeError("qdrant self-check failed; please rebuild collections")
    logger.info("Qdrant self-check passed.")


async def main():
    logger.info("Initializing Qdrant Collections...")
    try:
        await system_qdrant.initialize_collections()
        await agent_service.initialize()
        synced = await tool_sync_service.sync_system_tools(agent_service.tools)
        logger.info("Synced {} system tools to Qdrant tool index.", synced)
        if qdrant_is_configured():
            await ensure_collection_vector_size(
                get_qdrant_client(),
                collection_name=SKILL_COLLECTION_NAME,
                vector_size=1536,
            )
            logger.info("Ensured skill registry collection: {}", SKILL_COLLECTION_NAME)

            # Sync active skills (System Skills) to Qdrant
            synced_skills = await _run_sync_all_active_skills()
            logger.info("Synced {} active skills to Qdrant.", synced_skills)

            await _self_check()
        logger.info("Successfully initialized collections.")
    except Exception as e:
        logger.exception(f"Failed to initialize collections: {e}")


if __name__ == "__main__":
    asyncio.run(main())
