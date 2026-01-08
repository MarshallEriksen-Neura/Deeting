import asyncio
import sys
import os

# Add backend to path
sys.path.append(os.getcwd())

from app.services.qdrant_service import system_qdrant
from loguru import logger

async def main():
    logger.info("Initializing Qdrant Collections...")
    try:
        await system_qdrant.initialize_collections()
        logger.info("Successfully initialized collections.")
    except Exception as e:
        logger.exception(f"Failed to initialize collections: {e}")

if __name__ == "__main__":
    asyncio.run(main())
