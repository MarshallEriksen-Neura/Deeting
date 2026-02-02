from app.agent_plugins.builtins.crawler.plugin import CrawlerPlugin


def test_crawler_plugin_tools_include_repo_ingestion():
    plugin = CrawlerPlugin()
    tools = plugin.get_tools()
    assert any(
        tool.get("function", {}).get("name") == "submit_repo_ingestion"
        for tool in tools
    )
