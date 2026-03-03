import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def get_unified_schema(capability: str) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("get_unified_schema", capability=capability)
    return {"status": "error", "message": "SDK not found"}

async def verify_provider_template(**kwargs) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("verify_provider_template", **kwargs)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "get_unified_schema":
            result = await get_unified_schema(**args)
        elif method == "verify_provider_template":
            result = await verify_provider_template(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
