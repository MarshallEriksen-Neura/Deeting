import json
import sys
import asyncio
from typing import Dict, Any, Optional

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def ingest_assistant_from_url(url: str, instruction: str = "") -> Dict[str, Any]:
    """Analyze a URL on desktop, then persist the result through the cloud admin API."""
    if not deeting:
        return {"status": "error", "message": "Deeting SDK not available"}

    print(f"[*] Analyzing source: {url}...", file=sys.stderr)
    
    crawl_result = await deeting.call_tool("web.fetch", url=url)
    if not crawl_result or crawl_result.get("status") == "error":
        return {"status": "error", "message": f"Crawl failed: {crawl_result.get('error')}"}

    content = crawl_result.get("markdown", "")[:15000]

    print("[*] Submitting assistant ingest result to cloud admin persistence...", file=sys.stderr)
    submit_res = await deeting.call_tool(
        "cloud.assistant_ingest.submit",
        source_url=url,
        content_excerpt=content,
        instruction=instruction,
    )

    return {
        "status": "success",
        "action": submit_res.get("action", "submitted"),
        "asset_id": submit_res.get("id"),
        "name": submit_res.get("name"),
    }

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input: return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}
        
        if method == "ingest_assistant_from_url":
            result = await ingest_assistant_from_url(**args)
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"Unknown method: {method}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
