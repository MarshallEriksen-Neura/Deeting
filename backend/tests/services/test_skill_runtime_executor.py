import pytest

from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor


@pytest.mark.asyncio
async def test_executor_returns_artifacts_and_logs():
    executor = SkillRuntimeExecutor(None)  # type: ignore[arg-type]
    result = await executor.execute("docx", session_id="u1", inputs={}, intent="edit")
    assert result["artifacts"][0]["name"] == "output_docx"
    assert result["stdout"]
