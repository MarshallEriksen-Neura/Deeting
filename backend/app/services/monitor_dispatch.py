from __future__ import annotations

from enum import Enum
from typing import Any


class MonitorExecutionTarget(str, Enum):
    CLOUD = "cloud"
    DESKTOP = "desktop"
    DESKTOP_PREFERRED = "desktop_preferred"


def normalize_monitor_execution_target(value: Any) -> MonitorExecutionTarget:
    if isinstance(value, MonitorExecutionTarget):
        return value
    if hasattr(value, "value"):
        value = getattr(value, "value")
    raw = str(value or "").strip().lower()
    if raw == MonitorExecutionTarget.DESKTOP.value:
        return MonitorExecutionTarget.DESKTOP
    if raw == MonitorExecutionTarget.DESKTOP_PREFERRED.value:
        return MonitorExecutionTarget.DESKTOP_PREFERRED
    return MonitorExecutionTarget.CLOUD


def resolve_monitor_execution_target(
    notify_config: dict[str, Any] | None,
) -> MonitorExecutionTarget:
    if not isinstance(notify_config, dict):
        return MonitorExecutionTarget.CLOUD
    return normalize_monitor_execution_target(notify_config.get("execution_target"))


def apply_monitor_execution_target(
    notify_config: dict[str, Any] | None,
    execution_target: MonitorExecutionTarget | str,
) -> dict[str, Any]:
    normalized = normalize_monitor_execution_target(execution_target)
    merged = dict(notify_config or {})
    merged["execution_target"] = normalized.value
    return merged


def is_cloud_scheduled_target(target: MonitorExecutionTarget | str) -> bool:
    return normalize_monitor_execution_target(target) != MonitorExecutionTarget.DESKTOP


def is_local_dispatch_target(target: MonitorExecutionTarget | str) -> bool:
    normalized = normalize_monitor_execution_target(target)
    return normalized in {
        MonitorExecutionTarget.DESKTOP,
        MonitorExecutionTarget.DESKTOP_PREFERRED,
    }


def desktop_heartbeat_key(user_id: Any) -> str:
    return f"monitor:desktop:heartbeat:{user_id}"
