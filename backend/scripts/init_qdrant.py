import asyncio
import sys
import os

# Add backend to path
sys.path.append(os.getcwd())

from app.services.memory.qdrant_service import system_qdrant
from app.services.agent import agent_service
from app.services.tools.tool_sync_service import tool_sync_service
from app.storage.qdrant_kb_store import ensure_collection_vector_size
from app.qdrant_client import qdrant_is_configured, get_qdrant_client
from app.tasks.skill_registry import SKILL_COLLECTION_NAME
from loguru import logger

async def main():
    logger.info("Initializing Qdrant Collections...")
    try:
        await system_qdrant.initialize_collections()
        await agent_service.initialize()
        synced = await tool_sync_service.sync_system_tools(agent_service.tools)
        logger.info("Synced %s system tools to Qdrant tool index.", synced)
        if qdrant_is_configured():
            await ensure_collection_vector_size(
                get_qdrant_client(),
                collection_name=SKILL_COLLECTION_NAME,
                vector_size=1536,
            )
            logger.info("Ensured skill registry collection: %s", SKILL_COLLECTION_NAME)
        logger.info("Successfully initialized collections.")
    except Exception as e:
        logger.exception(f"Failed to initialize collections: {e}")

if __name__ == "__main__":
    asyncio.run(main())
