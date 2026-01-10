import asyncio
import json
import logging
import uuid
from celery import shared_task
from app.core.celery_app import celery_app
from app.services.providers.llm import llm_service
from app.agent_plugins.builtins.database.plugin import DatabasePlugin
from app.agent_plugins.builtins.provider_registry.plugin import ProviderRegistryPlugin
from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.schemas.tool import ToolDefinition, ToolCall

logger = logging.getLogger(__name__)

@celery_app.task(queue="agent_tasks", name="app.tasks.agent.run_discovery_task")
def run_discovery_task(target_url: str, capability: str, model_hint: str):
    """
    Celery task to run the Pro-Level Discovery Agent.
    """
    # Celery 运行在同步环境，需要用 loop 跑异步方法
    return asyncio.run(_run_discovery_agent_logic(target_url, capability, model_hint))

async def _run_discovery_agent_logic(target_url: str, capability: str, model_hint: str):
    logger.info(f"Starting Discovery Agent for: {target_url} (Capability: {capability})")
    
    # 1. Initialize Plugins (Real Crawler this time)
    db_plugin = DatabasePlugin()
    registry_plugin = ProviderRegistryPlugin()
    crawler_plugin = CrawlerPlugin()
    
    # Initialize crawler (Playwright) - needs context
    # Note: In a real plugin manager this is handled automatically. 
    # Here we manual trigger if needed, but CrawlerPlugin uses 'on_activate'.
    # For now, we assume CrawlerPlugin.handle_fetch_web_content is ready.

    tools = []
    tool_map = {}

    def register(plugin, method_name, tool_def):
        tool_name = tool_def["function"]["name"]
        tools.append(ToolDefinition(
            name=tool_name, description=tool_def["function"]["description"],
            input_schema=tool_def["function"]["parameters"]
        ))
        tool_map[tool_name] = getattr(plugin, method_name if hasattr(plugin, method_name) else tool_name)

    # Register all tools
    register(crawler_plugin, "handle_fetch_web_content", crawler_plugin.get_tools()[0])
    for t in db_plugin.get_tools(): register(db_plugin, t["function"]["name"], t)
    for t in registry_plugin.get_tools(): register(registry_plugin, t["function"]["name"], t)

    messages = [
        {"role": "system", "content": f"""
You are a "Professional API Architect Agent". Your goal is to integrate multi-modal AI capabilities into the gateway.

Workflow:
1. Call `get_unified_schema` for '{capability}'.
2. Call `fetch_web_content` for '{target_url}'.
3. Call `check_provider_exists` and decide to create or update.
4. Set `template_engine="jinja2"`.
5. Map INTERNAL fields to PROVIDER fields in `request_template`.
6. Map PROVIDER output back to our INTERNAL schema in `response_transform`.

Rules:
- DO NOT crawl the same URL twice.
- Be precise with Jinja2 syntax.
"""}
    ]

    result_summary = "Task started"

    for turn in range(10):
        try:
            response = await llm_service.chat_completion(
                messages=messages, tools=tools, model=model_hint, temperature=0
            )
        except Exception as e:
            logger.error(f"Discovery Agent LLM Error: {e}")
            return f"Failed at turn {turn}: {str(e)}"

        if isinstance(response, str):
            messages.append({"role": "assistant", "content": response})
            if "successfully" in response.lower() or "done" in response.lower():
                result_summary = response
                break
        
        elif isinstance(response, list):
            messages.append({"role": "assistant", "tool_calls": [
                {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                for tc in response
            ]})

            for tool_call in response:
                func = tool_map.get(tool_call.name)
                try:
                    # Generic dispatcher
                    if tool_call.name == "fetch_web_content": res = await func(url=tool_call.arguments["url"])
                    elif tool_call.name == "get_unified_schema": res = await func(capability=tool_call.arguments["capability"])
                    elif tool_call.name == "check_provider_exists": res = await func(slug=tool_call.arguments["slug"])
                    else: res = await func(tool_call.arguments)
                    
                    res_str = json.dumps(res, default=str)
                except Exception as e:
                    res_str = f"Error: {str(e)}"

                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": res_str})

    logger.info(f"Discovery Agent Task Finished: {result_summary}")
    return result_summary
