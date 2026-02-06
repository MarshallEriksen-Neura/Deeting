import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


@dataclass
class PluginConfigItem:
    id: str
    name: str
    module: str
    class_name: str
    enabled_by_default: bool = False
    is_always_on: bool = False
    restricted: bool = False
    allowed_roles: list[str] = field(default_factory=list)
    description: str = ""
    tools: list[str] = field(default_factory=list)


class PluginConfigLoader:
    def __init__(self, config_path: str = "plugins.yaml"):
        self.config_path = Path(__file__).parent / config_path
        self.plugins: list[PluginConfigItem] = []
        self._loaded = False

    def load(self):
        if self._loaded:
            return

        if not self.config_path.exists():
            logger.warning(f"Plugin config not found at {self.config_path}")
            return

        try:
            with open(self.config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
                plugins_raw = data.get("plugins", [])
                for p in plugins_raw:
                    self.plugins.append(
                        PluginConfigItem(
                            id=p.get("id"),
                            name=p.get("name"),
                            module=p.get("module"),
                            class_name=p.get("class_name"),
                            enabled_by_default=p.get("enabled_by_default", False),
                            is_always_on=p.get("is_always_on", False),
                            restricted=p.get("restricted", False),
                            allowed_roles=p.get("allowed_roles", []),
                            description=p.get("description", ""),
                            tools=p.get("tools", []),
                        )
                    )
            self._loaded = True
            logger.info(f"Loaded {len(self.plugins)} system plugins from config.")
        except Exception as e:
            logger.error(f"Failed to load plugin config: {e}")

    def get_all_plugins(self) -> list[PluginConfigItem]:
        self.load()
        return self.plugins

    def get_enabled_plugins(self) -> list[PluginConfigItem]:
        self.load()
        return [p for p in self.plugins if p.enabled_by_default]

    def get_plugins_for_user(
        self, user_roles: set[str], is_superuser: bool
    ) -> list[PluginConfigItem]:
        """返回用户可用的插件：公开插件 + 用户有权限的受限插件"""
        self.load()
        result = []
        for p in self.plugins:
            if p.enabled_by_default:
                result.append(p)
            elif p.restricted and (
                is_superuser or (set(p.allowed_roles) & user_roles)
            ):
                result.append(p)
        return result

    def get_indexable_plugins(self) -> list[PluginConfigItem]:
        """返回所有应被索引的插件（公开 + 受限），供 Qdrant JIT 检索"""
        self.load()
        return [p for p in self.plugins if p.enabled_by_default or p.restricted]

    def get_plugin_class(self, plugin_item: PluginConfigItem):
        """Dynamically import and return the plugin class."""
        try:
            module = __import__(plugin_item.module, fromlist=[plugin_item.class_name])
            return getattr(module, plugin_item.class_name)
        except Exception as e:
            logger.error(f"Failed to import plugin {plugin_item.id}: {e}")
            return None


# Singleton
plugin_config_loader = PluginConfigLoader()
