import json
import sys
import os
import asyncio
from typing import Dict, Any, List

# Ensure we can import httpx
try:
    import httpx
except ImportError:
    print("[!] Error: 'httpx' library not found in the python environment.", file=sys.stderr)
    sys.exit(1)

# Get Scout URL from environment
SCOUT_SERVICE_URL = os.environ.get("SCOUT_SERVICE_URL", "http://scout:8001")

async def fetch_web_content(url: str, js_mode: bool = True) -> Dict[str, Any]:
    """Fetch content from a single URL via Scout service."""
    scout_endpoint = f"{SCOUT_SERVICE_URL.rstrip('/')}/v1/scout/inspect"
    
    print(f"[*] Dispatching Scout to: {url} via {scout_endpoint}", file=sys.stderr)
    
    # Increase timeout for deep crawling
    timeout = httpx.Timeout(60.0, connect=10.0)
    
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            print(f"[*] Sending POST request to {scout_endpoint}...", file=sys.stderr)
            response = await client.post(
                scout_endpoint, 
                json={"url": url, "js_mode": js_mode}
            )
            print(f"[*] Scout response status: {response.status_code}", file=sys.stderr)
            
            response.raise_for_status()
            data = response.json()

            if data.get("status") == "failed":
                print(f"[!] Scout reported failure: {data.get('error')}", file=sys.stderr)
                return {"status": "error", "error": data.get("error")}

            markdown = data.get("markdown")
            return {
                "status": "success",
                "title": data.get("metadata", {}).get("title"),
                "markdown": markdown,
                "content": markdown, # for compatibility
                "metadata": data.get("metadata"),
                "url": url
            }
        except httpx.HTTPStatusError as e:
            print(f"[!] HTTP Error: {e.response.status_code} - {e.response.text}", file=sys.stderr)
            return {"status": "error", "error": f"Scout Service Error ({e.response.status_code}): {e.response.text}"}
        except Exception as e:
            print(f"[!] Scout Request Failed: {str(e)}", file=sys.stderr)
            return {"status": "error", "error": f"Scout Service Unavailable: {str(e)}"}

async def crawl_website(url: str, max_depth: int = 2, max_pages: int = 10) -> Dict[str, Any]:
    # Simple recursive crawl using fetch_web_content
    results = []
    to_visit = [(url, 0)]
    visited = set()
    
    while to_visit and len(visited) < max_pages:
        current_url, depth = to_visit.pop(0)
        if current_url in visited or depth > max_depth:
            continue
            
        visited.add(current_url)
        content = await fetch_web_content(current_url)
        if content["status"] == "success":
            results.append(content)
            
    return {
        "status": "success",
        "base_url": url,
        "pages_found": len(results),
        "pages": results
    }

async def handle_input():
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            print("[!] Error: No input received on stdin", file=sys.stderr)
            return
            
        print(f"[*] Received input: {raw_input[:100]}...", file=sys.stderr)
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        params = data.get("arguments") or data.get("params") or {}
        
        print(f"[*] Executing method: {method}", file=sys.stderr)
        
        if method == "fetch_web_content":
            result = await fetch_web_content(**params)
        elif method == "crawl_website":
            result = await crawl_website(**params)
        else:
            result = {"error": f"Unknown tool: {method}"}
            print(f"[!] Error: Unknown method {method}", file=sys.stderr)
            
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(f"[!] Critical Error in handle_input: {str(e)}", file=sys.stderr)
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(handle_input())
