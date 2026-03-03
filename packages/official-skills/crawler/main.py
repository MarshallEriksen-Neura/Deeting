import json
import sys
import httpx
from typing import Dict, Any, List

# Basic Markdown conversion logic or a placeholder for a real one
def html_to_markdown(html: str) -> str:
    # In a real scenario, use beautifulsoup4 + markdownify
    # Here we just provide a simplified placeholder
    return f"--- Content Extracted ---

{html[:500]}..."

async def fetch_web_content(url: str, js_mode: bool = True) -> Dict[str, Any]:
    """Fetch content from a single URL."""
    print(f"[*] Fetching: {url} (js_mode={js_mode})", file=sys.stderr)
    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            resp = await client.get(url, timeout=30.0)
            resp.raise_for_status()
            
            # Simple metadata extraction
            title = "Web Page"
            if "<title>" in resp.text:
                title = resp.text.split("<title>")[1].split("</title>")[0]
            
            markdown = html_to_markdown(resp.text)
            
            return {
                "status": "success",
                "title": title,
                "markdown": markdown,
                "url": str(resp.url)
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

async def crawl_website(url: str, max_depth: int = 2, max_pages: int = 10) -> Dict[str, Any]:
    """Recursive crawl implementation."""
    # This is a simplified version for standalone use
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

# Entry point for tool calls
if __name__ == "__main__":
    # If run directly, expect JSON input for tool call
    # This makes it compatible with both MCP and custom execution
    try:
        input_data = json.load(sys.stdin)
        tool_name = input_data.get("method") or input_data.get("tool")
        params = input_data.get("params") or input_data.get("arguments") or {}
        
        import asyncio
        
        if tool_name == "fetch_web_content":
            result = asyncio.run(fetch_web_content(**params))
        elif tool_name == "crawl_website":
            result = asyncio.run(crawl_website(**params))
        else:
            result = {"error": f"Unknown tool: {tool_name}"}
            
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
