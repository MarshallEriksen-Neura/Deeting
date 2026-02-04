import asyncio
import os
import sys

# Add the backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings
from app.core.sandbox.manager import sandbox_manager


async def test_sandbox():
    session_id = "test-session-001"
    print(f"Using OpenSandbox URL: {settings.OPENSANDBOX_URL}")
    code = """
import math
print(f"PI is {math.pi}")
x = 10 * 10
x
"""
    print(f"--- Running code in session: {session_id} ---")

    # Run once
    result = await sandbox_manager.run_code(session_id, code)
    print("First Run Result:", result)

    # Run again to test persistence (stateful)
    code_2 = "print(f'Previous x was {x}')"
    print("\n--- Testing Persistence ---")
    result_2 = await sandbox_manager.run_code(session_id, code_2)
    print("Second Run Result:", result_2)

    # Cleanup is managed by sandbox manager/reaper.


if __name__ == "__main__":
    try:
        asyncio.run(test_sandbox())
    except Exception as e:
        print(f"Test failed: {e}")
