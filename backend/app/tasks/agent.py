import asyncio
import inspect
import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.agent_plugins.builtins.database.plugin import DatabasePlugin
from app.agent_plugins.builtins.provider_registry.plugin import ProviderRegistryPlugin
from app.agent_plugins.core.manager import PluginManager
from app.core.celery_app import celery_app
from app.schemas.tool import ToolDefinition
from app.services.notifications.task_notification import push_task_progress

logger = logging.getLogger(__name__)

_MAX_AGENT_STEPS = 5
_CONTENT_LIMIT = 20000


def _build_tools_and_handlers(
    plugins: list[Any],
) -> tuple[list[ToolDefinition], dict[str, Callable]]:
    tools: list[ToolDefinition] = []
    tool_map: dict[str, Callable] = {}

    for plugin in plugins:
        if not plugin:
            continue
        raw_tools = plugin.get_tools() or []
        for tool in raw_tools:
            function_info = tool.get("function", {}) if isinstance(tool, dict) else {}
            name = function_info.get("name")
            if not name:
                continue
            tools.append(
                ToolDefinition(
                    name=name,
                    description=function_info.get("description"),
                    input_schema=function_info.get("parameters", {}),
                )
            )
            handler: Callable | None = None
            if hasattr(plugin, name):
                handler = getattr(plugin, name)
            else:
                method_name = f"handle_{name}"
                if hasattr(plugin, method_name):
                    handler = getattr(plugin, method_name)

            if handler:
                if name in tool_map:
                    logger.warning("Duplicate tool name detected: %s", name)
                tool_map[name] = handler

    return tools, tool_map


async def _invoke_tool(handler: Callable, args: dict[str, Any]) -> Any:
    try:
        signature = inspect.signature(handler)
    except (TypeError, ValueError):
        return await _call_handler(handler, args)

    parameters = list(signature.parameters.values())
    if len(parameters) == 1:
        param = parameters[0]
        if param.name in {"args", "payload", "data"}:
            return await _call_handler(handler, args)

    return await _call_handler(handler, args, use_kwargs=True)


async def _call_handler(
    handler: Callable, args: dict[str, Any], *, use_kwargs: bool = False
) -> Any:
    if inspect.iscoroutinefunction(handler):
        return await (handler(**args) if use_kwargs else handler(args))
    return handler(**args) if use_kwargs else handler(args)


async def _chat_completion_with_fallback(
    messages: list[dict],
    tools: list[ToolDefinition],
    model_hint: str | None,
) -> tuple[Any, str | None]:
    from app.services.providers.llm import llm_service

    try:
        response = await llm_service.chat_completion(
            messages=messages, tools=tools, temperature=0.0, model=model_hint
        )
        return response, model_hint
    except Exception as exc:
        if not model_hint:
            raise
        logger.warning(
            "LLMService failed with model_hint=%s, falling back to default: %s",
            model_hint,
            exc,
        )
        response = await llm_service.chat_completion(
            messages=messages,
            tools=tools,
            temperature=0.0,
        )
        return response, None


def _build_discovery_instruction(
    capability: str,
    provider_name_hint: str | None,
) -> str:
    lines = [
        "You are a provider discovery agent.",
        f"Target capability: {capability}.",
        "Use get_unified_schema(capability) to understand the gateway's internal request/response schema.",
        "Extract provider details (name, slug, base_url, auth_type, auth_config_key, category, default_params).",
        "Generate capability mapping: request_template + response_transform (and stream_transform when streaming is supported).",
        "Before saving, call verify_provider_template with representative test_payload; only save when verification succeeds.",
        "Persist mappings via save_provider_field_mapping after ensuring provider preset exists.",
        "Do not store secrets; only reference secret key names in auth_config_key.",
        "If required information is missing, explain what is missing and avoid creating incomplete presets.",
    ]
    if provider_name_hint:
        lines.append(f"Provider name hint: {provider_name_hint}.")
    return "\n".join(lines)


async def _run_ingestion_workflow(
    target_url: str,
    instruction: str,
    *,
    user_id: str | None = None,
    model_hint: str | None = None,
    plugin_classes: list[type] | None = None,
    tool_plugin_names: list[str] | None = None,
) -> str:
    job_id = str(uuid.uuid4())[:8]
    logger.info("[Worker-%s] Started ingestion for: %s", job_id, target_url)

    await push_task_progress(
        user_id, job_id, "initialization", "正在初始化自动化接入引擎...", percentage=10
    )

    manager = PluginManager()
    for plugin_cls in plugin_classes or []:
        manager.register_class(plugin_cls)

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

    await manager.activate_all(user_id=parsed_user_id)
    try:
        crawler = manager.get_plugin("core.tools.crawler")
        if not crawler:
            await push_task_progress(
                user_id, job_id, "error", "任务失败：爬虫插件不可用", status="failed"
            )
            return "Job failed: Crawler plugin not available."

        logger.info("[Worker-%s] Crawling...", job_id)
        await push_task_progress(
            user_id, job_id, "crawling", f"正在从 {target_url} 抓取内容...", percentage=30
        )
        crawl_result = await crawler.handle_fetch_web_content(url=target_url)

        if crawl_result.get("error"):
            await push_task_progress(
                user_id, job_id, "error", f"爬取失败：{crawl_result['error']}", status="failed"
            )
            return f"Job failed: Crawl error - {crawl_result['error']}"

        await push_task_progress(
            user_id, job_id, "analyzing", "抓取成功，正在使用 AI 分析文档结构...", percentage=60
        )
        content = crawl_result.get("markdown", "")[:_CONTENT_LIMIT]

        tool_plugins = []
        for name in tool_plugin_names or []:
            plugin = manager.get_plugin(name)
            if plugin:
                tool_plugins.append(plugin)
            else:
                logger.warning("Tool plugin not available: %s", name)

        tools, tool_map = _build_tools_and_handlers(tool_plugins)

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
        for i in range(_MAX_AGENT_STEPS):
            try:
                response, selected_model = await _chat_completion_with_fallback(
                    messages=messages,
                    tools=tools,
                    model_hint=selected_model,
                )

                if isinstance(response, str):
                    logger.info("[Worker-%s] Finished: %s", job_id, response)
                    await push_task_progress(
                        user_id, job_id, "completed", "接入任务圆满完成！", status="completed", percentage=100
                    )
                    return f"Job {job_id} Completed: {response}"

                if isinstance(response, list):
                    messages.append(
                        {
                            "role": "assistant",
                            "tool_calls": [
                                {
                                    "id": tc.id,
                                    "type": "function",
                                    "function": {
                                        "name": tc.name,
                                        "arguments": json.dumps(tc.arguments),
                                    },
                                }
                                for tc in response
                            ],
                        }
                    )

                    for tc in response:
                        handler = tool_map.get(tc.name)
                        if handler:
                            logger.info("[Worker-%s] Executing %s...", job_id, tc.name)
                            await push_task_progress(
                                user_id, job_id, "executing", f"正在执行动作：{tc.name}...", percentage=70 + (i * 5)
                            )
                            res = await _invoke_tool(handler, tc.arguments)
                            actions_taken.append(f"Called {tc.name}: {res}")
                            res_str = str(res)
                        else:
                            res_str = "Error: Tool not found"

                        messages.append(
                            {"role": "tool", "tool_call_id": tc.id, "content": res_str}
                        )
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
    finally:
        await manager.deactivate_all()


@celery_app.task(queue="agent_tasks", name="app.tasks.agent.run_auto_ingestion_job")
def run_auto_ingestion_job(target_url: str, instruction: str, user_id: str | None = None):
    """
    Background Worker:
    1. Crawls a URL.
    2. Uses LLM to extract data based on 'instruction'.
    3. Writes data to DB using DatabasePlugin.
    """
    return asyncio.run(
        _run_ingestion_workflow(
            target_url,
            instruction,
            user_id=user_id,
            plugin_classes=[CrawlerPlugin, DatabasePlugin],
            tool_plugin_names=["system/database_manager"],
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
    instruction = _build_discovery_instruction(
        capability=capability, provider_name_hint=provider_name_hint
    )
    return asyncio.run(
        _run_ingestion_workflow(
            target_url,
            instruction,
            user_id=user_id,
            model_hint=model_hint,
            plugin_classes=[CrawlerPlugin, ProviderRegistryPlugin, DatabasePlugin],
            tool_plugin_names=["core.registry.provider", "system/database_manager"],
        )
    )
