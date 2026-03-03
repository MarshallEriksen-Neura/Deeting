import uuid
from typing import Any

from loguru import logger

from app.agent_plugins.core.context import ConcretePluginContext
from app.agent_plugins.core.interfaces import AgentPlugin, PluginContext


class PluginManager:
    """
    Lightweight Core Plugin Manager.
    Only handles essential system plugins (like deeting_core_sdk).
    Business skills are now handled by SkillRegistry.
    """

    def __init__(self):
        # Registry of core plugin classes: "name" -> Class
        self._plugin_classes: dict[str, type[AgentPlugin]] = {}
        # Runtime activated core plugin instances
        self._plugins: dict[str, AgentPlugin] = {}

    @property
    def plugins(self) -> dict[str, AgentPlugin]:
        """Expose active plugin instances."""
        return self._plugins

    def register_class(self, plugin_cls: type[AgentPlugin]) -> None:
        """Register a core plugin class."""
        try:
            # We instantiate briefly to read metadata
            temp_instance = plugin_cls()
            name = temp_instance.metadata.name # Use name as unique key

            self._plugin_classes[name] = plugin_cls
            logger.info(f"Registered core plugin class: {name}")
        except Exception as e:
            logger.exception(f"Failed to register core plugin class {plugin_cls}: {e}")


    async def activate_all(
        self, user_id: uuid.UUID | None = None, session_id: str | None = None
    ) -> None:
        """Instantiate and initialize all registered core plugins."""
        self._plugins.clear()
        for name, cls in self._plugin_classes.items():
            try:
                plugin = cls()
                context = ConcretePluginContext(
                    plugin_name=name,
                    plugin_id=name,
                    user_id=user_id,
                    session_id=session_id,
                )
                await plugin.initialize(context)
                self._plugins[name] = plugin
                logger.debug(f"Activated core plugin: {name}")
            except Exception as exc:
                logger.exception(f"Failed to activate core plugin {name}: {exc}")

    async def deactivate_all(self) -> None:
        """Shutdown and clear all active core plugins."""
        for name, plugin in list(self._plugins.items()):
            try:
                await plugin.shutdown()
            except Exception as exc:
                logger.warning(f"Failed to deactivate core plugin {name}: {exc}")
        self._plugins.clear()

    def get_plugin(self, name: str) -> AgentPlugin | None:
        """Get an active core plugin instance."""
        return self._plugins.get(name)

    def get_plugin_name_for_tool_from_registry(self, tool_name: str) -> str | None:
        """Resolve owning plugin name by scanning both active instances and registered classes."""
        # 1. Check active instances first
        for name, plugin in self._plugins.items():
            try:
                for tool in plugin.get_tools() or []:
                    if isinstance(tool, dict):
                        name_in_tool = tool.get("function", {}).get("name") or tool.get("name")
                        if name_in_tool == tool_name:
                            return name
            except Exception:
                continue
        
        # 2. Fallback to registered classes (instantiate temporarily to inspect tools)
        for name, cls in self._plugin_classes.items():
            try:
                temp_inst = cls()
                for tool in temp_inst.get_tools() or []:
                    if isinstance(tool, dict):
                        name_in_tool = tool.get("function", {}).get("name") or tool.get("name")
                        if name_in_tool == tool_name:
                            return name
            except Exception:
                continue
                
        return None

    def get_plugin_for_tool(self, tool_name: str) -> AgentPlugin | None:
        """Find the core plugin instance that owns the given tool."""
        for plugin in self._plugins.values():
            try:
                for tool in plugin.get_tools() or []:
                    # Handle both OpenAI function style and flat name
                    name = tool.get("function", {}).get("name") or tool.get("name")
                    if name == tool_name:
                        return plugin
            except Exception:
                continue
        return None

    def get_all_tools(self) -> list[dict[str, Any]]:
        """Summarize all tools exposed by core plugins."""
        tools = []
        for plugin in self._plugins.values():
            try:
                tools.extend(plugin.get_tools() or [])
            except Exception as exc:
                logger.warning(f"get_tools failed for {plugin}: {exc}")
        return tools


# Global singleton for core system plugins
global_plugin_manager = PluginManager()
