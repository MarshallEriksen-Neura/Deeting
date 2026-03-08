from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_deeting_core_sdk_plugin_imports_without_circular_import():
    backend_dir = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.agent_plugins.builtins.deeting_core_sdk.plugin",
        ],
        cwd=backend_dir,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
