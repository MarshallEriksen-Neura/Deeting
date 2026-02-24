import uuid
import json
import shutil
from pathlib import Path
import pytest
from sqlalchemy import select, delete

from app.models.skill_registry import SkillRegistry
from app.models.user_skill_installation import UserSkillInstallation
from app.agent_plugins.builtins.skill_runner.plugin import SkillRunnerPlugin
from app.agent_plugins.core.context import ConcretePluginContext
from app.services.tools.tool_sync_service import tool_sync_service
from app.services.plugin_ui_bundle_storage import get_plugin_ui_bundle_dir, get_bundle_ready_marker

@pytest.mark.asyncio
async def test_plugin_full_lifecycle_e2e(db_session, current_user_obj, settings):
    """
    E2E Integration Test for Plugin System:
    Ingestion -> Installation -> Discovery -> Execution -> UI Token.
    """
    skill_id = f"test.plugin.{uuid.uuid4().hex[:8]}"
    revision = "v1.0.test"
    user_id = current_user_obj.id
    
    # 1. Setup: Mock a plugin in registry
    manifest = {
        "id": skill_id,
        "name": "E2E Test Weather",
        "entry": {"backend": "main.py", "renderer": "ui/index.html"},
        "capabilities": {"llm_tools": "llm-tool.yaml"}
    }
    
    skill = SkillRegistry(
        id=skill_id,
        name=manifest["name"],
        status="active",
        source_repo="https://github.com/deeting/e2e-test",
        source_revision=revision,
        manifest_json=manifest,
        runtime="opensandbox"
    )
    db_session.add(skill)
    
    # 2. Setup: Mock physical UI bundle on disk
    bundle_dir = get_plugin_ui_bundle_dir(skill_id=skill_id, revision=revision)
    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / "index.html").write_text("<html>Test</html>")
    get_bundle_ready_marker(bundle_dir).touch()
    
    try:
        # 3. Test Installation
        installation = UserSkillInstallation(
            user_id=user_id,
            skill_id=skill_id,
            is_enabled=True,
            installed_revision=revision,
            granted_permissions=["network.outbound"]
        )
        db_session.add(installation)
        await db_session.commit()

        # 4. Test JIT Discovery Logic
        # (Verify that tool_sync_service can see this installed skill)
        installed_ids = await tool_sync_service._list_user_installed_skill_ids(user_id)
        assert skill_id in installed_ids

        # 5. Test Execution Workflow (SkillRunner -> UI Gateway)
        plugin_ctx = ConcretePluginContext(
            plugin_name="core.execution.skill_runner",
            plugin_id="skill_runner",
            user_id=user_id,
            session_id="e2e_session"
        )
        runner = SkillRunnerPlugin()
        await runner.initialize(plugin_ctx)
        
        # Mock Sandbox result
        mock_sandbox_result = {
            "exit_code": 0,
            "stdout": ["[deeting.log] processing..."],
            "render_blocks": [
                {
                    "view_type": "custom.view",
                    "payload": {"data": 123}
                }
            ]
        }
        
        class MockCtx:
            def get(self, ns, key, default=None):
                if ns == "request" and key == "base_url": return "http://localhost:8000"
                return default

        # The core logic
        ui_blocks = await runner._build_ui_blocks(
            result=mock_sandbox_result,
            skill_id=skill_id,
            user_id=user_id,
            ctx=MockCtx(),
            session=db_session
        )
        
        # 6. Final Validations
        assert len(ui_blocks) == 1
        block = ui_blocks[0]
        assert block["type"] == "ui"
        assert block["view_type"] == "plugin.iframe"
        assert "renderer_url" in block["metadata"]
        assert f"/api/v1/plugin-market/ui/t/" in block["metadata"]["renderer_url"]
        
    finally:
        # Cleanup disk
        if bundle_dir.exists():
            shutil.rmtree(bundle_dir.parent)
