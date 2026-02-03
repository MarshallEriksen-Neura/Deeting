import pytest

from app.services.skill_registry.skill_runtime_executor import SkillRuntimeExecutor


@pytest.mark.asyncio
async def test_executor_returns_artifacts_and_logs():
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": []},
        "artifacts": [{"name": "output_docx", "type": "file", "path": "output.docx"}],
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "docx",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    sandbox = _FakeSandbox()
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(sandbox),
    )
    result = await executor.execute("docx", session_id="u1", inputs={}, intent="edit")
    assert result["artifacts"][0]["name"] == "output_docx"
    assert result["stdout"]


class _FakeExecutionLogs:
    def __init__(self) -> None:
        self.stdout = [type("Msg", (), {"text": "ok"})()]
        self.stderr = []


class _FakeExecution:
    def __init__(self) -> None:
        self.logs = _FakeExecutionLogs()
        self.result = []


class _FakeCommands:
    def __init__(self) -> None:
        self.commands_ran: list[str] = []

    async def run(self, command: str, *, opts=None, handlers=None):
        self.commands_ran.append(command)
        return _FakeExecution()


class _FakeFiles:
    def __init__(self) -> None:
        self.writes: dict[str, str] = {}

    async def write_file(self, path: str, data, **_kwargs):
        self.writes[path] = data if isinstance(data, str) else data.decode("utf-8")

    async def read_bytes(self, path: str, **_kwargs):
        return b"artifact"


class _FakeSandbox:
    def __init__(self) -> None:
        self.commands = _FakeCommands()
        self.files = _FakeFiles()

    async def close(self) -> None:
        return None


class _FakeSandboxManager:
    def __init__(self, sandbox: _FakeSandbox) -> None:
        self.sandbox = sandbox

    async def _create_sandbox(self, _session_id: str):
        return self.sandbox


class _FakeRepo:
    def __init__(self, skill):
        self.skill = skill

    async def get_by_id(self, _skill_id: str):
        return self.skill


@pytest.mark.asyncio
async def test_executor_builds_script_and_reads_artifacts():
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": ["lxml"]},
        "artifacts": [{"name": "output_docx", "type": "file", "path": "output.docx"}],
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "docx",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    sandbox = _FakeSandbox()
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(sandbox),
    )

    result = await executor.execute(
        "docx", session_id="u1", inputs={"docx_path": "a.docx"}, intent="edit"
    )

    assert sandbox.commands.commands_ran[0].startswith("mkdir -p")
    assert "git clone" in sandbox.commands.commands_ran[1]
    assert sandbox.commands.commands_ran[2] == "pip install lxml"
    assert sandbox.commands.commands_ran[3].startswith("python ")
    assert result["artifacts"][0]["content_base64"]
