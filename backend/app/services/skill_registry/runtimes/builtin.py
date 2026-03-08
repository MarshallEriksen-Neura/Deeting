import json
import logging
import asyncio
import os
import sys
from typing import Any
from pathlib import Path

from app.core.config import settings
from app.models.skill_registry import SkillRegistry
from app.services.skill_registry.runtimes.base import BaseRuntimeStrategy, RuntimeContext
from app.services.code_mode import protocol as code_mode_protocol

logger = logging.getLogger(__name__)

class BuiltinSkillRuntimeStrategy(BaseRuntimeStrategy):
    """
    Executes 'builtin' or 'distilled' skills located in local directories.
    Marker-based host tool execution is intentionally disabled in the
    cloud runtime for security reasons. If a skill emits a Deeting SDK
    tool-call marker, execution is rejected with an explicit error.
    """

    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        skill_id_part = skill.id.split('.')[-1]

        runtime_file = Path(__file__).resolve()
        project_root = runtime_file.parents[5]

        search_roots = [
            project_root / "packages" / "official-skills",
            project_root / "packages",
            project_root / "backend" / ".data" / "skills" / "official",
            project_root / "backend" / ".data" / "skills" / "community",
        ]

        candidates = [
            skill_id_part,
            skill_id_part.replace('_', '-'),
            skill.id,
        ]

        package_path = None
        for root in search_roots:
            if not root.exists():
                continue
            for name in candidates:
                path = root / name
                if path.exists():
                    package_path = path
                    break
            if package_path:
                break

        if not package_path:
            logger.error(f"Skill package not found for {skill.id}. Searched in: {[str(r) for r in search_roots]}")
            raise ValueError(f"Builtin skill package not found for skill {skill.id}")

        main_py = package_path / "main.py"
        if not main_py.exists():
            raise ValueError(f"Entry point main.py not found in {package_path}")

        tool_name = inputs.get("__tool_name__") or context.intent or skill.id
        payload = {
            "method": tool_name,
            "arguments": {k: v for k, v in inputs.items() if k != "__tool_name__"}
        }

        python_exe = sys.executable
        venv_python = project_root / "backend" / ".venv" / "bin" / "python3"
        if venv_python.exists():
            python_exe = str(venv_python)

        base_env = os.environ.copy()
        base_env["SCOUT_SERVICE_URL"] = str(settings.SCOUT_SERVICE_URL)
        base_env["PYTHONPATH"] = os.pathsep.join([
            str(project_root / "packages" / "deeting-sdk"),
            base_env.get("PYTHONPATH", "")
        ])

        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        timeout_seconds = (
            manifest.get("execution", {}).get("timeout_seconds") or 60
        )

        env = dict(base_env)

        try:
            process = await asyncio.create_subprocess_exec(
                python_exe,
                str(main_py),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(package_path),
                env=env
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=json.dumps(payload).encode()),
                    timeout=timeout_seconds,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                return {
                    "status": "error",
                    "error": f"Skill execution timed out after {timeout_seconds}s",
                }

            stdout_str = stdout.decode().strip()
            stderr_str = stderr.decode().strip()

            if stderr_str:
                logger.warning(f"Builtin skill {skill.id} stderr: {stderr_str}")

            marker_req = _extract_tool_call_marker(stdout_str)
            if marker_req is not None:
                requested_tool = marker_req.get("tool_name", "")

                if not requested_tool:
                    return {"status": "error", "error": "skill requested tool call with empty tool_name"}

                logger.warning(
                    "Rejected marker-based host tool execution for skill %s tool %s",
                    skill.id,
                    requested_tool,
                )
                return {
                    "status": "error",
                    "error": (
                        "marker-based host tool execution is disabled in cloud runtime "
                        f"for security reasons (requested tool: {requested_tool})"
                    ),
                }

            if process.returncode != 0:
                return {
                    "status": "error",
                    "error": f"Process exited with {process.returncode}",
                    "stderr": stderr_str
                }

            try:
                result = json.loads(stdout_str)
                return {
                    "status": "ok",
                    "result": result,
                    "stdout": stdout_str,
                    "stderr": stderr_str
                }
            except json.JSONDecodeError:
                return {
                    "status": "ok",
                    "result": stdout_str,
                    "stderr": stderr_str
                }

        except asyncio.TimeoutError:
            return {"status": "error", "error": f"Skill execution timed out after {timeout_seconds}s"}
        except Exception as e:
            logger.exception(f"Failed to execute builtin skill {skill.id}")
            return {"status": "error", "error": str(e)}


def _extract_tool_call_marker(stdout: str) -> dict[str, Any] | None:
    marker = code_mode_protocol.RUNTIME_TOOL_CALL_MARKER
    for line in reversed(stdout.splitlines()):
        trimmed = line.strip()
        if trimmed.startswith(marker):
            json_str = trimmed[len(marker):].strip()
            if not json_str:
                return {}
            try:
                return json.loads(json_str)
            except Exception:
                return {}
    return None
