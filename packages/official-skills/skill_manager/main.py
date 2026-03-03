import json
import sys
import os
import subprocess
import asyncio
from pathlib import Path
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

def get_base_dirs():
    """Resolve standard Deeting directories based on platform."""
    import platform
    home = Path.home()
    if platform.system() == "Windows":
        app_data = home / "AppData" / "Roaming" / "com.deeting.app"
    elif platform.system() == "Darwin":
        app_data = home / "Library" / "Application Support" / "com.deeting.app"
    else:
        app_data = home / ".local" / "share" / "com.deeting.app"
    
    # .deeting/repos for clones, com.deeting.app/skills for discovery symlinks
    repos_dir = home / ".deeting" / "repos"
    skills_dir = app_data / "skills"
    
    return repos_dir, skills_dir

async def install_skill_from_git(repo_url: str, skill_name: str) -> Dict[str, Any]:
    """Clones and symlinks a skill."""
    repos_dir, skills_dir = get_base_dirs()
    repos_dir.mkdir(parents=True, exist_ok=True)
    skills_dir.mkdir(parents=True, exist_ok=True)
    
    target_repo_path = repos_dir / skill_name
    link_path = skills_dir / skill_name
    
    print(f"[*] Cloning {repo_url} into {target_repo_path}...", file=sys.stderr)
    
    try:
        # 1. Git Clone
        if target_repo_path.exists():
            # Already exists, try pull
            subprocess.run(["git", "-C", str(target_repo_path), "pull"], check=True)
        else:
            subprocess.run(["git", "clone", repo_url, str(target_repo_path)], check=True)
        
        # 2. Symlink/Junction
        if link_path.exists() or link_path.is_symlink():
            if os.path.islink(link_path) or os.path.isdir(link_path):
                # Remove existing link/dir
                import shutil
                if link_path.is_dir() and not link_path.is_symlink():
                    shutil.rmtree(link_path)
                else:
                    os.remove(link_path)

        print(f"[*] Creating symlink: {link_path} -> {target_repo_path}", file=sys.stderr)
        
        # Cross-platform link creation
        import platform
        if platform.system() == "Windows":
            # On Windows we use Directory Junctions for better compatibility
            subprocess.run(["cmd", "/c", "mklink", "/J", str(link_path), str(target_repo_path)], check=True)
        else:
            os.symlink(target_repo_path, link_path)
            
        # 3. Automatic Refresh
        if deeting:
            print("[*] Triggering index refresh...", file=sys.stderr)
            await deeting.call_tool("refresh_skill_index")
            
        return {
            "status": "success",
            "message": f"Skill '{skill_name}' installed and indexed.",
            "path": str(link_path)
        }
        
    except Exception as e:
        return {"status": "error", "error": str(e)}

async def refresh_skill_index() -> Dict[str, Any]:
    if deeting:
        # This will call the Rust register_local_skills
        return deeting.call_tool("register_local_skills")
    return {"status": "error", "message": "Not running in Deeting environment"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "install_skill_from_git":
            result = await install_skill_from_git(**args)
        elif method == "refresh_skill_index":
            result = await refresh_skill_index()
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
