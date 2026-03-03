import json
import sys
import asyncio
from typing import Dict, Any, Optional

try:
    from deeting import deeting
except ImportError:
    deeting = None

async def ingest_assistant_from_url(url: str, instruction: str = "") -> Dict[str, Any]:
    """Analyze a URL and submit an onboarding request to the host."""
    if not deeting:
        return {"status": "error", "message": "Deeting SDK not available"}

    print(f"[*] Analyzing source: {url}...", file=sys.stderr)
    
    # 1. Reuse existing crawler skill
    crawl_result = await deeting.call_tool("fetch_web_content", url=url)
    if not crawl_result or crawl_result.get("status") == "error":
        return {"status": "error", "message": f"Crawl failed: {crawl_result.get('error')}"}

    content = crawl_result.get("markdown", "")[:15000]
    
    # 2. Intelligent Refinement (Delegated to Host LLM)
    # We ask the host to refine the persona and return structured JSON
    refinement_prompt = f"""
    URL: {url}
    Context: {content}
    Custom Instruction: {instruction}
    """
    
    print(f"[*] Extracting metadata via System LLM...", file=sys.stderr)
    analysis = await deeting.call_tool("sys_refine_asset_metadata", prompt=refinement_prompt, asset_type="assistant")
    
    if not analysis or "error" in analysis:
        return {"status": "error", "message": "Metadata extraction failed"}

    # 3. THE ELEGANT STEP: Submit Onboarding Request
    # We don't save. We ASK the host to onboard this structured asset.
    # The host will decide whether to Review (Cloud) or Direct Save (Desktop).
    print(f"[*] Submitting onboarding request for '{analysis.get('name')}'...", file=sys.stderr)
    
    submit_res = await deeting.call_tool(
        "sys_submit_onboarding_request", 
        asset_type="assistant",
        payload=analysis,
        source_url=url
    )
    
    return {
        "status": "success",
        "action": submit_res.get("action", "submitted"), # e.g., "created" or "pending_review"
        "asset_id": submit_res.get("id"),
        "name": analysis.get("name")
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
