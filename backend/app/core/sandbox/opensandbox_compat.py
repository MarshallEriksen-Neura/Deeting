from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_PATCH_ATTR = "_deeting_traceback_null_compat_patched"
_KILL_SANDBOX_PATCH_ATTR = "_deeting_kill_sandbox_not_found_compat_patched"


def apply_traceback_null_compat_patch() -> None:
    """
    Apply runtime compatibility patches for OpenSandbox SDK.

    1) Make SSE parser tolerant to `error.traceback = null`.
    2) Treat `kill_sandbox(404 SANDBOX_NOT_FOUND)` as idempotent success.
    """
    _patch_command_adapter_event_node("opensandbox.adapters.command_adapter")
    _patch_command_adapter_event_node("opensandbox.sync.adapters.command_adapter")
    _patch_kill_sandbox_not_found(
        "opensandbox.adapters.sandboxes_adapter",
        "SandboxesAdapter",
        is_async=True,
    )
    _patch_kill_sandbox_not_found(
        "opensandbox.sync.adapters.sandboxes_adapter",
        "SandboxesAdapterSync",
        is_async=False,
    )


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


def _patch_kill_sandbox_not_found(
    module_name: str, class_name: str, *, is_async: bool
) -> None:
    try:
        module = __import__(module_name, fromlist=[class_name])
    except Exception:
        logger.debug(
            "event=opensandbox_kill_sandbox_not_found_compat_patch_skipped module=%s reason=import_failed",
            module_name,
        )
        return

    adapter_cls = getattr(module, class_name, None)
    if adapter_cls is None:
        logger.debug(
            "event=opensandbox_kill_sandbox_not_found_compat_patch_skipped module=%s reason=missing_adapter_class",
            module_name,
        )
        return

    original_kill = getattr(adapter_cls, "kill_sandbox", None)
    if not callable(original_kill):
        logger.debug(
            "event=opensandbox_kill_sandbox_not_found_compat_patch_skipped module=%s reason=missing_kill_method",
            module_name,
        )
        return

    if getattr(adapter_cls, _KILL_SANDBOX_PATCH_ATTR, False) or getattr(
        original_kill, _KILL_SANDBOX_PATCH_ATTR, False
    ):
        return

    sdk_logger = getattr(module, "logger", logger)
    exception_converter = getattr(module, "ExceptionConverter", None)
    handle_api_error = getattr(module, "handle_api_error", None)
    if exception_converter is None or handle_api_error is None:
        logger.debug(
            "event=opensandbox_kill_sandbox_not_found_compat_patch_skipped module=%s reason=missing_dependencies",
            module_name,
        )
        return

    if is_async:

        async def _kill_sandbox_compat(self, sandbox_id: str) -> None:
            sdk_logger.info("Terminating sandbox: %s", sandbox_id)
            try:
                from opensandbox.api.lifecycle.api.sandboxes import (
                    delete_sandboxes_sandbox_id,
                )

                client = await self._get_client()
                response_obj = await delete_sandboxes_sandbox_id.asyncio_detailed(
                    client=client,
                    sandbox_id=sandbox_id,
                )
                handle_api_error(response_obj, f"Kill sandbox {sandbox_id}")
                sdk_logger.info("Successfully terminated sandbox: %s", sandbox_id)
            except Exception as exc:
                converted = exception_converter.to_sandbox_exception(exc)
                if _is_sandbox_not_found_error(converted):
                    sdk_logger.info(
                        "Sandbox already gone, treating kill as success: %s",
                        sandbox_id,
                    )
                    return
                sdk_logger.error("Failed to terminate sandbox: %s", sandbox_id, exc_info=exc)
                raise converted from exc

        patched_kill = _kill_sandbox_compat
    else:

        def _kill_sandbox_compat(self, sandbox_id: str) -> None:
            sdk_logger.info("Terminating sandbox: %s", sandbox_id)
            try:
                from opensandbox.api.lifecycle.api.sandboxes import (
                    delete_sandboxes_sandbox_id,
                )

                response_obj = delete_sandboxes_sandbox_id.sync_detailed(
                    client=self._get_client(),
                    sandbox_id=sandbox_id,
                )
                handle_api_error(response_obj, f"Kill sandbox {sandbox_id}")
                sdk_logger.info("Successfully terminated sandbox: %s", sandbox_id)
            except Exception as exc:
                converted = exception_converter.to_sandbox_exception(exc)
                if _is_sandbox_not_found_error(converted):
                    sdk_logger.info(
                        "Sandbox already gone, treating kill as success: %s",
                        sandbox_id,
                    )
                    return
                sdk_logger.error("Failed to kill sandbox: %s", sandbox_id, exc_info=exc)
                raise converted from exc

        patched_kill = _kill_sandbox_compat

    patched_kill.__name__ = getattr(original_kill, "__name__", "kill_sandbox")
    patched_kill.__qualname__ = getattr(
        original_kill, "__qualname__", f"{class_name}.kill_sandbox"
    )
    patched_kill.__module__ = getattr(original_kill, "__module__", module_name)
    setattr(patched_kill, _KILL_SANDBOX_PATCH_ATTR, True)

    setattr(adapter_cls, "kill_sandbox", patched_kill)
    setattr(adapter_cls, _KILL_SANDBOX_PATCH_ATTR, True)
    logger.info(
        "event=opensandbox_kill_sandbox_not_found_compat_patch_applied module=%s class=%s",
        module_name,
        class_name,
    )


def _is_sandbox_not_found_error(exc: BaseException) -> bool:
    for item in _iter_exception_chain(exc):
        status_code = getattr(item, "status_code", None)
        if status_code == 404:
            return True

        error = getattr(item, "error", None)
        error_code = str(getattr(error, "code", "") or "").upper()
        if "SANDBOX_NOT_FOUND" in error_code:
            return True

        message = str(item).lower()
        if "sandbox" in message and "not found" in message:
            return True

    return False


def _iter_exception_chain(exc: BaseException):
    seen: set[int] = set()
    current: BaseException | None = exc
    while current and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__
