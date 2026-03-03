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
    Executes 'builtin' skills located in the packages/ directory.
    These run in a local subprocess rather than a full sandbox for performance,
    as they are trusted system components.
    """

    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        # Skill ID e.g., 'official.skills.crawler'
        # Directory name might be the last part
        skill_id_part = skill.id.split('.')[-1]
        
        # Resolve workspace root by scanning parent dirs for packages/.
        runtime_file = Path(__file__).resolve()
        project_root = runtime_file.parent.parent.parent.parent.parent
        for parent in runtime_file.parents:
            if (parent / "packages" / "official-skills").exists() or (
                parent / "packages"
            ).exists():
                project_root = parent
                break
        
        # Try both underscore and hyphen versions
        candidates = [
            skill_id_part,
            skill_id_part.replace('_', '-'),
        ]
        
        package_path = None
        for name in candidates:
            path = project_root / "packages" / "official-skills" / name
            if path.exists():
                package_path = path
                break
            
            # Fallback to check if it's directly under packages/
            path = project_root / "packages" / name
            if path.exists():
                package_path = path
                break
            
        if not package_path:
            raise ValueError(f"Builtin skill package not found for skill {skill.id} (searched in packages/official-skills/ and packages/)")

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
        if not venv_python.exists():
            # Try without 'backend' prefix if running in a different structure
            venv_python = project_root / ".venv" / "bin" / "python3"
            
        if venv_python.exists():
            python_exe = str(venv_python)
            logger.info(f"Using VENV python: {python_exe}")

        # Prepare environment
        env = os.environ.copy()
        env["SCOUT_SERVICE_URL"] = str(settings.SCOUT_SERVICE_URL)
        # Add project root to PYTHONPATH so 'deeting' SDK can be found if needed
        env["PYTHONPATH"] = os.pathsep.join([
            str(project_root / "packages" / "deeting-sdk"),
            env.get("PYTHONPATH", "")
        ])

        # Execute subprocess
        logger.info(f"Executing builtin skill {skill.id} at {main_py} via {python_exe} with env SCOUT_SERVICE_URL={env.get('SCOUT_SERVICE_URL')}")
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
                logger.error(f"Builtin skill {skill.id} failed with exit code {process.returncode}. Stdout: {stdout_str}")
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
                    "result": stdout.decode().strip(),
                    "stderr": stderr.decode().strip()
                }

        except Exception as e:
            logger.exception(f"Failed to execute builtin skill {skill.id}")
            return {"status": "error", "error": str(e)}
