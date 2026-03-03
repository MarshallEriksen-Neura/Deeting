import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def generate_image(prompt: str, size: str = "1024x1024") -> Dict[str, Any]:
    if deeting:
        # System provides image generation capability
        return deeting.call_tool("sys_generate_image", prompt=prompt, size=size)
    else:
        return {"status": "error", "message": "Deeting SDK not found. Cannot generate image."}

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "generate_image":
            result = await generate_image(**args)
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"Unknown method: {method}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
