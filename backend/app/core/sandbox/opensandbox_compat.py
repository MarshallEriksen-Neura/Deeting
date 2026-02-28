from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_PATCH_ATTR = "_deeting_traceback_null_compat_patched"


def apply_traceback_null_compat_patch() -> None:
    """
    Make OpenSandbox SSE parser tolerant to error.traceback = null.
    """
    _patch_command_adapter_event_node("opensandbox.adapters.command_adapter")
    _patch_command_adapter_event_node("opensandbox.sync.adapters.command_adapter")


def _patch_command_adapter_event_node(module_name: str) -> None:
    try:
        module = __import__(module_name, fromlist=["EventNode"])
    except Exception:
        logger.debug(
            "event=opensandbox_traceback_null_compat_patch_skipped module=%s reason=import_failed",
            module_name,
        )
        return

    event_node_cls = getattr(module, "EventNode", None)
    if event_node_cls is None:
        logger.debug(
            "event=opensandbox_traceback_null_compat_patch_skipped module=%s reason=missing_event_node",
            module_name,
        )
        return

    if getattr(module, _PATCH_ATTR, False) or getattr(
        event_node_cls, _PATCH_ATTR, False
    ):
        return

    class _EventNodeCompat(event_node_cls):  # type: ignore[misc, valid-type]
        __doc__ = event_node_cls.__doc__

        def __init__(self, **data: Any):
            error = data.get("error")
            if isinstance(error, dict) and error.get("traceback") is None:
                normalized_error = dict(error)
                normalized_error["traceback"] = []
                data = dict(data)
                data["error"] = normalized_error
            super().__init__(**data)

    _EventNodeCompat.__name__ = event_node_cls.__name__
    _EventNodeCompat.__qualname__ = event_node_cls.__qualname__
    _EventNodeCompat.__module__ = event_node_cls.__module__
    setattr(_EventNodeCompat, _PATCH_ATTR, True)

    setattr(module, "EventNode", _EventNodeCompat)
    setattr(module, _PATCH_ATTR, True)
    logger.info(
        "event=opensandbox_traceback_null_compat_patch_applied module=%s",
        module_name,
    )
