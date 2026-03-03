import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def consult_expert_network(intent_query: str, k: int = 3, confidence: float = 1.0) -> Dict[str, Any]:
    if deeting:
        # Expert network uses the system's SDK search/discovery
        return deeting.call_tool("search_sdk", query=intent_query)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "consult_expert_network":
            result = await consult_expert_network(**args)
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"Unknown method: {method}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
