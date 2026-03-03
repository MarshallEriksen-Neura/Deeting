import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def list_provider_presets() -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("list_provider_presets")
    return {"status": "error", "message": "SDK not found"}

async def create_provider_preset(**kwargs) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("create_provider_preset", **kwargs)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "list_provider_presets":
            result = await list_provider_presets()
        elif method == "create_provider_preset":
            result = await create_provider_preset(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
