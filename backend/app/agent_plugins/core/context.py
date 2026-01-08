import os
import uuid
from typing import Any

from loguru import logger as root_logger

from app.agent_plugins.core.interfaces import PluginContext
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.qdrant_client import get_qdrant_client, qdrant_is_configured
from app.services.vector.qdrant_user_service import QdrantUserVectorService, VectorStoreClient


class ConcretePluginContext(PluginContext):
    """
    Concrete implementation of PluginContext.
    Bridges Backend infrastructure (SQLAlchemy Async, Loguru, Settings) to plugins.
    """

    def __init__(self, plugin_name: str, plugin_id: str, user_id: uuid.UUID):
        self._plugin_name = plugin_name
        self._plugin_id = plugin_id
        self._user_id = user_id
        
        # Loguru uses bind() to add context fields.
        # We bind 'plugin' so logs from this context have {plugin: name}
        self._logger = root_logger.bind(plugin=plugin_name, user_id=str(user_id))
        self._memory_client: VectorStoreClient | None = None

    @property
    def working_directory(self) -> str:
        # Assume each plugin has a temp working dir
        path = os.path.join("/tmp/agent_plugins", self._plugin_name)
        os.makedirs(path, exist_ok=True)
        return path

    def get_logger(self, name: str | None = None):
        """
        Returns a loguru logger bound with extra context.
        """
        if name:
            return self._logger.bind(submodule=name)
        return self._logger

    def get_db_session(self) -> Any:
        """
        Returns a new AsyncSession.
        Caller (Plugin) is responsible for closing it (await session.close()).
        """
        return AsyncSessionLocal()

    def get_config(self, key: str, default: Any = None) -> Any:
        """
        Get config from system settings.
        """
        return getattr(settings, key, default)

    @property
    def memory(self) -> VectorStoreClient:
        """
        Get the scoped vector store memory for this plugin.
        Lazy initializes the client.
        """
        if self._memory_client:
            return self._memory_client
            
        if not qdrant_is_configured():
            # In a real app, maybe return an InMemoryVectorStore or raise Error
            # For now, raise Error to prompt configuration
            raise RuntimeError("Qdrant is not configured. Plugin memory is unavailable.")
            
        raw_client = get_qdrant_client()

        self._memory_client = QdrantUserVectorService(
            client=raw_client,
            plugin_id=self._plugin_id,
            user_id=self._user_id,
            embedding_model=getattr(settings, "EMBEDDING_MODEL", None),
            fail_open=True,
        )
        return self._memory_client
