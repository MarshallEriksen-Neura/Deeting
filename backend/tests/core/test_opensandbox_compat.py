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
