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

logger = logging.getLogger(__name__)

class BuiltinSkillRuntimeStrategy(BaseRuntimeStrategy):
    """
    Executes 'builtin' or 'distilled' skills located in local directories.
    This strategy avoids runtime git pulls by using a local persistent asset pool.
    """

    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        # Skill ID e.g., 'official.skills.crawler'
        skill_id_part = skill.id.split('.')[-1]
        
        # Resolve workspace root
        runtime_file = Path(__file__).resolve()
        project_root = runtime_file.parents[5] # Safest resolution
        
        # Search Paths: Priority order
        search_roots = [
            project_root / "packages" / "official-skills",
            project_root / "packages",
            project_root / "backend" / ".data" / "skills" / "official",
            project_root / "backend" / ".data" / "skills" / "community",
        ]
        
        # Try both underscore and hyphen versions + full ID
        candidates = [
            skill_id_part,
            skill_id_part.replace('_', '-'),
            skill.id,
        ]
        
        package_path = None
        for root in search_roots:
            if not root.exists(): continue
            for name in candidates:
                path = root / name
                if path.exists():
                    package_path = path
                    break
            if package_path: break
            
        if not package_path:
            logger.error(f"Skill package not found for {skill.id}. Searched in: {[str(r) for r in search_roots]}")
            raise ValueError(f"Builtin skill package not found for skill {skill.id}")

        main_py = package_path / "main.py"
        if not main_py.exists():
            raise ValueError(f"Entry point main.py not found in {package_path}")

        # Prepare payload
        tool_name = inputs.get("__tool_name__") or context.intent or skill.id
        payload = {
            "method": tool_name,
            "arguments": {k: v for k, v in inputs.items() if k != "__tool_name__"}
        }

        # Resolve python executable: prefer .venv in project root
        python_exe = sys.executable
        venv_python = project_root / "backend" / ".venv" / "bin" / "python3"
        if venv_python.exists():
            python_exe = str(venv_python)

        # Prepare environment
        env = os.environ.copy()
        env["SCOUT_SERVICE_URL"] = str(settings.SCOUT_SERVICE_URL)
        env["PYTHONPATH"] = os.pathsep.join([
            str(project_root / "packages" / "deeting-sdk"),
            env.get("PYTHONPATH", "")
        ])

        # Execute subprocess
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

            stdout, stderr = await process.communicate(input=json.dumps(payload).encode())
            
            stdout_str = stdout.decode().strip()
            stderr_str = stderr.decode().strip()
            
            if stderr_str:
                logger.warning(f"Builtin skill {skill.id} stderr: {stderr_str}")
            
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

        except Exception as e:
            logger.exception(f"Failed to execute builtin skill {skill.id}")
            return {"status": "error", "error": str(e)}
