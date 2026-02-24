import asyncio
import uuid
import json
import os
import sys
import shutil
from pathlib import Path
from sqlalchemy import select, delete

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.core.database import AsyncSessionLocal
from app.models.skill_registry import SkillRegistry
from app.models.user_skill_installation import UserSkillInstallation
from app.models.user import User
from app.services.tools.tool_sync_service import tool_sync_service
from app.agent_plugins.builtins.skill_runner.plugin import SkillRunnerPlugin
from app.agent_plugins.core.context import ConcretePluginContext
from app.services.plugin_ui_bundle_storage import get_plugin_ui_bundle_dir, get_bundle_ready_marker

# Mock IDs
TEST_SKILL_ID = "com.deeting.example.weather"
TEST_REVISION = "smoke-test-v1"

async def smoke_test():
    print(f"🚀 Starting E2E Smoke Test for Plugin System...")
    
    async with AsyncSessionLocal() as session:
        # Get an existing user
        result = await session.execute(select(User).limit(1))
        existing_user = result.scalar_one_or_none()
        if not existing_user:
            print("❌ Error: No users found in database.")
            return
        
        TEST_USER_ID = existing_user.id
        print(f"👤 Using existing user: {TEST_USER_ID}")

        # 1. Clean up previous test data
        await session.execute(delete(UserSkillInstallation).where(UserSkillInstallation.user_id == TEST_USER_ID, UserSkillInstallation.skill_id == TEST_SKILL_ID))
        await session.execute(delete(SkillRegistry).where(SkillRegistry.id == TEST_SKILL_ID))
        await session.commit()

        # 2. Simulate Ingestion
        print("📦 Step 1: Simulating Plugin Ingestion...")
        weather_plugin_path = PROJECT_ROOT / "packages/examples/weather-plugin"
        with open(weather_plugin_path / "deeting.json", "r") as f:
            manifest = json.load(f)
        
        skill = SkillRegistry(
            id=TEST_SKILL_ID,
            name=manifest["name"],
            status="active",
            source_repo="https://github.com/deeting/weather-plugin",
            source_revision=TEST_REVISION,
            manifest_json=manifest,
            runtime="opensandbox"
        )
        session.add(skill)
        await session.commit()
        
        # --- MOCK PHYSICAL BUNDLE ---
        bundle_dir = get_plugin_ui_bundle_dir(skill_id=TEST_SKILL_ID, revision=TEST_REVISION)
        bundle_dir.mkdir(parents=True, exist_ok=True)
        # Copy the index.html to the bundle dir
        shutil.copy(weather_plugin_path / "ui/index.html", bundle_dir / "index.html")
        # Create ready marker
        get_bundle_ready_marker(bundle_dir).touch()
        print(f"📁 Physical UI Bundle created at: {bundle_dir}")
        # ----------------------------

        # 3. Simulate User Installation
        print("🛠 Step 2: Simulating User Installation...")
        installation = UserSkillInstallation(
            user_id=TEST_USER_ID,
            skill_id=TEST_SKILL_ID,
            is_enabled=True,
            installed_revision=TEST_REVISION,
            granted_permissions=["network.outbound"]
        )
        session.add(installation)
        await session.commit()

        # 4. Test JIT Discovery
        print("🔍 Step 3: Testing JIT Discovery...")
        installed_ids = await tool_sync_service._list_user_installed_skill_ids(TEST_USER_ID)
        assert TEST_SKILL_ID in installed_ids
        print(f"✅ JIT Filter correctly identified the installed plugin.")

        # 5. Test Execution & UI Rendering
        print("⚡ Step 4: Testing Skill Execution & UI Token Generation...")
        
        plugin_ctx = ConcretePluginContext(
            plugin_name="core.execution.skill_runner",
            plugin_id="skill_runner",
            user_id=TEST_USER_ID,
            session_id="test_session"
        )
        runner = SkillRunnerPlugin()
        await runner.initialize(plugin_ctx)
        
        mock_result = {
            "exit_code": 0,
            "stdout": ["Fetching weather..."],
            "render_blocks": [
                {
                    "view_type": "weather.card",
                    "payload": {"city": "Beijing", "temp": 22}
                }
            ]
        }
        
        class MockWorkflowContext:
            def __init__(self, uid):
                self.user_id = uid
            def get(self, ns, key, default=None):
                if ns == "request" and key == "base_url":
                    return "https://deeting.app"
                return default

        ui_blocks = await runner._build_ui_blocks(
            result=mock_result,
            skill_id=TEST_SKILL_ID,
            user_id=TEST_USER_ID,
            ctx=MockWorkflowContext(TEST_USER_ID),
            session=session
        )
        
        print("\nFinal Produced UI Blocks:")
        print(json.dumps(ui_blocks, indent=2))
        
        assert len(ui_blocks) > 0
        assert ui_blocks[0]["type"] == "ui"
        assert ui_blocks[0]["view_type"] == "plugin.iframe"
        assert "renderer_url" in ui_blocks[0]["metadata"]
        
        # Check if URL is valid
        renderer_url = ui_blocks[0]["metadata"]["renderer_url"]
        print(f"🔗 Generated Renderer URL: {renderer_url}")
        
        print("\n✅ E2E Smoke Test Logic Passed!")

if __name__ == "__main__":
    asyncio.run(smoke_test())
