from __future__ import annotations

import importlib


def test_notification_service_import_has_no_task_cycle():
    module = importlib.import_module("app.services.notifications.notification_service")

    assert hasattr(module, "NotificationService")
