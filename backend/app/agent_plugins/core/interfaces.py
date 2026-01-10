from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class PluginMetadata(BaseModel):
    """
    Plugin Metadata (Manifest).
    Equivalent to the core part of VS Code's package.json.
    """
    name: str = Field(..., description="Unique plugin identifier (e.g., 'core.crawler')")
    version: str = Field(..., description="Semantic version string")
    description: str = Field("", description="Human-readable description")
    author: str | None = None
    dependencies: list[str] = Field(default_factory=list, description="Other plugins this plugin requires")


class PluginContext(ABC):
    """
    Plugin Context Interface.
    This is the only bridge between the plugin and the host system.
    Plugins should not directly import global objects like app.db.
    """

    @property
    @abstractmethod
    def working_directory(self) -> str:
        """Private working directory for the plugin"""
        pass

    @abstractmethod
    def get_logger(self, name: str | None = None):
        """Get a logger with plugin context"""
        pass

    # The Session type is replaced with Any to avoid circular imports;
    # in practice, a SQLAlchemy Session (or wrapper) will be injected.
    @abstractmethod
    def get_db_session(self) -> Any:
        """Get database session"""
        pass

    @abstractmethod
    def get_config(self, key: str, default: Any = None) -> Any:
        """Get system configuration or plugin-specific configuration"""
        pass

    @property
    @abstractmethod
    def memory(self) -> Any:
        """
        Get the scoped vector store memory for this plugin.
        Returns a VectorStoreClient.
        """
        pass



class AgentPlugin(ABC):
    """
    Base class for all concrete plugins.
    """

    def __init__(self):
        self._context: PluginContext | None = None

    @property
    @abstractmethod
    def metadata(self) -> PluginMetadata:
        """Return the plugin's metadata"""
        pass

    async def initialize(self, context: PluginContext) -> None:
        """
        Lifecycle hook: Called when the plugin is activated.
        Similar to VS Code's activate(context).
        """
        self._context = context
        await self.on_activate()

    async def shutdown(self) -> None:
        """
        Lifecycle hook: Called when the plugin is unloaded or the system shuts down.
        Similar to VS Code's deactivate().
        """
        await self.on_deactivate()
        self._context = None

    @property
    def context(self) -> PluginContext:
        if not self._context:
            raise RuntimeError(f"Plugin {self.metadata.name} is not initialized")
        return self._context

    # --- Methods to be implemented by the user ---

    async def on_activate(self) -> None:
        """(Optional) Initialization logic when the plugin starts"""
        pass

    async def on_deactivate(self) -> None:
        """(Optional) Cleanup logic when the plugin stops"""
        pass

    def get_tools(self) -> list[Any]:
        """
        (Optional) Return a list of tools provided by this plugin.
        The format should be compatible with OpenAI Tool Definition or LangChain Tool.
        """
        return []

    def get_resource_handlers(self) -> dict[str, Any]:
        """
        (Optional) Return resource handlers (for future extensions)
        """
        return {}
