from typing import Dict, List, Type

from app.logging_config import logger
from app.plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.plugins.core.context import ConcretePluginContext


class PluginManager:
    """
    插件管理器。
    负责插件的注册、生命周期管理和工具聚合。
    """

    def __init__(self):
        self._plugins: Dict[str, AgentPlugin] = {}
        self._plugin_classes: Dict[str, Type[AgentPlugin]] = {}

    def register_class(self, plugin_cls: Type[AgentPlugin]) -> None:
        """
        注册一个插件类（不实例化）。
        用于启动时收集所有的内置插件类。
        """
        # 临时实例化以获取元数据，或者要求 metadata 是类属性
        # 这里假设 metadata 是实例属性，先实例化检查
        # 实际生产中最好 metadata 是类静态配置
        temp_instance = plugin_cls()
        name = temp_instance.metadata.name
        
        if name in self._plugin_classes:
            logger.warning(f"Plugin class {name} already registered, overwriting.")
        
        self._plugin_classes[name] = plugin_cls
        logger.info(f"Registered plugin class: {name}")

    def activate_all(self) -> None:
        """
        实例化并激活所有已注册的插件。
        """
        for name, cls in self._plugin_classes.items():
            if name in self._plugins:
                continue
            
            try:
                plugin = cls()
                context = ConcretePluginContext(plugin_name=name)
                plugin.initialize(context)
                self._plugins[name] = plugin
                logger.info(f"Activated plugin: {name}")
            except Exception as e:
                logger.exception(f"Failed to activate plugin {name}: {e}")

    def deactivate_all(self) -> None:
        """
        关闭所有插件。
        """
        for name, plugin in self._plugins.items():
            try:
                plugin.shutdown()
                logger.info(f"Deactivated plugin: {name}")
            except Exception as e:
                logger.error(f"Error deactivating plugin {name}: {e}")
        self._plugins.clear()

    def get_plugin(self, name: str) -> AgentPlugin | None:
        return self._plugins.get(name)

    def get_all_tools(self) -> List[dict]:
        """
        聚合所有已激活插件提供的工具。
        """
        tools = []
        for plugin in self._plugins.values():
            try:
                plugin_tools = plugin.get_tools()
                # 可以在这里给工具名加上 namespace 前缀防止冲突
                tools.extend(plugin_tools)
            except Exception as e:
                logger.error(f"Error getting tools from plugin {plugin.metadata.name}: {e}")
        return tools

# 全局单例
global_plugin_manager = PluginManager()
