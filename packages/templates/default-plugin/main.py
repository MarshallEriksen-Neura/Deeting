import asyncio
import json
import sys
from typing import Any, Dict

try:
    from deeting import deeting
except ImportError:
    deeting = None


async def hello_deeting(name: str = "Stranger") -> Dict[str, Any]:
    if not deeting:
        return {"status": "error", "message": "Deeting SDK not found"}

    message = f"Hello {name}! This is your custom plugin speaking."
    deeting.log(f"Executing hello_deeting for {name}")
    deeting.render(
        view_type="bento.grid",
        title="Plugin Response",
        payload={
            "items": [
                {"title": "Status", "value": "Active", "color": "emerald"},
                {"title": "User", "value": name},
            ]
        },
    )
    return {"status": "success", "message": message}


async def handle_input() -> None:
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            return
        data = json.loads(raw_input)
        method = data.get("method") or data.get("tool")
        args = data.get("arguments") or data.get("params") or {}

        if method == "hello_deeting":
            result = await hello_deeting(**args)
        else:
            result = {"error": f"Unknown method: {method}"}

        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(handle_input())
