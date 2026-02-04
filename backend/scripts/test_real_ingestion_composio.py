import asyncio
import logging
import os
import sys
from pathlib import Path
from unittest.mock import patch

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Add parent directory to path
sys.path.append(os.getcwd())

try:
    from dotenv import load_dotenv

    # Explicitly point to backend/.env if running from project root, or .env if running from backend
    env_path = Path("backend/.env") if Path("backend").exists() else Path(".env")
    load_dotenv(env_path)
except ImportError:
    pass

from app.core.database import AsyncSessionLocal
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.services.skill_registry.dry_run_service import SkillDryRunService
from app.services.skill_registry.manifest_generator import SkillManifestGenerator
from app.services.skill_registry.parsers.python_parser import PythonRepoParser
from app.services.skill_registry.repo_ingestion_service import RepoIngestionService
from app.services.skill_registry.skill_metrics_service import SkillMetricsService
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor


# ---------------------------------------------------------
# 1. 定义直连 LLM 适配器
# ---------------------------------------------------------
class RealTestLLMService:
    def __init__(self):
        from openai import AsyncOpenAI

        api_key = os.environ.get("TEST_API_KEY")
        base_url = os.environ.get("TEST_LLM_BASE_URL")
        self.model = os.environ.get("TEST_LLM_MODEL", "gpt-4o")

        if not api_key:
            raise ValueError("❌ TEST_API_KEY is not set in .env")

        if base_url and not base_url.endswith("/v1"):
            base_url = base_url.rstrip("/") + "/v1"

        logger.info(
            f"✅ RealTestLLMService initialized with model={self.model}, base_url={base_url}"
        )
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def chat_completion(self, messages, **kwargs):
        logger.info(f">>> [RealLLM] Sending request to {self.model}...")
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=kwargs.get("temperature", 0.1),
                response_format=kwargs.get("response_format"),
            )
            content = response.choices[0].message.content
            logger.info(f">>> [RealLLM] Response received ({len(content)} chars)")
            return content
        except Exception as e:
            logger.error(f"❌ [RealLLM] Call failed: {e}")
            raise


async def main():
    logger.info("=" * 60)
    logger.info("🚀 Starting FULL Skill Registry Flow (Monkey Patching Mode)")
    logger.info("=" * 60)

    # 目标：Composio 的 docx 技能
    REPO_URL = "https://github.com/ComposioHQ/awesome-claude-skills.git"
    SUBDIR = "document-skills/docx"
    SKILL_ID = "real_composio_docx"

    # 初始化适配器
    try:
        real_llm = RealTestLLMService()
    except Exception as e:
        logger.error(f"Setup failed: {e}")
        return

    # ---------------------------------------------------------
    # 2. 关键：针对性 Patch 模块中的 llm_service 对象
    # ---------------------------------------------------------
    # 注意：我们 patch 的是 `app.services.skill_registry.manifest_generator` 这个模块里 IMPORT 进来的 `llm_service` 变量
    # 而不是 `app.services.providers.llm.LLMService` 类

    with patch("app.services.skill_registry.manifest_generator.llm_service", real_llm):

        async with AsyncSessionLocal() as session:
            skill_repo = SkillRegistryRepository(session)

            # --- Phase 1: Ingestion ---
            logger.info(">>> [Phase 1] Ingesting Repo...")

            # 重新实例化 Generator，确保它使用被 patch 过的环境
            generator = SkillManifestGenerator()

            ingestion_service = RepoIngestionService(
                parsers=[PythonRepoParser()],
                repo=skill_repo,
                manifest_generator=generator,
            )

            try:
                result = await ingestion_service.ingest_repo(
                    repo_url=REPO_URL,
                    revision="master",
                    skill_id=SKILL_ID,
                    source_subdir=SUBDIR,
                )
                logger.info(f">>> Ingestion Success: {result}")

                skill = await skill_repo.get_by_id(SKILL_ID)
                desc = skill.manifest_json.get("description", "No description")
                logger.info(f">>> Generated Description: {desc[:100]}...")

            except Exception as e:
                logger.error(f">>> Ingestion Failed: {e}", exc_info=True)
                return

            # --- Phase 2: Dry Run ---
            logger.info(">>> [Phase 2] Running Dry Run...")
            metrics_service = SkillMetricsService(repo=skill_repo)
            executor = SkillRuntimeExecutor(repo=skill_repo)

            dry_run_service = SkillDryRunService(
                repo=skill_repo,
                executor=executor,
                metrics_service=metrics_service,
            )

            try:
                dry_run_result = await dry_run_service.run(
                    SKILL_ID, allow_self_heal=False
                )
                logger.info(f">>> Dry Run Result: {dry_run_result}")
                logger.info(f">>> Dry Run STDOUT: {dry_run_result.get('stdout')}")
                logger.info(f">>> Dry Run STDERR: {dry_run_result.get('stderr')}")

                skill = await skill_repo.get_by_id(SKILL_ID)
                if skill.status == "active":
                    logger.info("✅ TEST PASSED: Skill is ACTIVE.")
                else:
                    logger.warning(f"⚠️  Skill status: {skill.status}")
                    metrics = skill.manifest_json.get("metrics", {})
                    logger.error(
                        f">>> Failure Reason from DB: {metrics.get('last_error')}"
                    )

            except Exception as e:
                logger.error(f">>> Dry Run Failed: {e}", exc_info=True)


if __name__ == "__main__":
    asyncio.run(main())
