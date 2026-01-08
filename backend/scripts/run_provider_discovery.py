import asyncio
import json
import sys
import os

# Add backend to path
sys.path.append(os.getcwd())

from sqlalchemy import select, or_

from app.services.llm import llm_service
from app.agent_plugins.builtins.database.plugin import DatabasePlugin
from app.core.database import AsyncSessionLocal
from app.schemas.tool import ToolDefinition, ToolCall

from app.models.provider_preset import ProviderPreset, ProviderPresetItem

# --- 0. Setup Test Brain (Bootstrapping) ---
async def setup_test_brain():
    """
    Creates a temporary ProviderPreset in DB using env vars.
    """
    base_url = os.getenv("TEST_LLM_BASE_URL", "https://www.xiaoyo.cn/").strip("/")
    api_key = os.getenv("TEST_API_KEY") or os.getenv("TEST_LLM_API_KEY")
    model = os.getenv("TEST_LLM_MODEL", "Kimi-K2")
    
    if not base_url or not api_key:
        print("Error: TEST_API_KEY and TEST_LLM_BASE_URL are required for this test.")
        return None, None

    print(f"Bootstrapping Test Brain: {model} @ {base_url}")
    
    import uuid
    async with AsyncSessionLocal() as session:
        # Reuse existing preset to avoid unique constraint violations (name/slug are unique)
        existing_preset = await session.execute(
            select(ProviderPreset).where(
                or_(ProviderPreset.slug == "test-brain", ProviderPreset.name == "Test Brain Provider")
            )
        )
        preset = existing_preset.scalar_one_or_none()

        if preset:
            # Keep latest credentials/base_url in case env changed
            preset.base_url = base_url
            preset.auth_config = {"secret": api_key}
            preset_id = preset.id
        else:
            preset_id = uuid.uuid4()
            preset = ProviderPreset(
                id=preset_id,
                name="Test Brain Provider",
                slug="test-brain",
                provider="openai-compat",  # Generic
                base_url=base_url,
                auth_type="bearer",
                auth_config={"secret": api_key},  # Direct secret for simplicity in test
                is_active=True,
            )
            session.add(preset)

        existing_item = await session.execute(
            select(ProviderPresetItem).where(
                ProviderPresetItem.preset_id == preset_id,
                ProviderPresetItem.capability == "chat",
                ProviderPresetItem.model == model,
            )
        )
        item = existing_item.scalar_one_or_none()
        if not item:
            item = ProviderPresetItem(
                preset_id=preset_id,
                capability="chat",
                model=model,
                unified_model_id=model,  # Map input model to itself
                upstream_path="/v1/chat/completions",  # Standard path
                template_engine="openai_compat",
                request_template={},
                is_active=True,
            )
            session.add(item)

        await session.commit()

        # Set the internal ID so llm_service uses this one
        # We need to hack/patch settings or pass preset_id explicitly
        return str(preset_id), model

# --- 1. Mock Crawler (Simulating "Learning") ---
class MockCrawlerPlugin:
    def get_tools(self):
        return [
            {
                "type": "function",
                "function": {
                    "name": "fetch_web_content",
                    "description": "Fetch content from a URL.",
                    "parameters": {"type": "object", "properties": {"url": {"type": "string"}}}
                }
            }
        ]

    async def fetch_web_content(self, url: str):
        print(f"[Crawler] Pretending to crawl: {url}")
        # Return Simplified Markdown to save tokens and confusion
        return """
# DeepSeek API Documentation

## Authentication
Auth: Bearer Token.
Header: `Authorization: Bearer <DEEPSEEK_API_KEY>`

## Base URL
`https://api.deepseek.com`

## Endpoints
- `POST /chat/completions` (OpenAI Compatible)
- Model: `deepseek-chat`
"""

# --- 2. The Agent Logic (ReAct Loop) ---

async def run_agent():
    print("--- Starting Provider Discovery Agent ---")
    
    # Bootstrap Brain
    brain_preset_id, brain_model = await setup_test_brain() or (None, "gpt-4o")
    if not brain_preset_id:
        return

    # Initialize Plugins
    db_plugin = DatabasePlugin()
    crawler_plugin = MockCrawlerPlugin()
    
    # Collect Tools (Convert to Internal ToolDefinition)
    tools = []
    
    # Map for execution
    tool_map = {}

    # Helper to register tools
    def register(plugin, method_name, tool_def):
        tool_name = tool_def["function"]["name"]
        tools.append(ToolDefinition(
            name=tool_name,
            description=tool_def["function"]["description"],
            input_schema=tool_def["function"]["parameters"]
        ))
        # Bind method
        if hasattr(plugin, method_name):
            tool_map[tool_name] = getattr(plugin, method_name)
        else:
            tool_map[tool_name] = getattr(plugin, tool_name)

    # Register Crawler
    register(crawler_plugin, "fetch_web_content", crawler_plugin.get_tools()[0])
    
    # Register DB Tools
    for t in db_plugin.get_tools():
        register(db_plugin, t["function"]["name"], t)

    # Agent Memory
    messages = [
        {"role": "system", "content": """
You are a "Provider Management Agent". Your goal is to ensure our model registry is up-to-date and uses the most flexible engines.

Current Task:
1. Check if the provider 'deepseek' and model 'deepseek-chat' exist.
2. If they exist and are using 'openai_compat', UPDATE them to use the 'jinja2' engine.
3. When using 'jinja2', create a robust template that maps:
   - `model` -> `deepseek-chat`
   - `messages` -> `messages`
   - `temperature` -> `temperature` (default to 0.7 if not provided)
4. If they don't exist, create them from scratch using 'jinja2' engine.

Rules:
- ALWAYS check existence first using `check_provider_exists`.
- Use `update_model_config` for existing models.
- DO NOT crawl the same URL twice. 
- Use 'DEEPSEEK_API_KEY' as the auth config key name.

Target: DeepSeek (deepseek-chat)
Docs URL: https://api.deepseek.com/docs (Simulated)
"""}
    ]

    # Max Turns
    for turn in range(5):
        print(f"\n--- Turn {turn + 1} ---")
        
        try:
            response = await llm_service.chat_completion(
                messages=messages,
                tools=tools,
                preset_id=brain_preset_id,
                model=brain_model, 
                temperature=0
            )
        except Exception as e:
            print(f"LLM Call Failed: {e}")
            return

        # 2. Handle Response
        if isinstance(response, str):
            print(f"[Agent]: {response}")
            messages.append({"role": "assistant", "content": response})
            if "successfully" in response.lower() or "done" in response.lower():
                break
        
        elif isinstance(response, list): # List[ToolCall]
            tool_calls_payload = [
                {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                for tc in response
            ]
            # IMPORTANT: Pass tool_calls so LLM knows it made a call
            messages.append({"role": "assistant", "tool_calls": tool_calls_payload})

            for tool_call in response:
                print(f"[Agent Tool Call]: {tool_call.name}({tool_call.arguments})")
                
                # Execute Tool
                func = tool_map.get(tool_call.name)
                if func:
                    try:
                        if tool_call.name == "fetch_web_content":
                            result = await func(tool_call.arguments["url"])
                        elif tool_call.name == "check_provider_exists":
                            result = await func(tool_call.arguments["slug"])
                        else:
                            result = await func(tool_call.arguments)
                        
                        result_str = json.dumps(result, default=str)
                        print(f"[Tool Output]: {result_str[:100]}...")
                    except Exception as e:
                        result_str = f"Error: {str(e)}"
                        print(f"[Tool Error]: {result_str}")
                else:
                    result_str = "Error: Tool not found"

                # Append Tool Output to history
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result_str
                })

if __name__ == "__main__":
    asyncio.run(run_agent())
