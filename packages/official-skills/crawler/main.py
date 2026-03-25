import json
import sys
import os
import asyncio
from typing import Dict, Any, List
import traceback

# Ensure we can import httpx
try:
    import httpx
except ImportError:
    print("[!] Error: 'httpx' library not found in the python environment.", file=sys.stderr)
    sys.exit(1)

# Get Scout URL from environment
SCOUT_SERVICE_URL = os.environ.get("SCOUT_SERVICE_URL", "http://scout:8001")


def configure_stdio_utf8() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict")


def emit_json(payload: Dict[str, Any]) -> None:
    try:
        serialized = json.dumps(payload, ensure_ascii=False, default=str)
    except Exception as exc:
        serialized = json.dumps(
            {
                "status": "error",
                "error": f"skill_serialization_error: {type(exc).__name__}: {exc}",
            },
            ensure_ascii=True,
        )

    try:
        sys.stdout.write(serialized)
        sys.stdout.write("\n")
        sys.stdout.flush()
    except UnicodeEncodeError as exc:
        fallback = json.dumps(
            {
                "status": "error",
                "error": f"skill_output_encoding_error: {type(exc).__name__}: {exc}",
            },
            ensure_ascii=True,
        )
        if hasattr(sys.stdout, "buffer"):
            sys.stdout.buffer.write(fallback.encode("ascii") + b"\n")
            sys.stdout.flush()
            return
        raise

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
            if not isinstance(data, dict):
                return {
                    "status": "error",
                    "error": "Scout Service Contract Error: response body must be an object",
                }

            if data.get("status") == "failed":
                print(f"[!] Scout reported failure: {data.get('error')}", file=sys.stderr)
                return {"status": "error", "error": data.get("error")}

            markdown = data.get("markdown")
            metadata = data.get("metadata") or {}
            title = data.get("title") or metadata.get("title")
            return {
                "status": "success",
                "title": title,
                "markdown": markdown,
                "content": markdown, # for compatibility
                "metadata": metadata,
                "url": url
            }
        except httpx.HTTPStatusError as e:
            response_text = (e.response.text or "").strip()
            print(
                f"[!] HTTP Error: {e.response.status_code} - {response_text}",
                file=sys.stderr,
            )
            return {
                "status": "error",
                "error": f"Scout Service Error ({e.response.status_code}): {response_text}",
            }
        except httpx.TimeoutException as e:
            detail = f"{type(e).__name__}: {e!r}"
            print(f"[!] Scout Request Timed Out: {detail}", file=sys.stderr)
            return {
                "status": "error",
                "error": f"Scout Service Timeout: {detail}",
            }
        except httpx.RequestError as e:
            detail = f"{type(e).__name__}: {e!r}"
            print(f"[!] Scout Request Error: {detail}", file=sys.stderr)
            return {
                "status": "error",
                "error": f"Scout Service Request Error: {detail}",
            }
        except Exception as e:
            detail = f"{type(e).__name__}: {e!r}"
            print(f"[!] Scout Request Failed: {detail}", file=sys.stderr)
            print(traceback.format_exc(), file=sys.stderr)
            return {
                "status": "error",
                "error": f"Scout Service Unavailable: {detail}",
            }

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
            
        emit_json(result)
    except Exception as e:
        print(f"[!] Critical Error in handle_input: {str(e)}", file=sys.stderr)
        emit_json({"status": "error", "error": str(e)})

if __name__ == "__main__":
    configure_stdio_utf8()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(handle_input())
