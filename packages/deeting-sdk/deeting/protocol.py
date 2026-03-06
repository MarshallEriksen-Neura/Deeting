"""
Deeting SDK protocol constants.

Single source of truth: packages/code-mode-contract/contract.json
This module loads the contract at import time and exports the markers/headers
used by both the SDK (Python skill side) and the host (Rust/Python host side).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_CONTRACT_PATH_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "code-mode-contract" / "contract.json",
    Path(__file__).resolve().parents[3] / "packages" / "code-mode-contract" / "contract.json",
]


def _load_contract() -> dict[str, Any]:
    for candidate in _CONTRACT_PATH_CANDIDATES:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                pass
    return {}


_CONTRACT = _load_contract()
_MARKERS: dict[str, Any] = _CONTRACT.get("markers") if isinstance(_CONTRACT.get("markers"), dict) else {}
_HEADERS: dict[str, Any] = _CONTRACT.get("headers") if isinstance(_CONTRACT.get("headers"), dict) else {}

RUNTIME_PROTOCOL_VERSION: str = str(_CONTRACT.get("runtime_protocol_version") or "v1")

TOOL_CALL_MARKER: str = str(
    _MARKERS.get("runtime_tool_call") or "__DEETING_TOOL_CALL_REQUEST__"
)
RENDER_BLOCK_MARKER: str = str(
    _MARKERS.get("runtime_render_block") or "__DEETING_RENDER_BLOCK__"
)
EXECUTION_TOKEN_HEADER: str = str(
    _HEADERS.get("execution_token") or "X-Code-Mode-Execution-Token"
)
