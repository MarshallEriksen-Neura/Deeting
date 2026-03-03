import json
import sys
import asyncio
from typing import Any, Dict, Optional

# Attempt to import deeting SDK if available in the runtime environment
try:
    from deeting import deeting
except ImportError:
    deeting = None

async def run_python(code: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Core implementation of the run_python tool.
    In Deeting environment, it delegates to the system's execution capability.
    """
    if deeting:
        # Delegate to the system sandbox
        # Note: 'execute_code_plan' is the standard name for this capability in Deeting
        return deeting.call_tool("execute_code_plan", code=code, session_id=session_id)
    else:
        # Standalone/Fallback execution (stateless)
        # Used for testing or when the skill is run as a plain script
        import io
        from contextlib import redirect_stdout, redirect_stderr
        
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        
        try:
            # Note: In a production 'official skill', we might want to use 
            # a more secure subprocess-based execution if running standalone.
            # But when running inside Deeting, 'deeting' will be defined.
            globals_dict = {}
            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                exec(code, globals_dict)
            
            return {
                "status": "success",
                "stdout": stdout_buf.getvalue(),
                "stderr": stderr_buf.getvalue(),
                "result": str(globals_dict.get("__result__", "")) # Convention for returning values
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "stdout": stdout_buf.getvalue(),
                "stderr": stderr_buf.getvalue()
            }

async def handle_input():
    """Reads JSON from stdin and executes the requested tool."""
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            return
            
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        arguments = data.get("arguments") or data.get("params") or {}
        
        if method == "run_python":
            result = await run_python(**arguments)
            print(json.dumps(result, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"Unknown method: {method}"}))
            
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(handle_input())
