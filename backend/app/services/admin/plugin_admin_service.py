from __future__ import annotations

import importlib

from fastapi import HTTPException, status

from app.core.plugin_config import PluginConfigItem, plugin_config_loader
from app.schemas.admin_ops import (
    PluginAdminItem,
    PluginAdminListResponse,
    PluginReloadResponse,
)


class PluginAdminService:
    def list_plugins(self) -> PluginAdminListResponse:
        plugins = plugin_config_loader.get_all_plugins()
        return PluginAdminListResponse(
            items=[self._to_item(plugin) for plugin in plugins]
        )

    def get_plugin(self, plugin_name: str) -> PluginAdminItem:
        plugin = self._find_plugin(plugin_name)
        return self._to_item(plugin)

    def reload_plugin(self, plugin_name: str) -> PluginReloadResponse:
        plugin = self._find_plugin(plugin_name)
        try:
            module = importlib.import_module(plugin.module)
            importlib.reload(module)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"plugin reload failed: {exc}",
            )
        return PluginReloadResponse(
            ok=True,
            plugin_id=plugin.id,
            message="plugin module reloaded",
        )

    def _find_plugin(self, plugin_name: str) -> PluginConfigItem:
        for plugin in plugin_config_loader.get_all_plugins():
            if plugin.id == plugin_name or plugin.name == plugin_name:
                return plugin
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="plugin not found",
        )

    def _to_item(self, plugin: PluginConfigItem) -> PluginAdminItem:
        metadata_name = plugin.name
        metadata_version: str | None = None
        metadata_description = plugin.description or ""
        metadata_author: str | None = None
        dependencies: list[str] = []
        tools = list(plugin.tools)

        plugin_cls = plugin_config_loader.get_plugin_class(plugin)
        status_value = "loaded" if plugin_cls else "unavailable"
        if plugin_cls:
            try:
                instance = plugin_cls()
                metadata = instance.metadata
                metadata_name = metadata.name
                metadata_version = metadata.version
                metadata_description = metadata.description or metadata_description
                metadata_author = metadata.author
                dependencies = list(metadata.dependencies)
                runtime_tools = instance.get_tools() or []
                for tool in runtime_tools:
                    if isinstance(tool, dict):
                        name = tool.get("function", {}).get("name")
                        if name and name not in tools:
                            tools.append(name)
            except Exception:
                status_value = "error"

        return PluginAdminItem(
            id=plugin.id,
            name=metadata_name,
            version=metadata_version,
            description=metadata_description,
            author=metadata_author,
            module=plugin.module,
            class_name=plugin.class_name,
            enabled_by_default=plugin.enabled_by_default,
            is_always_on=plugin.is_always_on,
            restricted=plugin.restricted,
            allowed_roles=list(plugin.allowed_roles),
            status=status_value,
            tools=tools,
            dependencies=dependencies,
        )
