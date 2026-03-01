from types import SimpleNamespace

from app.agent_plugins.builtins.monitor.plugin import MonitorPlugin


def test_monitor_plugin_tools_include_sys_update():
    plugin = MonitorPlugin()
    tool_names = [tool.get("function", {}).get("name") for tool in plugin.get_tools()]
    assert "sys_create_monitor" in tool_names
    assert "sys_list_monitors" in tool_names
    assert "sys_update_monitor" in tool_names


def test_resolve_model_from_context_prefers_requested_model():
    ctx = SimpleNamespace(requested_model="openai/gpt-4.1")
    resolved = MonitorPlugin._resolve_model_from_context(ctx)
    assert resolved == "openai/gpt-4.1"


def test_resolve_model_from_context_falls_back_validation_model():
    class DummyCtx:
        requested_model = None

        def get(self, step: str, key: str):
            if (step, key) == ("validation", "model"):
                return "anthropic/claude-sonnet-4"
            return None

    resolved = MonitorPlugin._resolve_model_from_context(DummyCtx())
    assert resolved == "anthropic/claude-sonnet-4"
