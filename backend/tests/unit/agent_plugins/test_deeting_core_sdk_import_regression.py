from __future__ import annotations

import importlib


def test_core_sdk_plugin_import_has_no_assistant_task_cycle():
    module = importlib.import_module("app.agent_plugins.builtins.deeting_core_sdk.plugin")

    assert hasattr(module, "DeetingCoreSdkPlugin")
