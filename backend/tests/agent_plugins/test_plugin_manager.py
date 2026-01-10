from unittest.mock import AsyncMock, patch

import pytest

from app.agent_plugins.core.manager import PluginManager
from app.agent_plugins.examples.hello_world import HelloWorldPlugin


@pytest.mark.asyncio
async def test_plugin_lifecycle():
    manager = PluginManager()

    # 1. Register
    manager.register_class(HelloWorldPlugin)
    assert "examples.hello_world" in manager._plugin_classes

    # 2. Activate
    # Mock ConcretePluginContext.get_db_session to avoid real DB usage
    with patch("app.agent_plugins.core.context.ConcretePluginContext.get_db_session") as mock_get_db:
        # Create a mock session with an async close method
        mock_session = AsyncMock()
        mock_get_db.return_value = mock_session

        await manager.activate_all()

        # Verify db.close() was called (inside on_activate)
        mock_session.close.assert_called_once()

    plugin = manager.get_plugin("examples.hello_world")
    assert plugin is not None
    assert plugin.context is not None

    # 3. Check Tools
    tools = manager.get_all_tools()
    assert len(tools) == 2
    tool_names = [t["function"]["name"] for t in tools]
    assert "get_current_system_time" in tool_names
    assert "echo_user_message" in tool_names

    # 4. Deactivate
    await manager.deactivate_all()
    assert len(manager._plugins) == 0
