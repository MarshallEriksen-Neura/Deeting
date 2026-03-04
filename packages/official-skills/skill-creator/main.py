import json
import sys
import os
from pathlib import Path
from typing import Dict, Any

OFFICIAL_SKILLS_PATH = "/data/Deeting/packages/official-skills"

def list_official_skills() -> Dict[str, Any]:
    skills = []
    if not os.path.exists(OFFICIAL_SKILLS_PATH):
        return {"error": f"Path not found: {OFFICIAL_SKILLS_PATH}"}
    
    for item in os.listdir(OFFICIAL_SKILLS_PATH):
        item_path = Path(OFFICIAL_SKILLS_PATH) / item
        if item_path.is_dir() and (item_path / "deeting.json").exists():
            has_skill_md = (item_path / "SKILL.md").exists()
            skills.append({
                "name": item,
                "path": str(item_path),
                "has_skill_md": has_skill_md
            })
    return {"skills": skills}

def create_skill_md(skill_path: str, content: str) -> Dict[str, Any]:
    try:
        path = Path(skill_path)
        if not path.exists() or not path.is_dir():
            return {"error": f"Invalid skill path: {skill_path}"}
        
        skill_md_path = path / "SKILL.md"
        with open(skill_md_path, "w", encoding="utf-8") as f:
            f.write(content)
        
        return {
            "status": "success",
            "message": f"SKILL.md created/updated at {skill_md_path}",
            "path": str(skill_md_path)
        }
    except Exception as e:
        return {"error": str(e)}

def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "list_official_skills":
            result = list_official_skills()
        elif method == "create_skill_md":
            result = create_skill_md(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    handle_input()
