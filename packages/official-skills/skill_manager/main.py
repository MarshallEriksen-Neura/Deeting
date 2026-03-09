import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Sequence

try:
    from deeting import deeting
except ImportError:
    deeting = None

DEFAULT_SKILLS_AGENT = os.environ.get("DEETING_SKILLS_AGENT", "codex").strip() or "codex"
COMMAND_TIMEOUT_SECONDS = int(os.environ.get("DEETING_SKILLS_TIMEOUT", "240"))
GLOBAL_AGENT_SKILL_DIRS = {
    "codex": lambda home: home / ".codex" / "skills",
    "augment": lambda home: home / ".augment" / "skills",
    "openclaw": lambda home: home / ".openclaw" / "skills",
    "universal": lambda home: home / ".config" / "agents" / "skills",
}
SKILL_DISCOVERY_SKIP_PARTS = {".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv"}


def get_base_dirs() -> tuple[Path, Path, Path]:
    """Resolve standard Deeting and managed agent skill directories."""
    import platform

    home = Path.home()
    if platform.system() == "Windows":
        app_data = home / "AppData" / "Roaming" / "com.deeting.app"
    elif platform.system() == "Darwin":
        app_data = home / "Library" / "Application Support" / "com.deeting.app"
    else:
        app_data = home / ".local" / "share" / "com.deeting.app"

    repos_dir = home / ".deeting" / "repos"
    skills_dir = app_data / "skills"
    try:
        agent_skills_dir = GLOBAL_AGENT_SKILL_DIRS[DEFAULT_SKILLS_AGENT](home)
    except KeyError as exc:
        raise RuntimeError(f"unsupported DEETING_SKILLS_AGENT: {DEFAULT_SKILLS_AGENT}") from exc
    return repos_dir, skills_dir, agent_skills_dir


def inspect_skill_environment() -> Dict[str, Any]:
    tools = {}
    for name in ["git", "node", "npx", "python3"]:
        tools[name] = shutil.which(name)
    return {
        "status": "ok",
        "agent": DEFAULT_SKILLS_AGENT,
        "tools": {name: {"available": bool(path), "path": path} for name, path in tools.items()},
    }


def ensure_required_tools(*tool_names: str) -> None:
    missing = [name for name in tool_names if not shutil.which(name)]
    if missing:
        raise RuntimeError(f"missing required tools: {', '.join(missing)}")


def run_command(command: Sequence[str], *, check: bool = True) -> Dict[str, Any]:
    completed = subprocess.run(
        list(command),
        text=True,
        capture_output=True,
        timeout=COMMAND_TIMEOUT_SECONDS,
        check=False,
    )
    result = {
        "command": list(command),
        "returncode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }
    if check and completed.returncode != 0:
        detail = result["stderr"] or result["stdout"] or f"command failed with exit code {completed.returncode}"
        raise RuntimeError(detail)
    return result


def list_agent_skills(skills_dir: Path) -> Dict[str, Path]:
    if not skills_dir.exists():
        return {}
    installed: Dict[str, Path] = {}
    for entry in skills_dir.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_dir() or entry.is_symlink():
            installed[entry.name] = entry
    return installed


def remove_existing_path(path: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    if sys.platform == "win32":
        removed = subprocess.run(["cmd", "/c", "rmdir", str(path)], check=False)
        if removed.returncode == 0:
            return
    shutil.rmtree(path)


def create_directory_link(target: Path, link_path: Path) -> None:
    remove_existing_path(link_path)
    link_path.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link_path), str(target)], check=True)
    else:
        os.symlink(str(target), str(link_path), target_is_directory=True)


def sync_skills_into_deeting(skill_names: list[str] | None = None) -> Dict[str, Any]:
    _, deeting_skills_dir, agent_skills_dir = get_base_dirs()
    agent_skills = list_agent_skills(agent_skills_dir)
    requested = sorted(skill_names or agent_skills.keys())
    linked = []
    missing = []
    deeting_skills_dir.mkdir(parents=True, exist_ok=True)
    for skill_name in requested:
        source = agent_skills.get(skill_name)
        if source is None:
            missing.append(skill_name)
            continue
        real_source = source.resolve() if source.exists() else source
        link_path = deeting_skills_dir / skill_name
        create_directory_link(real_source, link_path)
        linked.append({"skill_name": skill_name, "source_path": str(real_source), "link_path": str(link_path)})
    return {
        "status": "ok",
        "agent": DEFAULT_SKILLS_AGENT,
        "agent_skills_dir": str(agent_skills_dir),
        "deeting_skills_dir": str(deeting_skills_dir),
        "linked": linked,
        "missing": missing,
    }


def parse_skill_names_from_list_output(output: str) -> list[str]:
    skill_names = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.lower().startswith(("available", "listing", "installing", "found")):
            continue
        if line.startswith(("- ", "• ", "* ")):
            line = line[2:].strip()
        if " — " in line:
            line = line.split(" — ", 1)[0].strip()
        elif " - " in line:
            line = line.split(" - ", 1)[0].strip()
        if line and all(ch not in line for ch in "[](){}") and " " not in line:
            skill_names.append(line)
    return sorted(dict.fromkeys(skill_names))


def normalize_git_clone_source(package: str) -> str | None:
    normalized = (package or "").strip()
    if not normalized:
        return None
    if Path(normalized).expanduser().exists():
        return None
    if normalized.startswith("github:"):
        normalized = normalized.split(":", 1)[1].strip()
    if normalized.startswith(("http://", "https://", "git@", "ssh://")):
        return normalized
    parts = [part for part in normalized.strip("/").split("/") if part]
    if len(parts) == 2:
        return f"https://github.com/{parts[0]}/{parts[1]}.git"
    return None


def derive_repo_directory_name(package: str) -> str:
    tail = (package or "").strip().rstrip("/").split("/")[-1]
    tail = tail.removesuffix(".git")
    return (tail or "skill-repo").replace(" ", "-")


def read_skill_name_from_frontmatter(skill_md_path: Path) -> str | None:
    try:
        raw = skill_md_path.read_text(encoding="utf-8")
    except OSError:
        return None
    if not raw.startswith("---"):
        return None
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return None
    for line in parts[1].splitlines():
        stripped = line.strip()
        if stripped.startswith("name:"):
            return stripped.split(":", 1)[1].strip().strip("\"'") or None
    return None


def discover_skill_roots(repo_root: Path) -> Dict[str, Path]:
    discovered: Dict[str, Path] = {}
    for skill_md in sorted(repo_root.rglob("SKILL.md")):
        if any(part in SKILL_DISCOVERY_SKIP_PARTS for part in skill_md.parts):
            continue
        skill_name = read_skill_name_from_frontmatter(skill_md) or skill_md.parent.name
        if skill_name and skill_name not in discovered:
            discovered[skill_name] = skill_md.parent
    return discovered


def clone_repo_to_dir(clone_source: str, target_dir: Path) -> Dict[str, Any]:
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    remove_existing_path(target_dir)
    result = run_command(["git", "clone", "--depth", "1", clone_source, str(target_dir)], check=False)
    if result["returncode"] != 0:
        detail = result["stderr"] or result["stdout"] or "git clone failed"
        raise RuntimeError(detail)
    return result


def link_skills_into_agent(skill_paths: Dict[str, Path]) -> Dict[str, Any]:
    _, _, agent_skills_dir = get_base_dirs()
    agent_skills_dir.mkdir(parents=True, exist_ok=True)
    linked = []
    for skill_name, skill_root in skill_paths.items():
        real_source = skill_root.resolve() if skill_root.exists() else skill_root
        link_path = agent_skills_dir / skill_name
        create_directory_link(real_source, link_path)
        linked.append({"skill_name": skill_name, "source_path": str(real_source), "link_path": str(link_path)})
    return {
        "status": "ok",
        "agent": DEFAULT_SKILLS_AGENT,
        "agent_skills_dir": str(agent_skills_dir),
        "linked": linked,
    }


def build_add_command(package: str, *, skill_names: list[str] | None = None, install_all: bool = False) -> list[str]:
    command = ["npx", "-y", "skills", "add", package, "-g", "-a", DEFAULT_SKILLS_AGENT, "-y"]
    if install_all:
        command.extend(["--skill", "*"])
    for skill_name in skill_names or []:
        command.extend(["--skill", skill_name])
    return command


async def install_skill_from_git_fallback(
    package: str,
    *,
    skill_names: list[str] | None = None,
    install_all: bool = False,
    npx_attempt: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    ensure_required_tools("git")
    clone_source = normalize_git_clone_source(package)
    if clone_source is None:
        return {
            "status": "error",
            "package": package,
            "message": "git fallback only supports repo URLs or owner/repo shorthands",
            "npx_attempt": npx_attempt,
        }

    repos_dir, _, _ = get_base_dirs()
    repos_dir.mkdir(parents=True, exist_ok=True)
    clone_dir = repos_dir / derive_repo_directory_name(clone_source)
    clone_result = clone_repo_to_dir(clone_source, clone_dir)
    discovered = discover_skill_roots(clone_dir)
    available_skills = sorted(discovered.keys())
    if not available_skills:
        return {
            "status": "error",
            "package": package,
            "message": "git fallback cloned the repository but found no SKILL.md-based skills",
            "clone": clone_result,
            "npx_attempt": npx_attempt,
        }

    requested_skill_names = [name.strip() for name in (skill_names or []) if str(name).strip()]
    if install_all:
        selected_names = available_skills
    elif requested_skill_names:
        missing = [name for name in requested_skill_names if name not in discovered]
        if missing:
            return {
                "status": "selection_required",
                "package": package,
                "available_skills": available_skills,
                "missing_skills": missing,
                "message": "Requested skills were not found in the cloned repository.",
                "clone": clone_result,
                "npx_attempt": npx_attempt,
            }
        selected_names = requested_skill_names
    elif len(available_skills) == 1:
        selected_names = available_skills
    else:
        return {
            "status": "selection_required",
            "package": package,
            "available_skills": available_skills,
            "message": "Multiple skills were found in the cloned repository. Provide skill_names or set install_all=true.",
            "clone": clone_result,
            "npx_attempt": npx_attempt,
        }

    selected_paths = {name: discovered[name] for name in selected_names}
    agent_link_result = link_skills_into_agent(selected_paths)
    deeting_link_result = sync_skills_into_deeting(selected_names)
    refresh_result = await refresh_skill_index()
    return {
        "status": "success",
        "package": package,
        "installed_skills": selected_names,
        "install_method": "git_fallback",
        "clone": clone_result,
        "agent_linked": agent_link_result,
        "linked": deeting_link_result,
        "refresh": refresh_result,
        "available_skills": available_skills,
        "npx_attempt": npx_attempt,
    }


async def refresh_skill_index() -> Dict[str, Any]:
    if not deeting:
        return {"status": "skipped", "message": "Not running in Deeting environment"}
    result = deeting.call_tool("register_local_skills")
    return {"status": "ok", "result": result}


async def find_skills(query: str) -> Dict[str, Any]:
    normalized_query = (query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "query is required for non-interactive skill search"}
    ensure_required_tools("node", "npx")
    result = run_command(["npx", "-y", "skills", "find", normalized_query], check=False)
    result["status"] = "ok" if result["returncode"] == 0 else "error"
    result["query"] = normalized_query
    return result


async def add_skill(package: str, skill_names: list[str] | None = None, install_all: bool = False) -> Dict[str, Any]:
    normalized_package = (package or "").strip()
    normalized_skill_names = [name.strip() for name in (skill_names or []) if str(name).strip()]
    if not normalized_package:
        return {"status": "error", "error": "package is required"}

    npx_available = bool(shutil.which("node")) and bool(shutil.which("npx"))
    git_available = bool(shutil.which("git"))
    npx_attempt: Dict[str, Any] | None = None

    if npx_available:
        _, _, agent_skills_dir = get_base_dirs()
        before = set(list_agent_skills(agent_skills_dir).keys())

        if not normalized_skill_names and not install_all:
            preview = run_command(
                ["npx", "-y", "skills", "add", normalized_package, "--list", "-g", "-a", DEFAULT_SKILLS_AGENT],
                check=False,
            )
            if preview["returncode"] == 0:
                discovered = parse_skill_names_from_list_output(preview["stdout"])
                if len(discovered) != 1:
                    return {
                        "status": "selection_required",
                        "package": normalized_package,
                        "available_skills": discovered,
                        "stdout": preview["stdout"],
                        "message": "Multiple skills were detected. Provide skill_names or set install_all=true.",
                    }
                normalized_skill_names = discovered
            else:
                preview["status"] = "error"
                npx_attempt = {"stage": "list", **preview}

        if npx_attempt is None:
            install_result = run_command(
                build_add_command(normalized_package, skill_names=normalized_skill_names, install_all=install_all),
                check=False,
            )
            if install_result["returncode"] == 0:
                after = set(list_agent_skills(agent_skills_dir).keys())
                installed_skills = normalized_skill_names or sorted(after - before) or sorted(after)
                link_result = sync_skills_into_deeting(installed_skills)
                refresh_result = await refresh_skill_index()
                return {
                    "status": "success",
                    "package": normalized_package,
                    "installed_skills": installed_skills,
                    "install_method": "npx",
                    "cli": install_result,
                    "linked": link_result,
                    "refresh": refresh_result,
                }
            install_result["status"] = "error"
            npx_attempt = {"stage": "add", **install_result}

    if git_available:
        return await install_skill_from_git_fallback(
            normalized_package,
            skill_names=normalized_skill_names,
            install_all=install_all,
            npx_attempt=npx_attempt,
        )

    env_status = inspect_skill_environment()
    return {
        "status": "error",
        "package": normalized_package,
        "message": "Neither npx skills nor git fallback is available in the current environment.",
        "environment": env_status,
        "npx_attempt": npx_attempt,
    }


async def check_skill_updates() -> Dict[str, Any]:
    ensure_required_tools("node", "npx")
    result = run_command(["npx", "-y", "skills", "check"], check=False)
    result["status"] = "ok" if result["returncode"] == 0 else "error"
    return result


async def update_skills() -> Dict[str, Any]:
    ensure_required_tools("node", "npx")
    result = run_command(["npx", "-y", "skills", "update"], check=False)
    if result["returncode"] != 0:
        result["status"] = "error"
        return result
    link_result = sync_skills_into_deeting()
    refresh_result = await refresh_skill_index()
    return {"status": "success", "cli": result, "linked": link_result, "refresh": refresh_result}


async def uninstall_skill(skill_name: str) -> Dict[str, Any]:
    normalized_skill = (skill_name or "").strip()
    if not normalized_skill:
        return {"status": "error", "error": "skill_name is required"}
    _, deeting_skills_dir, _ = get_base_dirs()
    remove_result = run_command(
        ["npx", "-y", "skills", "remove", "-g", "-a", DEFAULT_SKILLS_AGENT, "-y", normalized_skill],
        check=False,
    ) if shutil.which("npx") else {"command": [], "returncode": 127, "stdout": "", "stderr": "npx not available"}
    remove_existing_path(deeting_skills_dir / normalized_skill)
    refresh_result = await refresh_skill_index()
    return {
        "status": "success" if remove_result.get("returncode") in (0, 127) else "error",
        "skill_name": normalized_skill,
        "cli": remove_result,
        "refresh": refresh_result,
    }


async def install_skill_from_git(repo_url: str, skill_name: str) -> Dict[str, Any]:
    return await add_skill(package=repo_url, skill_names=[skill_name])


async def handle_input() -> None:
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}

        if method == "find_skills":
            result = await find_skills(**args)
        elif method == "add_skill":
            result = await add_skill(**args)
        elif method == "check_skill_updates":
            result = await check_skill_updates()
        elif method == "update_skills":
            result = await update_skills()
        elif method == "refresh_skill_index":
            result = await refresh_skill_index()
        elif method == "inspect_skill_environment":
            result = inspect_skill_environment()
        elif method == "uninstall_skill":
            result = await uninstall_skill(**args)
        elif method == "install_skill_from_git":
            result = await install_skill_from_git(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))


if __name__ == "__main__":
    asyncio.run(handle_input())
