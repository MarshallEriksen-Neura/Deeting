from __future__ import annotations

import base64
from typing import Any

from opensandbox.services.command import RunCommandOpts

from app.core.sandbox.manager import sandbox_manager
from app.repositories.skill_registry_repository import SkillRegistryRepository


class SkillRuntimeExecutor:
    def __init__(
        self,
        repo: SkillRegistryRepository,
        sandbox_manager=sandbox_manager,
    ):
        self.repo = repo
        self.sandbox_manager = sandbox_manager

    async def execute(
        self,
        skill_id: str,
        *,
        session_id: str | None,
        inputs: dict[str, Any],
        intent: str | None,
    ) -> dict[str, Any]:
        skill = await self.repo.get_by_id(skill_id)
        if not skill:
            raise ValueError("Skill not found")

        manifest = skill.manifest_json if isinstance(skill.manifest_json, dict) else {}
        repo_url = skill.source_repo or _read_nested(manifest, ["source", "repo"])
        if not repo_url:
            raise ValueError("Skill source repo missing")
        revision = (
            skill.source_revision
            or _read_nested(manifest, ["source", "revision"])
            or "main"
        )
        subdir = skill.source_subdir or _read_nested(manifest, ["source", "sub_dir"])
        dependencies = _normalize_list(
            _read_nested(manifest, ["installation", "dependencies"])
        )
        example_code = _read_nested(manifest, ["usage_spec", "example_code"]) or ""
        artifacts = _normalize_artifacts(manifest.get("artifacts"))

        session = session_id or "default"
        sandbox = await self.sandbox_manager._create_sandbox(session)
        try:
            workspace_root = f"/workspace/skills/{skill_id}"
            repo_root = f"{workspace_root}/repo"
            await _run_command(sandbox, f"mkdir -p {workspace_root}")
            await _run_command(
                sandbox,
                f"git clone --depth 1 --branch {revision} {repo_url} {repo_root}",
            )
            install_dir = f"{repo_root}/{subdir}" if subdir else repo_root
            if dependencies:
                await _run_command(
                    sandbox,
                    f"pip install {' '.join(dependencies)}",
                    working_directory=install_dir,
                )

            script_path = f"{workspace_root}/run.py"
            script = _build_script(example_code, inputs, intent, workspace_root)
            await sandbox.files.write_file(script_path, script)

            execution = await _run_command(
                sandbox,
                f"python {script_path}",
                working_directory=workspace_root,
                return_execution=True,
            )
            stdout, stderr = _collect_logs(execution)
            artifact_results = await _collect_artifacts(
                sandbox, artifacts, workspace_root
            )
            return {
                "status": "ok",
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": 0,
                "artifacts": artifact_results,
            }
        finally:
            await sandbox.close()


async def _run_command(
    sandbox,
    command: str,
    *,
    working_directory: str | None = None,
    return_execution: bool = False,
):
    opts = RunCommandOpts(working_directory=working_directory) if working_directory else None
    execution = await sandbox.commands.run(command, opts=opts)
    if return_execution:
        return execution
    return None


def _build_script(
    example_code: str,
    inputs: dict[str, Any],
    intent: str | None,
    root_dir: str,
) -> str:
    header = [
        f"ROOT_DIR = {root_dir!r}",
        f"INPUTS = {inputs!r}",
        f"INTENT = {intent!r}",
        "",
    ]
    return "\n".join(header) + example_code


def _collect_logs(execution) -> tuple[list[str], list[str]]:
    stdout = [msg.text for msg in getattr(execution.logs, "stdout", [])]
    stderr = [msg.text for msg in getattr(execution.logs, "stderr", [])]
    return stdout, stderr


async def _collect_artifacts(
    sandbox,
    artifacts: list[dict[str, Any]],
    workspace_root: str,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for artifact in artifacts:
        name = artifact.get("name") or artifact.get("path") or "artifact"
        path = artifact.get("path") or name
        if not path.startswith("/"):
            path = f"{workspace_root}/{path}"
        data = await sandbox.files.read_bytes(path)
        results.append(
            {
                "name": name,
                "type": artifact.get("type") or "file",
                "path": path,
                "size": len(data),
                "content_base64": base64.b64encode(data).decode("utf-8"),
            }
        )
    return results


def _normalize_artifacts(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [item if isinstance(item, dict) else {"name": str(item)} for item in raw]
    if isinstance(raw, dict):
        return [raw]
    return [{"name": str(raw)}]


def _normalize_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple, set)):
        return [str(item) for item in raw if item is not None]
    return [str(raw)]


def _read_nested(data: dict[str, Any], keys: list[str]) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
