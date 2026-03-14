import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def add_knowledge_chunk(content: str, metadata: dict = None) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("memory.append", content=content, metadata=metadata)
    return {"status": "error", "message": "SDK not found"}

async def search_knowledge(query: str, scope: str = "all", limit: int = 5) -> Dict[str, Any]:
    if deeting:
        return deeting.call_tool("memory.search", query=query, limit=limit, scope=scope)
    return {"status": "error", "message": "SDK not found"}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "add_knowledge_chunk":
            result = await add_knowledge_chunk(**args)
        elif method == "search_knowledge":
            result = await search_knowledge(**args)
        else:
            result = {"error": f"Unknown method: {method}"}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
