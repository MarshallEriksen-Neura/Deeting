import asyncio
import base64
import json
import logging
import shlex
from typing import Any

from opensandbox.services.command import RunCommandOpts

from app.core.config import settings
from app.models.skill_registry import SkillRegistry
from app.services.code_mode import protocol as code_mode_protocol
from app.services.code_mode.runtime_bridge_token_service import (
    RuntimeBridgeClaims,
    runtime_bridge_token_service,
)
from app.services.runtime import build_runtime_preamble
from app.services.skill_registry.runtimes.base import BaseRuntimeStrategy, RuntimeContext

_MAX_RUNTIME_TOOL_CALLS = 8
_INVOKE_RESULT_MARKER = "__DEETING_PLUGIN_INVOKE_RESULT__"
_REQUIREMENTS_CHECK_COMMAND = "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
_DIRECTORY_CHECK_COMMAND_TEMPLATE = (
    "if [ -d {path} ]; then echo 1; else echo 0; fi"
)
_PYTHON_ENTRYPOINT_COMMAND_TEMPLATE = (
    "PYTHON_BIN=\"$(command -v python3 || command -v python || true)\"; "
    "if [ -z \"$PYTHON_BIN\" ]; then "
    "echo 'python interpreter not found (python3/python)' >&2; "
    "exit 127; "
    "fi; "
    "\"$PYTHON_BIN\" {script_path}"
)
logger = logging.getLogger(__name__)
_PREPARED_REPO_CACHE: set[tuple[str, str, str, str, str]] = set()
_INSTALLED_DEPS_CACHE: set[tuple[str, str, str, str, str, tuple[str, ...], bool]] = set()


class SandboxRuntimeStrategy(BaseRuntimeStrategy):
    """
    Executes skills using the OpenSandbox environment (git clone -> pip install -> run.py).
    """

    async def execute(
        self,
        skill: SkillRegistry,
        inputs: dict[str, Any],
        context: RuntimeContext,
    ) -> dict[str, Any]:
        sandbox_manager = context.sandbox_manager
        if not sandbox_manager:
            raise ValueError("SandboxManager is required for SandboxRuntimeStrategy")

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
        tool_name, tool_arguments = _resolve_tool_invocation(
            skill=skill,
            inputs=inputs,
            context=context,
        )

        session = context.session_id or "default"
        # Use public method for reuse
        sandbox = await sandbox_manager.get_or_create_sandbox(session)
        sandbox_id = sandbox.id

        try:
            workspace_root = f"/workspace/skills/{skill.id}"
            repo_root = f"{workspace_root}/repo"
            await _run_command(sandbox, f"mkdir -p {workspace_root}")
            await _prepare_repo(
                sandbox=sandbox,
                sandbox_id=str(sandbox_id),
                skill_id=str(skill.id),
                repo_url=str(repo_url),
                revision=str(revision),
                subdir=str(subdir or ""),
                repo_root=repo_root,
            )

            install_dir = f"{repo_root}/{subdir}" if subdir else repo_root
            has_requirements = await _has_requirements_txt(
                sandbox, working_directory=install_dir
            )
            await _ensure_dependencies_installed(
                sandbox=sandbox,
                sandbox_id=str(sandbox_id),
                skill_id=str(skill.id),
                repo_url=str(repo_url),
                revision=str(revision),
                subdir=str(subdir or ""),
                dependencies=dependencies,
                has_requirements=has_requirements,
                install_dir=install_dir,
                user_id=(str(context.user_id) if context.user_id is not None else ""),
            )

            runtime_context = {
                "session_id": str(session),
                "user_id": str(context.user_id) if context.user_id is not None else None,
                "intent": context.intent,
                "skill_id": str(skill.id),
            }
            bridge_context = await _issue_runtime_bridge_context(context)
            if bridge_context:
                runtime_context["bridge"] = bridge_context

            script_path = f"{workspace_root}/run.py"
            script = _build_script(
                repo_root=install_dir,
                runtime_context=runtime_context,
                tool_name=tool_name,
                tool_arguments=tool_arguments,
                legacy_example_code=example_code,
            )
            await sandbox.files.write_file(script_path, script)

            execution = await _run_command(
                sandbox,
                _build_python_entrypoint_command(script_path),
                working_directory=workspace_root,
                return_execution=True,
            )
            stdout_raw, stderr_raw = _collect_logs(execution)
            stdout = _strip_runtime_log_lines(stdout_raw)
            stderr = _strip_runtime_log_lines(stderr_raw)
            invoke_result = _extract_invoke_result(stdout_raw, stderr_raw)
            render_blocks = _extract_render_blocks(stdout_raw, stderr_raw)
            execution_error = _extract_execution_error(execution)
            artifact_results = await _collect_artifacts(
                sandbox, artifacts, workspace_root
            )
            response = {
                "status": "ok",
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": 1 if execution_error else 0,
                "artifacts": artifact_results,
            }
            if execution_error:
                response["error"] = execution_error
            if invoke_result is not None:
                response["result"] = invoke_result
            if render_blocks:
                response["render_blocks"] = render_blocks
            return response
        finally:
            if context.kill_on_exit:
                _clear_sandbox_cache(str(sandbox_id))
                await sandbox_manager.stop_sandbox(sandbox_id, session_id=session)
            else:
                await sandbox.close()


async def _run_command(
    sandbox,
    command: str,
    *,
    working_directory: str | None = None,
    return_execution: bool = False,
):
    opts = (
        RunCommandOpts(working_directory=working_directory)
        if working_directory
        else None
    )
    execution = await sandbox.commands.run(command, opts=opts)
    if not return_execution:
        # Check for error if we're not returning the execution object
        if execution.error:
            stderr = [msg.text for msg in getattr(execution.logs, "stderr", [])]
            raise RuntimeError(f"Command failed: {command}\nError: {execution.error}\nStderr: {''.join(stderr)}")
    return execution


async def _has_requirements_txt(sandbox, *, working_directory: str) -> bool:
    execution = await _run_command(
        sandbox,
        _REQUIREMENTS_CHECK_COMMAND,
        working_directory=working_directory,
        return_execution=True,
    )
    stdout, stderr = _collect_logs(execution)
    lines: list[str] = []
    for chunk in [*(stdout or []), *(stderr or [])]:
        lines.extend(str(chunk).splitlines())
    for line in reversed(lines):
        value = str(line).strip()
        if value in {"0", "1"}:
            return value == "1"
    return False


async def _directory_exists(sandbox, path: str) -> bool:
    execution = await _run_command(
        sandbox,
        _DIRECTORY_CHECK_COMMAND_TEMPLATE.format(path=shlex.quote(path)),
        return_execution=True,
    )
    stdout, stderr = _collect_logs(execution)
    lines: list[str] = []
    for chunk in [*(stdout or []), *(stderr or [])]:
        lines.extend(str(chunk).splitlines())
    for line in reversed(lines):
        value = str(line).strip()
        if value in {"0", "1"}:
            return value == "1"
    return False


def _purge_repo_cache(sandbox_id: str, skill_id: str) -> None:
    stale = [k for k in _PREPARED_REPO_CACHE if k[0] == sandbox_id and k[1] == skill_id]
    for key in stale:
        _PREPARED_REPO_CACHE.discard(key)


def _purge_dep_cache(sandbox_id: str, skill_id: str) -> None:
    stale = [k for k in _INSTALLED_DEPS_CACHE if k[0] == sandbox_id and k[1] == skill_id]
    for key in stale:
        _INSTALLED_DEPS_CACHE.discard(key)


def _clear_sandbox_cache(sandbox_id: str) -> None:
    stale_repo = [k for k in _PREPARED_REPO_CACHE if k[0] == sandbox_id]
    for key in stale_repo:
        _PREPARED_REPO_CACHE.discard(key)
    stale_deps = [k for k in _INSTALLED_DEPS_CACHE if k[0] == sandbox_id]
    for key in stale_deps:
        _INSTALLED_DEPS_CACHE.discard(key)


async def _prepare_repo(
    *,
    sandbox,
    sandbox_id: str,
    skill_id: str,
    repo_url: str,
    revision: str,
    subdir: str,
    repo_root: str,
) -> None:
    key = (sandbox_id, skill_id, repo_url, revision, subdir)
    if key in _PREPARED_REPO_CACHE and await _directory_exists(sandbox, repo_root):
        logger.info(
            "event=plugin_repo_prepare_cache_hit skill_id=%s sandbox_id=%s revision=%s",
            skill_id,
            sandbox_id,
            revision,
        )
        return

    _purge_repo_cache(sandbox_id, skill_id)
    _purge_dep_cache(sandbox_id, skill_id)
    await _run_command(sandbox, f"rm -rf {repo_root}")

    clone_success = False
    clone_error = None
    for _attempt in range(3):
        try:
            await _run_command(
                sandbox,
                f"git clone --depth 1 --branch {revision} {repo_url} {repo_root}",
            )
            clone_success = True
            break
        except Exception as exc:
            clone_error = exc
            await asyncio.sleep(1)

    if not clone_success:
        raise RuntimeError(
            f"Failed to clone repository after 3 attempts: {clone_error}"
        )

    _PREPARED_REPO_CACHE.add(key)


async def _ensure_dependencies_installed(
    *,
    sandbox,
    sandbox_id: str,
    skill_id: str,
    repo_url: str,
    revision: str,
    subdir: str,
    dependencies: list[str],
    has_requirements: bool,
    install_dir: str,
    user_id: str,
) -> None:
    dep_signature = tuple(str(item) for item in dependencies)
    key = (
        sandbox_id,
        skill_id,
        repo_url,
        revision,
        subdir,
        dep_signature,
        bool(has_requirements),
    )
    if key in _INSTALLED_DEPS_CACHE:
        logger.info(
            "event=plugin_dependency_install_cache_hit "
            "skill_id=%s sandbox_id=%s requirements=%s deps_count=%s",
            skill_id,
            sandbox_id,
            int(bool(has_requirements)),
            len(dep_signature),
        )
        return

    if dependencies:
        await _run_command(
            sandbox,
            f"pip install {' '.join(dependencies)}",
            working_directory=install_dir,
        )
    if has_requirements:
        await _run_command(
            sandbox,
            "pip install -r requirements.txt",
            working_directory=install_dir,
        )
    elif not dependencies:
        logger.info(
            "event=plugin_dependency_install_skipped "
            "reason=no_manifest_dependencies_and_no_requirements_txt "
            "skill_id=%s user_id=%s install_dir=%s",
            skill_id,
            user_id,
            install_dir,
        )

    _purge_dep_cache(sandbox_id, skill_id)
    _INSTALLED_DEPS_CACHE.add(key)


def _build_script(
    *,
    repo_root: str,
    runtime_context: dict[str, Any],
    tool_name: str,
    tool_arguments: dict[str, Any],
    legacy_example_code: str,
) -> str:
    runtime_context_json = json.dumps(runtime_context or {}, ensure_ascii=False)
    tool_arguments_json = json.dumps(tool_arguments or {}, ensure_ascii=False)
    legacy_code_json = json.dumps(legacy_example_code or "", ensure_ascii=False)
    preamble = build_runtime_preamble(max_tool_calls=_MAX_RUNTIME_TOOL_CALLS)
    script = f"""{preamble}
import asyncio
import importlib.util
import inspect
import json
import os
import sys

RUNTIME_CONTEXT = json.loads({runtime_context_json!r})
REPO_ROOT = {repo_root!r}
TOOL_NAME = {tool_name!r}
TOOL_ARGUMENTS = json.loads({tool_arguments_json!r})
LEGACY_EXAMPLE_CODE = json.loads({legacy_code_json!r})
INVOKE_RESULT_MARKER = {_INVOKE_RESULT_MARKER!r}

deeting = DeetingRuntime(context=RUNTIME_CONTEXT, tool_results=[])

def _read_manifest():
    manifest_path = os.path.join(REPO_ROOT, "deeting.json")
    if not os.path.exists(manifest_path):
        print(f"[DEBUG] deeting.json not found at {{manifest_path}}. Contents of {{REPO_ROOT}}:", os.listdir(REPO_ROOT) if os.path.exists(REPO_ROOT) else "DIR_NOT_FOUND", file=sys.stderr)
        return None
    try:
        with open(manifest_path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
        if not isinstance(data, dict):
            print(f"[DEBUG] deeting.json is not a dict: {{type(data)}}", file=sys.stderr)
            return None
        return data
    except Exception as e:
        print(f"[DEBUG] Error reading deeting.json: {{e}}", file=sys.stderr)
        return None

def _resolve_backend_entry(manifest):
    entry = manifest.get("entry") if isinstance(manifest, dict) else {{}}
    if not isinstance(entry, dict):
        entry = {{}}
    backend = str(entry.get("backend") or "main.py").strip()
    return backend or "main.py"

def _safe_join_backend_path(entry_rel):
    root = os.path.normpath(REPO_ROOT)
    candidate = os.path.normpath(os.path.join(root, str(entry_rel or "main.py")))
    if not (candidate == root or candidate.startswith(root + os.sep)):
        raise RuntimeError("invalid backend entry path")
    return candidate

async def _run_plugin_invoke(manifest):
    backend_entry = _resolve_backend_entry(manifest)
    backend_path = _safe_join_backend_path(backend_entry)
    if not os.path.exists(backend_path):
        raise RuntimeError(f"backend entry not found: {{backend_entry}}")

    spec = importlib.util.spec_from_file_location("deeting_plugin_entry", backend_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load backend module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    invoke_fn = getattr(module, "invoke", None)
    if not callable(invoke_fn):
        raise RuntimeError("plugin backend must define async def invoke(tool_name, args, deeting)")

    result = invoke_fn(TOOL_NAME, TOOL_ARGUMENTS, deeting)
    if inspect.isawaitable(result):
        result = await result

    if isinstance(result, dict):
        render_payload = result.get("__render__")
        if isinstance(render_payload, dict):
            view_type = str(render_payload.get("view_type") or "").strip()
            if view_type:
                metadata = render_payload.get("metadata")
                if metadata is None:
                    metadata = render_payload.get("meta")
                deeting.render(
                    view_type=view_type,
                    payload=render_payload.get("payload") or {{}},
                    title=render_payload.get("title"),
                    metadata=metadata,
                )
    return result

async def _run_legacy_example():
    if not str(LEGACY_EXAMPLE_CODE or "").strip():
        raise RuntimeError("legacy usage_spec.example_code is empty")
    scope = {{
        "ROOT_DIR": REPO_ROOT,
        "INPUTS": TOOL_ARGUMENTS,
        "INTENT": RUNTIME_CONTEXT.get("intent"),
        "RUNTIME_CONTEXT": RUNTIME_CONTEXT,
        "deeting": deeting,
    }}
    wrapper = "async def __wrapped_legacy__():\\n"
    for line in LEGACY_EXAMPLE_CODE.splitlines():
        wrapper += f"    {{line}}\\n"
    wrapper += "    return locals().get('result')\\n"

    exec(wrapper, scope, scope)
    func = scope["__wrapped_legacy__"]
    return await func()

async def _main():
    manifest = _read_manifest()
    if isinstance(manifest, dict):
        invoke_result = await _run_plugin_invoke(manifest)
    else:
        invoke_result = await _run_legacy_example()
    print(INVOKE_RESULT_MARKER + json.dumps(invoke_result, ensure_ascii=False, default=str))

asyncio.run(_main())
"""
    return script


def _collect_logs(execution) -> tuple[list[str], list[str]]:
    stdout = [msg.text for msg in getattr(execution.logs, "stdout", [])]
    stderr = [msg.text for msg in getattr(execution.logs, "stderr", [])]
    return stdout, stderr


def _build_python_entrypoint_command(script_path: str) -> str:
    return _PYTHON_ENTRYPOINT_COMMAND_TEMPLATE.format(
        script_path=shlex.quote(script_path)
    )


def _strip_runtime_log_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []
    for chunk in lines or []:
        text = code_mode_protocol.strip_runtime_signal_lines(chunk)
        for line in str(text).splitlines():
            if line.strip().startswith(_INVOKE_RESULT_MARKER):
                continue
            cleaned.append(line)
    return cleaned


def _extract_execution_error(execution) -> dict[str, Any] | None:
    error = getattr(execution, "error", None)
    if error is None:
        return None
    return {
        "name": getattr(error, "name", None),
        "value": getattr(error, "value", None),
        "traceback": list(getattr(error, "traceback", []) or []),
    }


def _extract_invoke_result(stdout: list[str], stderr: list[str]) -> Any | None:
    for chunks in (stdout or [], stderr or []):
        for line in reversed(chunks):
            raw = str(line or "").strip()
            if not raw.startswith(_INVOKE_RESULT_MARKER):
                continue
            payload = raw[len(_INVOKE_RESULT_MARKER) :].strip()
            if not payload:
                return None
            try:
                return json.loads(payload)
            except Exception:
                return payload
    return None


def _extract_render_blocks(stdout: list[str], stderr: list[str]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for chunk in [*(stdout or []), *(stderr or [])]:
        payloads = code_mode_protocol.extract_runtime_render_payloads_from_text(chunk)
        for payload in payloads:
            view_type = str(payload.get("view_type") or "").strip()
            if not view_type:
                continue
            block: dict[str, Any] = {
                "type": "ui",
                "viewType": view_type,
                "view_type": view_type,
                "payload": payload.get("payload") or {},
            }
            title = payload.get("title")
            if title is not None:
                block["title"] = str(title)
            metadata = payload.get("metadata")
            if metadata is None:
                metadata = payload.get("meta")
            if metadata is not None:
                block["metadata"] = metadata
            blocks.append(block)
    return blocks


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


def _resolve_tool_invocation(
    *,
    skill: SkillRegistry,
    inputs: dict[str, Any],
    context: RuntimeContext,
) -> tuple[str, dict[str, Any]]:
    payload = dict(inputs or {})
    raw_tool_name = payload.pop("__tool_name__", None)
    tool_name = str(raw_tool_name or "").strip()
    if not tool_name:
        tool_name = str(getattr(context, "intent", "") or "").strip()
    if not tool_name:
        tool_name = str(skill.id)
    return tool_name, payload


async def _issue_runtime_bridge_context(context: RuntimeContext) -> dict[str, Any] | None:
    bridge_endpoint = str(getattr(settings, "CODE_MODE_BRIDGE_ENDPOINT", "") or "").strip()
    if not bridge_endpoint:
        return None
    user_id = str(context.user_id or "").strip()
    session_id = str(context.session_id or "").strip()
    if not user_id or not session_id:
        return None

    bridge_timeout = int(
        getattr(settings, "CODE_MODE_BRIDGE_HTTP_TIMEOUT_SECONDS", 120) or 120
    )
    bridge_ttl = int(getattr(settings, "CODE_MODE_BRIDGE_TOKEN_TTL_SECONDS", 600) or 600)
    if bridge_ttl <= 0:
        bridge_ttl = 600

    issue = await runtime_bridge_token_service.issue_token(
        claims=RuntimeBridgeClaims(
            user_id=user_id,
            session_id=session_id,
            trace_id=context.trace_id,
            capability="skill_runtime",
            max_calls=_MAX_RUNTIME_TOOL_CALLS,
        ),
        ttl_seconds=max(bridge_ttl, 60),
    )
    return {
        "endpoint": bridge_endpoint,
        "execution_token": issue.token,
        "timeout_seconds": bridge_timeout,
        "expires_at": issue.expires_at,
        "mode": "http_with_marker_fallback",
    }


def _read_nested(data: dict[str, Any], keys: list[str]) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
