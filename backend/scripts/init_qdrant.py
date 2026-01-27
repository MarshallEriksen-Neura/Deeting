import asyncio
import sys
import os

# Add backend to path
sys.path.append(os.getcwd())

from app.services.memory.qdrant_service import system_qdrant
from app.services.agent import agent_service
from app.services.tools.tool_sync_service import tool_sync_service
from loguru import logger

async def main():
    logger.info("Initializing Qdrant Collections...")
    try:
        await system_qdrant.initialize_collections()
        await agent_service.initialize()
        synced = await tool_sync_service.sync_system_tools(agent_service.tools)
        logger.info("Synced %s system tools to Qdrant tool index.", synced)
        logger.info("Successfully initialized collections.")
    except Exception as e:
        logger.exception(f"Failed to initialize collections: {e}")

if __name__ == "__main__":
    asyncio.run(main())
