from __future__ import annotations

from app.services.workflow.steps.agent_executor import AgentExecutorStep


class _DummyCtx:
    def __init__(self, session_id: str, allowed_tools):
        self.session_id = session_id
        self._allowed_tools = allowed_tools

    def get(self, step_name: str, key: str, default=None):
        if (step_name, key) == ("monitor", "allowed_tools"):
            return self._allowed_tools
        return default


def test_resolve_monitor_allowed_tools_for_monitor_session():
    ctx = _DummyCtx("monitor:123", ["fetch_web_content", "search_knowledge"])
    allowed = AgentExecutorStep._resolve_monitor_allowed_tools(ctx)  # type: ignore[arg-type]
    assert allowed == {"fetch_web_content", "search_knowledge"}


def test_resolve_monitor_allowed_tools_non_monitor_returns_none():
    ctx = _DummyCtx("chat:123", ["fetch_web_content"])
    allowed = AgentExecutorStep._resolve_monitor_allowed_tools(ctx)  # type: ignore[arg-type]
    assert allowed is None


def test_resolve_monitor_allowed_tools_missing_list_returns_empty():
    ctx = _DummyCtx("monitor:123", None)
    allowed = AgentExecutorStep._resolve_monitor_allowed_tools(ctx)  # type: ignore[arg-type]
    assert allowed == set()
