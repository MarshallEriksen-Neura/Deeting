import yaml
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional

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
    allowed_roles: List[str] = field(default_factory=list)
    description: str = ""
    tools: List[str] = field(default_factory=list)

class PluginConfigLoader:
    def __init__(self, config_path: str = "plugins.yaml"):
        self.config_path = Path(__file__).parent / config_path
        self.plugins: List[PluginConfigItem] = []
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        
        if not self.config_path.exists():
            logger.warning(f"Plugin config not found at {self.config_path}")
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                plugins_raw = data.get("plugins", [])
                for p in plugins_raw:
                    self.plugins.append(PluginConfigItem(
                        id=p.get("id"),
                        name=p.get("name"),
                        module=p.get("module"),
                        class_name=p.get("class_name"),
                        enabled_by_default=p.get("enabled_by_default", False),
                        is_always_on=p.get("is_always_on", False),
                        restricted=p.get("restricted", False),
                        allowed_roles=p.get("allowed_roles", []),
                        description=p.get("description", ""),
                        tools=p.get("tools", [])
                    ))
            self._loaded = True
            logger.info(f"Loaded {len(self.plugins)} system plugins from config.")
        except Exception as e:
            logger.error(f"Failed to load plugin config: {e}")

    def get_all_plugins(self) -> List[PluginConfigItem]:
        self.load()
        return self.plugins

    def get_enabled_plugins(self) -> List[PluginConfigItem]:
        self.load()
        return [p for p in self.plugins if p.enabled_by_default]

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
