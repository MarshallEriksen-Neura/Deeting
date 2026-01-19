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
from app.agent_plugins.core.manager import PluginManager # Use standard manager

logger = logging.getLogger(__name__)

@celery_app.task(queue="agent_tasks", name="app.tasks.agent.run_auto_ingestion_job")
def run_auto_ingestion_job(target_url: str, instruction: str):
    """
    Background Worker:
    1. Crawls a URL.
    2. Uses LLM to extract data based on 'instruction'.
    3. Writes data to DB using DatabasePlugin.
    """
    return asyncio.run(_worker_logic(target_url, instruction))

async def _worker_logic(target_url: str, instruction: str):
    job_id = str(uuid.uuid4())[:8]
    logger.info(f"[Worker-{job_id}] Started ingestion for: {target_url}")
    
    # 1. Setup Plugins
    manager = PluginManager()
    manager.register_class(CrawlerPlugin)
    manager.register_class(DatabasePlugin)
    # If we had a VectorStorePlugin, we'd add it here too
    
    await manager.activate_all()
    crawler = manager.get_plugin("core.tools.crawler")
    db_plugin = manager.get_plugin("system/database_manager") # use correct name from metadata

    # 2. Crawl
    logger.info(f"[Worker-{job_id}] Crawling...")
    crawl_result = await crawler.handle_fetch_web_content(url=target_url)
    
    if crawl_result.get("error"):
        return f"Job failed: Crawl error - {crawl_result['error']}"

    content = crawl_result.get("markdown", "")[:20000] # Limit context for safety
    
    # 3. LLM Extraction & Action
    # We ask the LLM to process the content and decide what to store.
    # We give it the 'db_plugin' tools so it can verify/save directly.
    
    tools = []
    tool_map = {}
    
    # Only expose DB tools to the worker LLM (it doesn't need to crawl again)
    raw_tools = db_plugin.get_tools()
    for t in raw_tools:
        tools.append(ToolDefinition(
            name=t["function"]["name"],
            description=t["function"]["description"],
            input_schema=t["function"]["parameters"]
        ))
        # Bind handler
        handler_name = t["function"]["name"] # DatabasePlugin uses direct names in previous implementation? 
        # Actually checking implementation: check_provider_preset_exists, create_provider_preset, etc.
        # Let's bind them.
        if hasattr(db_plugin, handler_name):
            tool_map[handler_name] = getattr(db_plugin, handler_name)

    system_prompt = f"""
You are an autonomous Data Ingestion Worker.
Your Task: {instruction}

Context (Crawled Content):
---
{content}
---

Action:
Extract the relevant information from the context and use the available database tools (like 'create_provider_preset' or 'update_provider_preset') to save it.
If the data is already there, update it.
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    logger.info(f"[Worker-{job_id}] Thinking...")
    
    # One-shot or Multi-turn loop
    actions_taken = []
    
    for i in range(5):
        try:
            response = await llm_service.chat_completion(
                messages=messages, tools=tools, temperature=0.0
            )
            
            if isinstance(response, str):
                logger.info(f"[Worker-{job_id}] Finished: {response}")
                return f"Job {job_id} Completed: {response}"
            
            elif isinstance(response, list): # Tool Calls
                messages.append({
                    "role": "assistant", 
                    "tool_calls": [
                        {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                        for tc in response
                    ]
                })
                
                for tc in response:
                    func = tool_map.get(tc.name)
                    if func:
                        logger.info(f"[Worker-{job_id}] Executing {tc.name}...")
                        res = await func(tc.arguments)
                        actions_taken.append(f"Called {tc.name}: {res}")
                        res_str = str(res)
                    else:
                        res_str = "Error: Tool not found"
                        
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": res_str})

        except Exception as e:
            logger.error(f"[Worker-{job_id}] LLM Error: {e}")
            return f"Job failed: {e}"

    await manager.deactivate_all()
    return f"Job finished. Actions: {'; '.join(actions_taken)}"