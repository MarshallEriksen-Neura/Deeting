import logging
from types import SimpleNamespace

import pytest

from app.core.sandbox.opensandbox_compat import apply_traceback_null_compat_patch


def test_apply_traceback_null_compat_patch_for_async_command_adapter():
    import opensandbox.adapters.command_adapter as async_command_adapter

    apply_traceback_null_compat_patch()

    node = async_command_adapter.EventNode(
        **{
            "type": "error",
            "timestamp": 1,
            "error": {
                "ename": "CommandExecError",
                "evalue": "fork/exec /usr/bin/bash: no such file or directory",
                "traceback": None,
            },
        }
    )

    assert node.error is not None
    assert node.error.traceback == []


def test_apply_traceback_null_compat_patch_for_sync_command_adapter():
    import opensandbox.sync.adapters.command_adapter as sync_command_adapter

    apply_traceback_null_compat_patch()

    node = sync_command_adapter.EventNode(
        **{
            "type": "error",
            "timestamp": 1,
            "error": {
                "ename": "CommandExecError",
                "evalue": "fork/exec /usr/bin/bash: no such file or directory",
                "traceback": None,
            },
        }
    )

    assert node.error is not None
    assert node.error.traceback == []


@pytest.mark.asyncio
async def test_kill_sandbox_404_is_idempotent_after_compat_patch(monkeypatch, caplog):
    import opensandbox.adapters.sandboxes_adapter as async_adapter
    from opensandbox.api.lifecycle.api.sandboxes import delete_sandboxes_sandbox_id

    apply_traceback_null_compat_patch()

    async def _fake_asyncio_detailed(*, client, sandbox_id):
        assert client is not None
        assert sandbox_id == "sbox-404"
        return SimpleNamespace(
            status_code=404,
            parsed=SimpleNamespace(message="Sandbox sbox-404 not found."),
        )

    monkeypatch.setattr(
        delete_sandboxes_sandbox_id, "asyncio_detailed", _fake_asyncio_detailed
    )
    caplog.set_level(logging.INFO, logger=async_adapter.__name__)

    class _FakeAdapter:
        async def _get_client(self):
            return object()

    await async_adapter.SandboxesAdapter.kill_sandbox(_FakeAdapter(), "sbox-404")

    assert not any(
        record.levelno >= logging.ERROR and "Failed to terminate sandbox" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_kill_sandbox_non_404_still_raises_after_compat_patch(monkeypatch):
    import opensandbox.adapters.sandboxes_adapter as async_adapter
    from opensandbox.api.lifecycle.api.sandboxes import delete_sandboxes_sandbox_id
    from opensandbox.exceptions import SandboxApiException

    apply_traceback_null_compat_patch()

    async def _fake_asyncio_detailed(*, client, sandbox_id):
        assert client is not None
        assert sandbox_id == "sbox-500"
        return SimpleNamespace(
            status_code=500,
            parsed=SimpleNamespace(message="internal error"),
        )

    monkeypatch.setattr(
        delete_sandboxes_sandbox_id, "asyncio_detailed", _fake_asyncio_detailed
    )

    class _FakeAdapter:
        async def _get_client(self):
            return object()

    with pytest.raises(SandboxApiException) as exc_info:
        await async_adapter.SandboxesAdapter.kill_sandbox(_FakeAdapter(), "sbox-500")

    assert exc_info.value.status_code == 500
