import asyncio
import os
import sys

# Add parent directory to path to allow importing app
sys.path.append(os.getcwd())

from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin
from app.agent_plugins.core.manager import PluginManager


async def main():
    manager = PluginManager()
    manager.register_class(CrawlerPlugin)
    await manager.activate_all()

    plugin = manager.get_plugin("core.tools.crawler")
    if not plugin:
        print("Crawler plugin not found.")
        return

    url = "https://example.com"
    print(f"Crawling {url}...")

    try:
        result = await plugin.handle_fetch_web_content(url)

        print("-" * 30)
        print("Status:", result.get("status"))
        print("Title:", result.get("title"))
        print("Text Content (first 100 chars):", result.get("text", "")[:100])
        print("Markdown Extracted:", "Yes" if result.get("markdown") else "No")
        print("Error:", result.get("error"))
        print("-" * 30)
    except Exception as e:
        print(f"Test failed: {e}")

    await manager.deactivate_all()

if __name__ == "__main__":
    asyncio.run(main())
