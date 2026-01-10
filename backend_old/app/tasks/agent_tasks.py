"""
Agent Tasks - Celery tasks for crawling and document upload.

These tasks use AgentTaskRunner for standardized status management
and the knowledge pipeline for document processing and ingestion.
"""

from __future__ import annotations

import asyncio
import os
import httpx
from typing import Any
from uuid import UUID

from celery import shared_task
from sqlalchemy import select

from app.auth import AuthenticatedAPIKey
from app.db.session import SessionLocal
from app.http_client import CurlCffiClient
from app.logging_config import logger
from app.models.agent_task import AgentTask, AgentTaskStatus, IngestRecord
from app.models import APIKey, User
from app.qdrant_client import close_qdrant_client_for_current_loop, get_qdrant_client
from app.redis_client import close_redis_client_for_current_loop, get_redis_client
from sqlalchemy import select
from app.services.crawler.runner import CrawlConfig, CrawlRunner, SSRFError
from app.services.knowledge_pipeline import chunk_document, ingest_chunks
from app.services.system_config_service import get_kb_global_embedding_logical_model
from app.services.project_eval_config_service import (
    DEFAULT_PROVIDER_SCOPES,
    get_effective_provider_ids_for_user,
    get_or_default_project_eval_config,
)
from app.settings import settings
from app.workers.base import AgentTaskRunner
from app.services.provider.metadata_validator import validate_metadata, MetadataValidationError
from app.services.provider_preset_service import get_provider_preset
from app.models import ProviderPreset


class CrawlTaskRunner(AgentTaskRunner):
    """
    Runner for web crawling tasks.

    Executes crawl using CrawlRunner, then processes content through knowledge pipeline.
    """

    async def execute(self) -> dict:
        """
        Execute crawl task.

        Returns:
            Result summary with crawl stats
        """
        task = self.task
        url = task.target_url

        if not url:
            raise ValueError("target_url is required for crawl tasks")

        self.begin_step("init", f"准备爬取 {url}", progress=5)

        # Prepare crawl config from task.config
        config_dict = task.config or {}
        crawl_config = CrawlConfig(
            wait_for=config_dict.get("wait_for", "networkidle"),
            timeout=config_dict.get("timeout", 30000),
            extract_markdown=config_dict.get("extract_markdown", True),
            extract_tables=config_dict.get("extract_tables", True),
            extract_code=config_dict.get("extract_code", True),
            user_agent=config_dict.get("user_agent"),
        )

        self.end_step("succeeded", "初始化完成", progress=10)
        self.begin_step("crawl", "执行爬取", progress=10)
        # Execute crawl
        try:
            crawl_result = await CrawlRunner.run(url, crawl_config)
        except SSRFError as e:
            self.end_step("failed", f"SSRF validation failed: {e}", progress=100)
            raise ValueError(f"SSRF validation failed: {e}") from e

        if crawl_result.get("error"):
            self.end_step("failed", f"Crawl failed: {crawl_result['error']}", progress=100)
            raise RuntimeError(f"Crawl failed: {crawl_result['error']}")

        crawled_text = crawl_result.get("text", "")
        if not crawled_text or not crawled_text.strip():
            self.update_step(message="Crawled content is empty", progress=30)
            self.end_step("succeeded", "爬取完成但内容为空", progress=30)
            return {
                "url": url,
                "status": crawl_result.get("status", 0),
                "chunks": 0,
                "ingested": 0,
            }

        self.update_step(message=f"Crawled {len(crawled_text)} characters", progress=40)
        self.end_step("succeeded", "爬取完成", progress=40)

        # Chunk the document
        self.begin_step("chunk", "切分文档", progress=40)
        chunks = chunk_document(crawled_text, max_tokens=512)
        self.update_step(message=f"Created {len(chunks)} chunks", progress=55)
        self.end_step("succeeded", "切分完成", progress=55)

        # Get user and API key for embedding
        self.begin_step("prepare_embedding", "准备嵌入配置", progress=55)
        user = self.db.get(User, UUID(str(task.created_by_id)))
        if not user or not user.is_active:
            self.end_step("failed", "用户无效", progress=100)
            raise ValueError("Task creator user not found or inactive")

        # Get API key for embedding (use first active key or system default)
        api_key_query = select(APIKey).where(
            APIKey.user_id == user.id,
            APIKey.is_active == True,  # noqa: E712
        ).limit(1)
        api_key = self.db.execute(api_key_query).scalar_one_or_none()

        if not api_key:
            self.end_step("failed", "未找到有效 API Key", progress=100)
            raise ValueError(f"No active API key found for user {user.id}")

        # 知识库入库已禁用，直接返回爬取结果概览
        self.end_step("succeeded", "跳过入库（已禁用）", progress=100)
        return {
            "url": url,
            "status": crawl_result.get("status", 0),
            "chunks": len(chunks),
            "ingested": 0,
            "skipped_duplicate": 0,
            "failed": 0,
        }


class UploadTaskRunner(AgentTaskRunner):
    """
    Runner for file upload tasks.

    Parses uploaded files (PDF/HTML/TXT) and processes through knowledge pipeline.
    """

    async def execute(self) -> dict:
        """
        Execute upload task.

        Returns:
            Result summary with upload stats
        """
        task = self.task
        file_path = task.target_file_path

        if not file_path:
            raise ValueError("target_file_path is required for upload tasks")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        self.begin_step("init", f"准备处理文件 {file_path}", progress=5)

        # Parse file based on extension
        _, ext = os.path.splitext(file_path)
        ext_lower = ext.lower()

        try:
            if ext_lower == ".txt":
                with open(file_path, encoding="utf-8") as f:
                    content = f.read()
            elif ext_lower == ".html":
                with open(file_path, encoding="utf-8") as f:
                    html_content = f.read()
                # Simple HTML to text conversion
                from app.services.crawler.extractor import extract_main_content
                content = extract_main_content(html_content)
            elif ext_lower == ".pdf":
                # PDF parsing requires PyPDF2 or similar
                try:
                    import PyPDF2
                except ImportError as e:
                    raise RuntimeError("PyPDF2 not installed, cannot parse PDF files") from e

                with open(file_path, "rb") as f:
                    pdf_reader = PyPDF2.PdfReader(f)
                    content = ""
                    for page in pdf_reader.pages:
                        content += page.extract_text() + "\n"
            else:
                raise ValueError(f"Unsupported file type: {ext}")
        except Exception as e:
            self.end_step("failed", f"解析文件失败: {e}", progress=100)
            raise RuntimeError(f"Failed to parse file: {e}") from e

        if not content or not content.strip():
            self.update_step(message="解析后内容为空", progress=30)
            self.end_step("succeeded", "空内容，无需处理", progress=100)
            return {
                "file": file_path,
                "chunks": 0,
                "ingested": 0,
            }

        self.update_step(message=f"解析 {len(content)} 字符", progress=30)
        self.end_step("succeeded", "解析完成", progress=35)

        # Chunk the document
        self.begin_step("chunk", "切分文档", progress=35)
        chunks = chunk_document(content, max_tokens=512)
        self.update_step(message=f"生成 {len(chunks)} 个分片", progress=50)
        self.end_step("succeeded", "切分完成", progress=50)

        # Get user and API key for embedding
        self.begin_step("prepare_embedding", "准备嵌入配置", progress=50)
        user = self.db.get(User, UUID(str(task.created_by_id)))
        if not user or not user.is_active:
            self.end_step("failed", "用户无效", progress=100)
            raise ValueError("Task creator user not found or inactive")

        # Get API key for embedding
        api_key_query = select(APIKey).where(
            APIKey.user_id == user.id,
            APIKey.is_active == True,  # noqa: E712
        ).limit(1)
        api_key = self.db.execute(api_key_query).scalar_one_or_none()

        if not api_key:
            self.end_step("failed", "未找到有效 API Key", progress=100)
            raise ValueError(f"No active API key found for user {user.id}")

        # Get embedding model
        embedding_model = (get_kb_global_embedding_logical_model(self.db) or "").strip()
        if not embedding_model:
            embedding_model = (getattr(api_key, "kb_embedding_logical_model", None) or "").strip()
        if not embedding_model:
            self.end_step("failed", "No embedding model configured", progress=100)
            raise ValueError("No embedding model configured")

        # Get effective provider IDs
        cfg = get_or_default_project_eval_config(self.db, project_id=UUID(str(api_key.id)))
        effective_provider_ids = get_effective_provider_ids_for_user(
            self.db,
            user_id=UUID(str(user.id)),
            api_key=api_key,
            provider_scopes=list(getattr(cfg, "provider_scopes", None) or DEFAULT_PROVIDER_SCOPES),
        )

        # Create authenticated API key
        auth_key = AuthenticatedAPIKey(
            id=UUID(str(api_key.id)),
            user_id=UUID(str(api_key.user_id)),
            user_username=str(user.username or ""),
            is_superuser=bool(user.is_superuser),
            name=str(api_key.name or ""),
            is_active=bool(api_key.is_active),
            disabled_reason=getattr(api_key, "disabled_reason", None),
            has_provider_restrictions=bool(api_key.has_provider_restrictions),
            allowed_provider_ids=list(api_key.allowed_provider_ids),
        )

        # Get clients
        redis = get_redis_client()
        qdrant = get_qdrant_client()

        self.end_step("succeeded", "准备完成", progress=60)
        self.begin_step("ingest", "向知识库入库", progress=60)

        try:
            async with CurlCffiClient(timeout=60.0, impersonate="chrome120", trust_env=True) as client:
                # Ingest chunks
                collection_name = (
                    str(getattr(settings, "qdrant_kb_system_collection", "kb_system") or "kb_system").strip()
                    or "kb_system"
                )

                ingest_result = await ingest_chunks(
                    db=self.db,
                    redis=redis,
                    client=client,
                    qdrant=qdrant,
                    api_key=auth_key,
                    effective_provider_ids=effective_provider_ids,
                    embedding_logical_model=embedding_model,
                    chunks=chunks,
                    collection_name=collection_name,
                    task_id=str(task.id),
                    source_type="upload",
                    tags=task.tags or [],
                    metadata={
                        "file_name": os.path.basename(file_path),
                        "file_type": ext_lower,
                    },
                )

                self.add_log("info", f"Ingested {ingest_result['ingested']} chunks", ingest_stats=ingest_result)
                self.update_step(
                    message=f"ingested={ingest_result['ingested']} failed={ingest_result['failed']}",
                    progress=90,
                )

                # Record ingested chunks
                ingest_record = IngestRecord(
                    agent_task_id=str(task.id),
                    qdrant_collection=collection_name,
                    qdrant_point_id=f"task_{task.id}",
                    doc_source_url=file_path,
                )
                self.db.add(ingest_record)
                self.db.commit()

                result = {
                    "file": file_path,
                    "chunks": len(chunks),
                    "ingested": ingest_result["ingested"],
                    "skipped_duplicate": ingest_result["skipped_duplicate"],
                    "failed": ingest_result["failed"],
                }
                self.end_step("succeeded", "任务完成", progress=100)
                return result
        finally:
            await close_redis_client_for_current_loop()
            await close_qdrant_client_for_current_loop()


class RuleGenTaskRunner(AgentTaskRunner):
    """
    Runner for RULE_GEN tasks（仅针对 provider_preset，写入能力映射）。
    """

    async def execute(self) -> dict:
        task = self.task
        provider_slug = task.provider_slug
        cfg = task.config or {}
        issues = cfg.get("validation_issues", [])
        if not provider_slug:
            raise ValueError("provider_slug is required for RULE_GEN")

        self.begin_step("load", f"加载预设 {provider_slug}", progress=5)
        preset: ProviderPreset | None = get_provider_preset(self.db, preset_id=provider_slug)
        if preset is None:
            self.end_step("failed", "预设不存在", progress=100)
            raise ValueError(f"Provider preset '{provider_slug}' not found")
        self.end_step("succeeded", "加载完成", progress=10)

        # 准备能力映射（由任务配置提供），形如 {"chat": {"v1": {...}}, ...}
        self.begin_step("prepare_capabilities", "准备能力映射", progress=10)
        capabilities = cfg.get("capabilities") or {}
        meta_body = {"capabilities": capabilities}
        try:
            validated = validate_metadata(meta_body)
        except MetadataValidationError as e:
            self.end_step("failed", f"能力映射校验失败: {e}", progress=100)
            raise
        self.end_step("succeeded", "能力映射校验通过", progress=40)

        from app.plugins.builtins.preset_capability_plugin import update_preset_capabilities_db

        self.begin_step("persist_preset", "写回官方预设能力映射", progress=60)
        result = update_preset_capabilities_db(self.db, provider_slug, capabilities)
        self.end_step("succeeded", "预设更新完成", progress=100)

        return {
            "preset_id": result["preset_id"],
            "capabilities": result["capabilities"],
            "schema_version": result.get("schema_version"),
            "issues": issues,
        }


class PresetDiscoverTaskRunner(AgentTaskRunner):
    """
    Runner for PRESET_DISCOVER（能力映射版）。
    行为：读取 config.capabilities，校验后写回预设 metadata_json。
    """

    async def execute(self) -> dict:
        task = self.task
        cfg = task.config or {}
        preset_id = cfg.get("preset_id") or cfg.get("presetId") or cfg.get("id")
        capabilities = cfg.get("capabilities") or {}
        issues = cfg.get("validation_issues", [])
        if not preset_id:
            raise ValueError("preset_id is required for PRESET_DISCOVER")

        self.begin_step("load_preset", f"加载预设 {preset_id}", progress=5)
        preset = get_provider_preset(self.db, preset_id=preset_id)
        if preset is None:
            self.end_step("failed", "预设不存在", progress=100)
            raise ValueError(f"Provider preset '{preset_id}' not found")
        self.end_step("succeeded", "预设加载完成", progress=10)

        self.begin_step("validate_capabilities", "校验能力映射", progress=20)
        try:
            validated = validate_metadata({"capabilities": capabilities})
        except MetadataValidationError as e:
            self.end_step("failed", f"能力映射校验失败: {e}", progress=100)
            raise
        self.end_step("succeeded", "能力映射校验通过", progress=60)

        from app.plugins.builtins.preset_capability_plugin import update_preset_capabilities_db

        self.begin_step("persist_preset", "写回预设能力映射", progress=70)
        result = update_preset_capabilities_db(self.db, preset_id, capabilities)
        self.end_step("succeeded", "预设更新完成", progress=100)

        summary = {
            "preset_id": result["preset_id"],
            "capabilities": result["capabilities"],
            "schema_version": result.get("schema_version"),
            "issues": issues,
        }
        self.end_step("succeeded", "任务完成", progress=100)
        return summary

@shared_task(name="tasks.agent_crawl_task")
def agent_crawl_task(task_id: str) -> str:
    """
    Celery task for web crawling.

    Args:
        task_id: AgentTask ID

    Returns:
        Status string (completed/failed)
    """
    try:
        runner = CrawlTaskRunner(task_id)
        result = asyncio.run(runner.run())
        if result:
            logger.info(f"Crawl task {task_id} completed successfully", extra={"biz": "agent_task"})
            return "completed"
        logger.error(f"Crawl task {task_id} failed", extra={"biz": "agent_task"})
        return "failed"
    except Exception as exc:
        logger.exception(f"Crawl task {task_id} raised exception: {exc}", extra={"biz": "agent_task"})
        return "failed"


@shared_task(name="tasks.agent_upload_task")
def agent_upload_task(task_id: str) -> str:
    """
    Celery task for file upload processing.

    Args:
        task_id: AgentTask ID

    Returns:
        Status string (completed/failed)
    """
    try:
        runner = UploadTaskRunner(task_id)
        result = asyncio.run(runner.run())
        if result:
            logger.info(f"Upload task {task_id} completed successfully", extra={"biz": "agent_task"})
            return "completed"
        logger.error(f"Upload task {task_id} failed", extra={"biz": "agent_task"})
        return "failed"
    except Exception as exc:
        logger.exception(f"Upload task {task_id} raised exception: {exc}", extra={"biz": "agent_task"})
        return "failed"


@shared_task(name="tasks.agent_rule_gen_task")
def agent_rule_gen_task(task_id: str) -> str:
    """
    Celery task for RULE_GEN.
    """
    try:
        runner = RuleGenTaskRunner(task_id)
        result = asyncio.run(runner.run())
        if result:
            logger.info(f"Rule gen task {task_id} completed successfully", extra={"biz": "agent_task"})
            return "completed"
        logger.error(f"Rule gen task {task_id} failed", extra={"biz": "agent_task"})
        return "failed"
    except Exception as exc:
        logger.exception(f"Rule gen task {task_id} raised exception: {exc}", extra={"biz": "agent_task"})
        return "failed"


@shared_task(name="tasks.agent_preset_discover_task")
def agent_preset_discover_task(task_id: str) -> str:
    """
    Celery task for PRESET_DISCOVER.
    """
    try:
        runner = PresetDiscoverTaskRunner(task_id)
        result = asyncio.run(runner.run())
        if result:
            logger.info(f"Preset discover task {task_id} completed successfully", extra={"biz": "agent_task"})
            return "completed"
        logger.error(f"Preset discover task {task_id} failed", extra={"biz": "agent_task"})
        return "failed"
    except Exception as exc:
        logger.exception(f"Preset discover task {task_id} raised exception: {exc}", extra={"biz": "agent_task"})
        return "failed"
    except Exception as exc:
        logger.exception(f"Upload task {task_id} raised exception: {exc}", extra={"biz": "agent_task"})
        return "failed"


__all__ = [
    "CrawlTaskRunner",
    "UploadTaskRunner",
    "RuleGenTaskRunner",
    "PresetDiscoverTaskRunner",
    "agent_crawl_task",
    "agent_upload_task",
    "agent_rule_gen_task",
    "agent_preset_discover_task",
]
