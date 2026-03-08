import inspect
import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

from app.agent_plugins.core.manager import PluginManager
from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.repositories.skill_registry_repository import SkillRegistryRepository
from app.schemas.tool import ToolDefinition
from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor
from app.tasks.async_runner import run_async
from app.services.notifications.task_notification import push_task_progress

logger = logging.getLogger(__name__)

_MAX_AGENT_STEPS = 5
_CONTENT_LIMIT = 20000


async def _run_ingestion_workflow(
    target_url: str,
    instruction: str,
    *,
    user_id: str | None = None,
    model_hint: str | None = None,
    # plugin_classes is now ignored, we use SkillRegistry
    plugin_classes: list[type] | None = None,
    tool_plugin_ids: list[str] | None = None,
) -> str:
    job_id = str(uuid.uuid4())[:8]
    logger.info("[Worker-%s] Started ingestion for: %s", job_id, target_url)

    await push_task_progress(
        user_id, job_id, "initialization", "正在初始化自动化接入引擎...", percentage=10
    )

    try:
        parsed_user_id = uuid.UUID(str(user_id)) if user_id else None
    except (ValueError, TypeError):
        parsed_user_id = None

    if not parsed_user_id or parsed_user_id.int == 0:
        await push_task_progress(
            user_id,
            job_id,
            "error",
            "任务失败：缺少真实用户 ID，无法绑定插件上下文",
            status="failed",
        )
        return "Job failed: real user_id is required."

    async with AsyncSessionLocal() as session:
        skill_repo = SkillRegistryRepository(session)
        executor = SkillRuntimeExecutor(skill_repo)

        # 1. Execute Crawler Skill
        logger.info("[Worker-%s] Crawling...", job_id)
        await push_task_progress(
            user_id, job_id, "crawling", f"正在从 {target_url} 抓取内容...", percentage=30
        )
        
        # Resolve crawler skill (using the new official ID or legacy fallback)
        crawler_skill = await skill_repo.get_by_id("official.skills.crawler")
        if not crawler_skill:
            crawler_skill = await skill_repo.get_by_id("core.tools.crawler")
            
        if not crawler_skill:
            return "Job failed: Crawler skill not found in registry."

        crawl_exec = await executor.execute(
            skill_id=crawler_skill.id,
            session_id=f"ingestion_{job_id}",
            user_id=str(parsed_user_id),
            inputs={"url": target_url, "__tool_name__": "fetch_web_content"},
            intent="fetch_web_content"
        )

        if crawl_exec.get("status") != "ok":
            error_msg = crawl_exec.get("error") or "Unknown crawl error"
            await push_task_progress(
                user_id, job_id, "error", f"爬取失败：{error_msg}", status="failed"
            )
            return f"Job failed: Crawl error - {error_msg}"

        crawl_result = crawl_exec.get("result", {})
        if isinstance(crawl_result, str):
            # Handle cases where result might be a raw string
            content = crawl_result[:_CONTENT_LIMIT]
        else:
            content = crawl_result.get("markdown", "")[:_CONTENT_LIMIT]

        await push_task_progress(
            user_id, job_id, "analyzing", "抓取成功，正在使用 AI 分析文档结构...", percentage=60
        )

        # 2. Prepare Tools for LLM
        available_tools: list[ToolDefinition] = []
        tool_id_map: dict[str, str] = {} # tool_name -> skill_id

        target_skill_ids = tool_plugin_ids or ["official.skills.database"]
        for s_id in target_skill_ids:
            skill = await skill_repo.get_by_id(s_id)
            if not skill: continue
            
            manifest = skill.manifest_json or {}
            tools = manifest.get("tools", [])
            for t_def in tools:
                t_name = t_def.get("name")
                if t_name:
                    available_tools.append(ToolDefinition(
                        name=t_name,
                        description=t_def.get("description", ""),
                        input_schema=t_def.get("parameters") or t_def.get("input_schema") or {},
                    ))
                    tool_id_map[t_name] = skill.id

        system_prompt = f"""
You are an autonomous Data Ingestion Worker.
Your Task: {instruction}

Context (Crawled Content):
---
{content}
---

Action:
Extract the relevant information from the context and use the available tools to save or update records.
"""

        messages = [{"role": "system", "content": system_prompt}]
        logger.info("[Worker-%s] Thinking...", job_id)

        actions_taken: list[str] = []
        selected_model = model_hint
        from app.services.providers.llm import llm_service

        for i in range(_MAX_AGENT_STEPS):
            try:
                response = await llm_service.chat_completion(
                    messages=messages,
                    tools=available_tools,
                    temperature=0.0,
                    model=selected_model,
                    user_id=user_id,
                    tenant_id=user_id,
                )

                if isinstance(response, str):
                    logger.info("[Worker-%s] Finished: %s", job_id, response)
                    await push_task_progress(
                        user_id, job_id, "completed", "接入任务圆满完成！", status="completed", percentage=100
                    )
                    return f"Job {job_id} Completed: {response}"

                if isinstance(response, list):
                    messages.append({
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                            } for tc in response
                        ],
                    })

                    for tc in response:
                        target_skill_id = tool_id_map.get(tc.name)
                        if target_skill_id:
                            logger.info("[Worker-%s] Executing %s via Skill %s...", job_id, tc.name, target_skill_id)
                            await push_task_progress(
                                user_id, job_id, "executing", f"正在执行动作：{tc.name}...", percentage=70 + (i * 5)
                            )
                            
                            inputs = dict(tc.arguments or {})
                            inputs["__tool_name__"] = tc.name
                            
                            res_exec = await executor.execute(
                                skill_id=target_skill_id,
                                session_id=f"ingestion_{job_id}",
                                user_id=str(parsed_user_id),
                                inputs=inputs,
                                intent=tc.name
                            )
                            
                            if res_exec.get("status") == "ok":
                                res_val = res_exec.get("result")
                                actions_taken.append(f"Called {tc.name} successfully")
                                res_str = json.dumps(res_val, default=str)
                            else:
                                res_str = f"Error: {res_exec.get('error')}"
                        else:
                            res_str = "Error: Tool not found"

                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": res_str})
            except Exception as exc:
                logger.error("[Worker-%s] LLM Error: %s", job_id, exc)
                await push_task_progress(
                    user_id, job_id, "error", f"AI 执行出错：{exc!s}", status="failed"
                )
                return f"Job failed: {exc}"

        await push_task_progress(
            user_id, job_id, "completed", "任务执行结束。", status="completed", percentage=100
        )
        return f"Job finished. Actions: {'; '.join(actions_taken)}"


@celery_app.task(queue="agent_tasks", name="app.tasks.agent.run_auto_ingestion_job")
def run_auto_ingestion_job(target_url: str, instruction: str, user_id: str | None = None):
    return run_async(
        _run_ingestion_workflow(
            target_url,
            instruction,
            user_id=user_id,
            tool_plugin_ids=["official.skills.database"],
        )
    )


@celery_app.task(queue="agent_tasks", name="app.tasks.agent.run_discovery_task")
def run_discovery_task(
    target_url: str,
    capability: str = "chat",
    model_hint: str | None = None,
    provider_name_hint: str | None = None,
    user_id: str | None = None,
):
    def _build_discovery_instruction(cap: str, hint: str | None) -> str:
        lines = [
            "You are a provider discovery agent.",
            f"Target capability: {cap}.",
            "Use get_unified_schema(capability) to understand the gateway's canonical schema and protocol profile contract.",
            "Extract provider details (name, slug, base_url, auth_type, auth_config_key, category, default headers/default params).",
            "Generate capability mapping as a capability-specific protocol profile: protocol_family + transport + request template/builder + response template/output mapping, then validate it with verify_provider_template.",
            "Persist mappings via save_provider_field_mapping after ensuring provider preset exists.",
        ]
        if hint: lines.append(f"Provider name hint: {hint}.")
        return "\n".join(lines)

    instruction = _build_discovery_instruction(capability, provider_name_hint)
    return run_async(
        _run_ingestion_workflow(
            target_url,
            instruction,
            user_id=user_id,
            model_hint=model_hint,
            tool_plugin_names=[
                "core.registry.provider",
                "system/database_manager",
            ],
        )
    )
