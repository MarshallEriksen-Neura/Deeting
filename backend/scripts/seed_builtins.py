import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.getcwd())

from app.tasks.skill_registry import _run_seed_builtins
from loguru import logger

async def main():
    logger.info("Seeding builtin skills from packages/official-skills...")
    try:
        stats = await _run_seed_builtins()
        logger.info(f"Seeding completed: {stats}")
    except Exception as e:
        logger.exception(f"Seeding failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
