"""
Deeting Skill Creator — creates new skills with the docs-first Deeting structure:
  SKILL.md      (primary AI-facing instructions)
  deeting.json  (manifest, runtime, permissions, UI/backend entrypoints)
  main.py       (stdin/stdout Python entry point)
  llm-tool.yaml (optional host tool contract when still needed)
"""

import json
import sys
import os
import platform
import re
from pathlib import Path
from typing import Any


OFFICIAL_SKILLS_PATH = os.environ.get(
    "DEETING_OFFICIAL_SKILLS",
    "/data/Deeting/packages/official-skills",
)

SKILL_ID_RE = re.compile(r"^[a-z][a-z0-9._-]*$")


def _get_skills_dir() -> Path:
    home = Path.home()
    if platform.system() == "Windows":
        app_data = home / "AppData" / "Roaming" / "com.deeting.app"
    elif platform.system() == "Darwin":
        app_data = home / "Library" / "Application Support" / "com.deeting.app"
    else:
        app_data = home / ".local" / "share" / "com.deeting.app"
    return app_data / "skills"


def _make_deeting_json(
    skill_id: str,
    name: str,
    description: str,
    permissions: list[str] | None = None,
    runtime: list[str] | None = None,
    timeout_seconds: int = 60,
) -> dict:
    return {
        "$schema": "https://deeting.com/schemas/deeting-manifest.json",
        "id": skill_id,
        "name": name,
        "version": "0.1.0",
        "author": "community",
        "description": description,
        "entry": {"backend": "main.py"},
        "permissions": permissions or [],
        "runtime": runtime or ["local"],
        "execution": {"timeout_seconds": timeout_seconds},
        "capabilities": {"llm_tools": "llm-tool.yaml"},
    }


def _make_llm_tool_yaml(
    tool_name: str,
    tool_description: str,
    tool_parameters: dict | None = None,
) -> str:
    import yaml  # safe — bundled with most Python installs; fallback below

    params = tool_parameters or {
        "type": "object",
        "properties": {
            "input": {"type": "string", "description": "Primary input value."}
        },
        "required": ["input"],
    }

    doc = {"tools": [{"name": tool_name, "description": tool_description, "parameters": params}]}
    return yaml.dump(doc, default_flow_style=False, sort_keys=False, allow_unicode=True)


def _make_main_py(tool_name: str) -> str:
    return f'''"""Auto-generated Deeting skill entry point."""

import json
import sys
from typing import Any


def {tool_name}(**kwargs: Any) -> dict:
    """TODO: implement {tool_name} logic here."""
    return {{"status": "ok", "echo": kwargs}}


def handle_input() -> None:
    raw = sys.stdin.read()
    if not raw:
        return
    data = json.loads(raw)
    method = data.get("method") or data.get("tool")
    args = data.get("arguments") or data.get("params") or {{}}

    if method == "{tool_name}":
        result = {tool_name}(**args)
    else:
        result = {{"error": f"Unknown method: {{method}}"}}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    handle_input()
'''


def _make_skill_md(
    skill_id: str,
    name: str,
    description: str,
    tool_name: str,
    tool_description: str,
) -> str:
    return f'''---
name: {skill_id}
description: "{description}"
---

# {name}

## Overview

{description}

## Core Capability

- `{tool_name}`: {tool_description}

## Usage Guidelines

- Start by reading this file before calling any host-specific tool interface.
- Keep `deeting.json` focused on metadata/runtime/UI entrypoints.
- Keep `llm-tool.yaml` only when a host integration still requires an explicit tool schema.
'''


def create_deeting_skill(
    skill_id: str,
    name: str,
    description: str,
    tool_name: str,
    tool_description: str,
    tool_parameters: dict | None = None,
    main_py_code: str | None = None,
    permissions: list[str] | None = None,
    runtime: list[str] | None = None,
    timeout_seconds: int = 60,
) -> dict[str, Any]:
    if not SKILL_ID_RE.match(skill_id):
        return {
            "error": f"Invalid skill_id '{skill_id}'. Must match ^[a-z][a-z0-9._-]*$"
        }

    skills_dir = _get_skills_dir()
    skill_dir = skills_dir / skill_id
    skill_dir.mkdir(parents=True, exist_ok=True)

    manifest = _make_deeting_json(
        skill_id, name, description, permissions, runtime, timeout_seconds
    )
    (skill_dir / "deeting.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    (skill_dir / "SKILL.md").write_text(
        _make_skill_md(skill_id, name, description, tool_name, tool_description),
        encoding="utf-8",
    )

    try:
        llm_yaml = _make_llm_tool_yaml(tool_name, tool_description, tool_parameters)
    except ImportError:
        lines = [
            "tools:",
            f"  - name: {tool_name}",
            f'    description: "{tool_description}"',
            "    parameters:",
            "      type: object",
            "      properties:",
            '        input: { type: string, description: "Primary input." }',
            '      required: ["input"]',
        ]
        llm_yaml = "\n".join(lines) + "\n"

    (skill_dir / "llm-tool.yaml").write_text(llm_yaml, encoding="utf-8")

    py_content = main_py_code if main_py_code else _make_main_py(tool_name)
    (skill_dir / "main.py").write_text(py_content, encoding="utf-8")

    return {
        "status": "success",
        "skill_id": skill_id,
        "path": str(skill_dir),
        "files": ["SKILL.md", "deeting.json", "llm-tool.yaml", "main.py"],
        "hint": "Call refresh_skill_index or register_local_skills to make this skill available.",
    }


def list_official_skills() -> dict[str, Any]:
    skills: list[dict] = []
    base = Path(OFFICIAL_SKILLS_PATH)
    if not base.exists():
        return {"error": f"Path not found: {OFFICIAL_SKILLS_PATH}"}

    for item in sorted(os.listdir(base)):
        item_path = base / item
        if item_path.is_dir() and (item_path / "deeting.json").exists():
            try:
                manifest = json.loads((item_path / "deeting.json").read_text(encoding="utf-8"))
            except Exception:
                manifest = {}
            skills.append({
                "id": manifest.get("id", item),
                "name": manifest.get("name", item),
                "description": manifest.get("description", ""),
                "path": str(item_path),
            })
    return {"skills": skills}


def handle_input() -> None:
    try:
        raw = sys.stdin.read()
        if not raw:
            return
        data = json.loads(raw)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}

        if method == "create_deeting_skill":
            result = create_deeting_skill(**args)
        elif method == "list_official_skills":
            result = list_official_skills()
        elif method == "create_skill_md":
            result = create_deeting_skill(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    handle_input()
