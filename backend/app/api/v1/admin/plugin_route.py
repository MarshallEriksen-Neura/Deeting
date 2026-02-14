from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps.superuser import get_current_superuser
from app.schemas.admin_ops import (
    PluginAdminItem,
    PluginAdminListResponse,
    PluginReloadResponse,
)
from app.services.admin import PluginAdminService

router = APIRouter(prefix="/admin/plugins", tags=["Admin - Plugins"])


def get_service() -> PluginAdminService:
    return PluginAdminService()


@router.get("", response_model=PluginAdminListResponse)
def list_plugins(
    _=Depends(get_current_superuser),
    service: PluginAdminService = Depends(get_service),
) -> PluginAdminListResponse:
    return service.list_plugins()


@router.get("/{plugin_name}", response_model=PluginAdminItem)
def get_plugin(
    plugin_name: str,
    _=Depends(get_current_superuser),
    service: PluginAdminService = Depends(get_service),
) -> PluginAdminItem:
    return service.get_plugin(plugin_name)


@router.post("/{plugin_name}/reload", response_model=PluginReloadResponse)
def reload_plugin(
    plugin_name: str,
    _=Depends(get_current_superuser),
    service: PluginAdminService = Depends(get_service),
) -> PluginReloadResponse:
    return service.reload_plugin(plugin_name)
