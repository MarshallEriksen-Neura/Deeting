import asyncio
import json
import os
import sys

import httpx
from dotenv import load_dotenv

# Add parent directory to path
sys.path.append(os.getcwd())
load_dotenv()

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.agent_plugins.builtins.provider_probe.plugin import ProviderProbePlugin
from app.agent_plugins.builtins.provider_registry.plugin import ProviderRegistryPlugin
from app.agent_plugins.core.manager import PluginManager

# Configuration from .env
API_URL = os.getenv("TEST_API_URL")
API_KEY = os.getenv("TEST_API_KEY")
MODEL = os.getenv("TEST_MODEL", "gpt-3.5-turbo")

async def main():
    if not API_URL or not API_KEY:
        print("Error: Please set TEST_API_URL and TEST_API_KEY in backend/.env")
        return

    # 1. Initialize Plugin System
    print("Initializing Agent Plugins...")
    manager = PluginManager()
    manager.register_class(CrawlerPlugin)
    manager.register_class(ProviderProbePlugin)
    manager.register_class(ProviderRegistryPlugin)
    await manager.activate_all()

    # Get tools schema
    tools = manager.get_all_tools()
    print(f"Loaded {len(tools)} tools: {[t['function']['name'] for t in tools]}")

    # 2. Construct Prompt for LLM
    messages = [
        {"role": "system", "content": "You are a DevOps Agent. You verify and save provider configurations."},
        {"role": "user", "content": "Please save a field mapping for provider 'openai-test'. The capability is 'chat'. The mapping should be: 'max_tokens' maps to 'max_completion_tokens' and 'temperature' maps to 'temperature'."}
    ]

    print(f"\nSending request to LLM [{MODEL}] at {API_URL}...")

    # Normalize URL logic
    base_url = API_URL.rstrip("/")
    chat_endpoint = f"{base_url}/chat/completions" if "chat/completions" not in base_url else base_url
    if base_url.endswith("/v1"):
         chat_endpoint = f"{base_url}/chat/completions"

    payload = {
        "model": MODEL,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto"
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                chat_endpoint,
                json=payload,
                headers={"Authorization": f"Bearer {API_KEY}"},
                timeout=60
            )

            resp_data = resp.json()
            if "choices" not in resp_data:
                print(f"Error: Response missing 'choices' field. Raw: {json.dumps(resp_data)}")
                return

            choice = resp_data["choices"][0]
            message = choice["message"]

            # 3. Check tool calls
            tool_calls = message.get("tool_calls")

            if tool_calls:
                print(f"\n[AI Decision] The AI decided to call {len(tool_calls)} tool(s).")

                for tc in tool_calls:
                    func_name = tc["function"]["name"]
                    raw_args = tc["function"]["arguments"]
                    print(f"  > Function: {func_name}")
                    print(f"  > Arguments: {raw_args}")

                    try:
                        args = json.loads(raw_args)
                    except json.JSONDecodeError:
                        print("Error: Failed to decode arguments JSON.")
                        continue

                    # 4. Execute the tool
                    if func_name == "fetch_web_content":
                        plugin = manager.get_plugin("core.tools.crawler")
                        result = await plugin.handle_fetch_web_content(**args)
                        print(f"[Result] Crawler Status: {result.get('status')}")

                    elif func_name == "save_provider_field_mapping":
                        plugin = manager.get_plugin("core.registry.provider")
                        result = await plugin.handle_save_provider_field_mapping(**args)
                        print(f"[Result] Registry: {result}")

                    elif func_name == "probe_provider":
                         plugin = manager.get_plugin("core.tools.provider_probe")
                         result = await plugin.handle_probe_provider(**args)
                         print(f"[Result] Probe: {result}")
                    else:
                        print(f"  Warning: Unknown tool {func_name}")
            else:
                print("\n[AI Decision] The AI did NOT call any tools. It replied directly:")
                print(message.get("content"))

    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await manager.deactivate_all()

if __name__ == "__main__":
    asyncio.run(main())
