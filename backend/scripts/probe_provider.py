import argparse
import asyncio
import os
import sys

# Add parent directory to path to allow importing app
sys.path.append(os.getcwd())

from app.agent_plugins.builtins.provider_registry_plugin import ProviderRegistryPlugin

from app.agent_plugins.core.manager import PluginManager


async def main():
    parser = argparse.ArgumentParser(description="Probe a provider using the Provider Registry Plugin.")
    parser.add_argument("--provider", required=True, choices=["openai", "gemini"], help="Provider type")
    parser.add_argument("--url", required=True, help="Base URL")
    parser.add_argument("--key", required=True, help="API Key")
    parser.add_argument("--model", required=True, help="Model name")
    parser.add_argument("--message", default="Hello, this is a test.", help="Test message")

    args = parser.parse_args()

    # Init Plugin System
    manager = PluginManager()
    manager.register_class(ProviderRegistryPlugin)
    await manager.activate_all()

    plugin = manager.get_plugin("core.registry.provider")
    if not plugin:
        print("Error: Plugin not found.")
        return

    print(f"Probing {args.provider} at {args.url} with model {args.model}...")

    # Call the handler directly for simplicity
    # In a real agent loop, this would be routed via tool name
    result = await plugin.handle_probe_provider(
        provider_type=args.provider,
        base_url=args.url,
        api_key=args.key,
        model=args.model,
        test_message=args.message
    )

    print("-" * 50)
    print(result)
    print("-" * 50)

    await manager.deactivate_all()

if __name__ == "__main__":
    asyncio.run(main())
