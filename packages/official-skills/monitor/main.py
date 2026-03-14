import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def sys_create_monitor(**kwargs) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("monitor.create", **kwargs)
    return {"status": "error", "message": "SDK not found"}

async def sys_list_monitors() -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("monitor.list")
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "sys_create_monitor":
            result = await sys_create_monitor(**args)
        elif method == "sys_list_monitors":
            result = await sys_list_monitors()
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
