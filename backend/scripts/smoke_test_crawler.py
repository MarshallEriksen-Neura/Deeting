import asyncio
import uuid
import logging
from typing import Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Changed to absolute imports assuming backend is the root package being added to PYTHONPATH
from app.agent_plugins.core.interfaces import PluginContext, PluginMetadata
from app.core.database import AsyncSessionLocal
from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin


class MockPluginContext(PluginContext):
    def __init__(self, user_id: uuid.UUID, session: Any, logger_instance: logging.Logger):
        self._user_id = user_id
        self._session = session
        self._logger = logger_instance
    
    @property
    def user_id(self) -> uuid.UUID:
        return self._user_id

    @property
    def session_id(self) -> str | None:
        return None

    @property
    def working_directory(self) -> str:
        return "/tmp/plugin_working_dir" # Dummy path

    def get_logger(self, name: str | None = None):
        return self._logger

    def get_db_session(self) -> Any:
        return self._session

    def get_config(self, key: str, default: Any = None) -> Any:
        return default

    @property
    def memory(self) -> Any:
        return None


async def run_smoke_test():
    test_url = "https://github.com/f/prompts.chat?tab=readme-ov-file"
    dummy_user_id = uuid.UUID("820ae05c-6900-4b07-b3d1-1f1a0959bbd5") # Using user-specified ID

    logger.info(f"Starting smoke test for crawler with URL: {test_url}")

    async with AsyncSessionLocal() as session:
        # Create a mock AgentContext for the plugin
        # The CrawlerPlugin does not strictly require a superuser for these specific handlers
        # but a context with a user_id is good practice.
        mock_context = MockPluginContext(
            user_id=dummy_user_id,
            session=session,
            logger_instance=logger # Pass the logger instance
        )
        crawler_plugin = CrawlerPlugin()
        await crawler_plugin.initialize(mock_context)

        logger.info("Step 1: Calling handle_crawl_website...")
        crawl_result = await crawler_plugin.handle_crawl_website(
            url=test_url,
            max_depth=1, # Keep it shallow for smoke test
            max_pages=5 # Limit pages for smoke test
        )

        if crawl_result.get("status") == "error":
            logger.error(f"Crawling failed: {crawl_result.get('error')}")
            return

        artifact_ids = crawl_result.get("artifact_ids")
        if not artifact_ids:
            logger.warning("No artifact_ids returned from crawling. Cannot proceed to conversion.")
            logger.info(f"Crawl result: {crawl_result}")
            return

        logger.info(f"Successfully crawled. Returned artifact_ids: {artifact_ids}")

        # Assuming we want to convert the first artifact
        first_artifact_id = artifact_ids[0]
        logger.info(f"Debug: artifact_id for conversion: {repr(first_artifact_id)}, type: {type(first_artifact_id)}")
        logger.info(f"Step 2: Converting artifact '{first_artifact_id}' to Assistant...")
        convert_result = await crawler_plugin.handle_convert_artifact_to_assistant(
            artifact_id=first_artifact_id,
            user_id=dummy_user_id # Pass dummy_user_id
        )

        if convert_result.get("status") == "error":
            logger.error(f"Assistant conversion failed: {convert_result.get('message')}")
            return

        assistant_id = convert_result.get("assistant_id")
        logger.info(f"Successfully converted to Assistant! Assistant ID: {assistant_id}")
        logger.info("Smoke test completed successfully!")
        logger.info(f"Conversion result: {convert_result}")


if __name__ == "__main__":
    asyncio.run(run_smoke_test())
