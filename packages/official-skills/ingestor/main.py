import json
import sys
import asyncio
from typing import Dict, Any

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def submit_assistant_ingest(
    source_url: str,
    content: str,
    instruction: str = "",
) -> Dict[str, Any]:
    """Persist already-collected content through the cloud admin API."""
    if not deeting:
        return {"status": "error", "message": "Deeting SDK not available"}

    print("[*] Submitting assistant ingest result to cloud admin persistence...", file=sys.stderr)
    submit_res = await deeting.call_tool(
        "cloud.assistant_ingest.submit",
        source_url=source_url,
        content_excerpt=content[:15000],
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
        
        if method == "submit_assistant_ingest":
            result = await submit_assistant_ingest(**args)
            print(json.dumps(result, ensure_ascii=False))
        elif method == "ingest_assistant_from_url":
            print(
                json.dumps(
                    {
                        "status": "error",
                        "message": "ingest_assistant_from_url is deprecated; use search/crawl tools first, then call submit_assistant_ingest",
                    },
                    ensure_ascii=False,
                )
            )
        else:
            print(json.dumps({"error": f"Unknown method: {method}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    asyncio.run(handle_input())
