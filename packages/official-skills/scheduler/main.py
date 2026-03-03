import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def submit_background_job(**kwargs) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("submit_background_job", **kwargs)
    return {"status": "error", "message": "SDK not found"}

async def check_job_status(job_id: str) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("check_job_status", job_id=job_id)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "submit_background_job":
            result = await submit_background_job(**args)
        elif method == "check_job_status":
            result = await check_job_status(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
