from pathlib import Path

import yaml


def _load_plugins() -> list[dict]:
    plugins_yaml = (
        Path(__file__).resolve().parents[2] / "app" / "core" / "plugins.yaml"
    )
    content = yaml.safe_load(plugins_yaml.read_text(encoding="utf-8"))
    return content.get("plugins", [])


def test_plugins_yaml_registers_crawler_poll_repo_ingestion():
    plugins = _load_plugins()
    plugin = next(
        (p for p in plugins if p.get("id") == "core.tools.crawler"),
        None,
    )
    assert plugin is not None
    tool_names = set(plugin.get("tools", []))
    assert "submit_repo_ingestion" in tool_names
    assert "poll_repo_ingestion" in tool_names


def test_plugins_yaml_registers_planner_actual_tool_names():
    plugins = _load_plugins()
    plugin = next(
        (p for p in plugins if p.get("id") == "system.planner"),
        None,
    )
    assert plugin is not None
    tool_names = set(plugin.get("tools", []))
    assert "propose_execution_plan" in tool_names
    assert "retrieve_similar_plans" in tool_names
    assert "create_plan" not in tool_names
