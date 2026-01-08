import importlib
import sys
from typing import Type

from loguru import logger
from sqlalchemy import select

from app.agent_plugins.core.context import ConcretePluginContext
from app.agent_plugins.core.interfaces import AgentPlugin, PluginContext
from app.core.database import AsyncSessionLocal
from app.models.agent_plugin import AgentPlugin as AgentPluginModel


class PluginManager:
    """
    Plugin Manager.
    Handles plugin registration (class discovery) and instantiation.
    Refactored to support DB-backed plugin discovery.
    """

    def __init__(self):
        # Registry of plugin classes: "official/weather" -> WeatherPlugin class
        self._plugin_classes: dict[str, Type[AgentPlugin]] = {}
        # Cache of initialized system plugins (singletons) - Optional optimization
        self._system_plugins: dict[str, AgentPlugin] = {}

    def register_class(self, plugin_cls: Type[AgentPlugin]) -> None:
        """
        Register a plugin class.
        """
        try:
            # We instantiate to read metadata (Name, Version)
            # This requires the plugin __init__ to be lightweight.
            temp_instance = plugin_cls()
            name = temp_instance.metadata.name

            if name in self._plugin_classes:
                logger.warning(f"Plugin class {name} already registered, overwriting.")

            self._plugin_classes[name] = plugin_cls
            logger.info(f"Registered plugin class: {name}")
        except Exception as e:
            logger.exception(f"Failed to register plugin class {plugin_cls}: {e}")

    async def load_plugins_from_db(self) -> None:
        """
        Scan 'agent_plugin' table and import referenced modules.
        This allows the manager to know about all available plugins.
        """
        async with AsyncSessionLocal() as session:
            stmt = select(AgentPluginModel)
            result = await session.execute(stmt)
            db_plugins = result.scalars().all()

        for db_plugin in db_plugins:
            try:
                # module_path e.g. "app.agent_plugins.builtins.weather"
                module_path = db_plugin.module_path
                if not module_path:
                    continue

                # Import the module
                if module_path not in sys.modules:
                    module = importlib.import_module(module_path)
                else:
                    module = sys.modules[module_path]

                # Look for an 'Plugin' class or 'plugins' list in the module
                # Convention: The module should export a class named 'Plugin' inheriting from AgentPlugin
                # OR have a global variable 'PLUGINS' list.
                
                # Strategy 1: Search for subclasses in the module
                found = False
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type) 
                        and issubclass(attr, AgentPlugin) 
                        and attr is not AgentPlugin
                    ):
                        self.register_class(attr)
                        found = True
                
                if not found:
                    logger.warning(f"No AgentPlugin subclass found in {module_path}")

            except Exception as e:
                logger.error(f"Failed to load plugin from {db_plugin.module_path}: {e}")

    async def instantiate_plugin(self, name: str, context: PluginContext) -> AgentPlugin:
        """
        Create an instance of a plugin for a specific context (User/Session).
        """
        cls = self._plugin_classes.get(name)
        if not cls:
            raise ValueError(f"Plugin {name} not found in registry.")
        
        plugin = cls()
        await plugin.initialize(context)
        return plugin

    def get_plugin_class(self, name: str) -> Type[AgentPlugin] | None:
        return self._plugin_classes.get(name)

# Global singleton
global_plugin_manager = PluginManager()