from app.tasks import agent as agent_tasks


def test_run_discovery_task_builds_instruction(monkeypatch):
    captured = {}

    async def fake_workflow(target_url, instruction, **kwargs):
        captured["target_url"] = target_url
        captured["instruction"] = instruction
        captured["model_hint"] = kwargs.get("model_hint")
        captured["plugin_classes"] = kwargs.get("plugin_classes")
        captured["tool_plugin_names"] = kwargs.get("tool_plugin_names")
        return "ok"

    monkeypatch.setattr(agent_tasks, "_run_ingestion_workflow", fake_workflow)

    result = agent_tasks.run_discovery_task(
        "https://example.com/docs",
        capability="chat",
        model_hint="gpt-4o",
        provider_name_hint="ExampleAI",
    )

    assert result == "ok"
    assert captured["target_url"] == "https://example.com/docs"
    assert "Target capability: chat." in captured["instruction"]
    assert "Provider name hint: ExampleAI." in captured["instruction"]
    assert captured["model_hint"] == "gpt-4o"
    assert "core.registry.provider" in captured["tool_plugin_names"]
    assert "system/database_manager" in captured["tool_plugin_names"]
