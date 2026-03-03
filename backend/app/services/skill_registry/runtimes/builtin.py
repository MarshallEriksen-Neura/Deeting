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
        
        # Resolve package path
        # Assuming packages/ is at project root
        project_root = Path(settings.PROJECT_ROOT).parent
        
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

        # Execute subprocess
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(main_py),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(package_path)
            )

            stdout, stderr = await process.communicate(input=json.dumps(payload).encode())
            
            if process.returncode != 0:
                return {
                    "status": "error",
                    "error": f"Process exited with {process.returncode}",
                    "stderr": stderr.decode().strip()
                }

            try:
                result = json.loads(stdout.decode())
                return {
                    "status": "ok",
                    "result": result,
                    "stdout": stdout.decode().strip(),
                    "stderr": stderr.decode().strip()
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
