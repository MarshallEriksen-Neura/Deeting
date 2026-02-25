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
            "runtime": "opensandbox",
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
        "docx",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={},
        intent="edit",
    )
    assert result["artifacts"][0]["name"] == "output_docx"
    assert result["stdout"]


@pytest.mark.asyncio
async def test_executor_accepts_python_library_runtime_without_unknown_warning(caplog):
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": []},
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "docx.python.runtime",
            "runtime": "python_library",
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

    with caplog.at_level(
        "WARNING",
        logger="app.services.skill_registry.skill_runtime_executor",
    ):
        result = await executor.execute(
            "docx.python.runtime",
            session_id="u1",
            user_id="00000000-0000-0000-0000-000000000001",
            inputs={},
            intent="edit",
        )

    assert result["status"] == "ok"
    assert not any(
        "Unknown runtime" in record.message
        for record in caplog.records
    )


class _FakeExecutionLogs:
    def __init__(self, stdout_text: str = "ok") -> None:
        self.stdout = [type("Msg", (), {"text": stdout_text})()]
        self.stderr = []


class _FakeExecution:
    def __init__(self, stdout_text: str = "ok") -> None:
        self.logs = _FakeExecutionLogs(stdout_text=stdout_text)
        self.result = []


class _FakeCommands:
    def __init__(self, has_requirements: bool = False) -> None:
        self.commands_ran: list[str] = []
        self.has_requirements = has_requirements

    async def run(self, command: str, *, opts=None, handlers=None):
        self.commands_ran.append(command)
        if command == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi":
            signal = "1" if self.has_requirements else "0"
            return _FakeExecution(stdout_text=signal)
        return _FakeExecution(stdout_text="ok")


class _FakeFiles:
    def __init__(self) -> None:
        self.writes: dict[str, str] = {}

    async def write_file(self, path: str, data, **_kwargs):
        self.writes[path] = data if isinstance(data, str) else data.decode("utf-8")

    async def read_bytes(self, path: str, **_kwargs):
        return b"artifact"


class _FakeSandbox:
    def __init__(self, *, has_requirements: bool = False) -> None:
        self.id = "fake_sandbox"
        self.commands = _FakeCommands(has_requirements=has_requirements)
        self.files = _FakeFiles()

    async def close(self) -> None:
        return None


class _FakeSandboxManager:
    def __init__(self, sandbox: _FakeSandbox) -> None:
        self.sandbox = sandbox

    async def _create_sandbox(self, _session_id: str):
        return self.sandbox

    async def get_or_create_sandbox(self, _session_id: str):
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
            "runtime": "opensandbox",
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
        "docx",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={"docx_path": "a.docx"},
        intent="edit",
    )

    run_script = sandbox.files.writes.get("/workspace/skills/docx/run.py", "")
    assert "class DeetingRuntime" in run_script
    assert "plugin backend must define async def invoke" in run_script
    assert "__DEETING_PLUGIN_INVOKE_RESULT__" in run_script
    assert sandbox.commands.commands_ran[0].startswith("rm -rf ")
    assert "mkdir -p" in sandbox.commands.commands_ran[0]
    assert "git clone" in sandbox.commands.commands_ran[1]
    assert sandbox.commands.commands_ran[2] == "pip install lxml"
    assert (
        sandbox.commands.commands_ran[3]
        == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    )
    assert "command -v python3" in sandbox.commands.commands_ran[4]
    assert "/workspace/skills/docx/run.py" in sandbox.commands.commands_ran[4]
    assert result["artifacts"][0]["content_base64"]


@pytest.mark.asyncio
async def test_executor_installs_requirements_txt_when_present():
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": []},
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "repo.with.requirements",
            "runtime": "opensandbox",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    sandbox = _FakeSandbox(has_requirements=True)
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(sandbox),
    )

    await executor.execute(
        "repo.with.requirements",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={},
        intent="edit",
    )

    assert sandbox.commands.commands_ran[2] == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    assert sandbox.commands.commands_ran[3] == "pip install -r requirements.txt"
    assert "command -v python3" in sandbox.commands.commands_ran[4]
    assert "/workspace/skills/repo.with.requirements/run.py" in sandbox.commands.commands_ran[4]


@pytest.mark.asyncio
async def test_executor_logs_skip_when_no_dependencies_and_no_requirements(caplog):
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": []},
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "repo.no.dependencies",
            "runtime": "opensandbox",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    sandbox = _FakeSandbox(has_requirements=False)
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(sandbox),
    )

    with caplog.at_level("INFO", logger="app.services.skill_registry.runtimes.sandbox"):
        await executor.execute(
            "repo.no.dependencies",
            session_id="u1",
            user_id="00000000-0000-0000-0000-000000000001",
            inputs={},
            intent="edit",
        )

    assert sandbox.commands.commands_ran[2] == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    assert "command -v python3" in sandbox.commands.commands_ran[3]
    assert "/workspace/skills/repo.no.dependencies/run.py" in sandbox.commands.commands_ran[3]
    assert not any(cmd.startswith("pip install") for cmd in sandbox.commands.commands_ran)
    assert any(
        "event=plugin_dependency_install_skipped" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_executor_requires_user_id_for_repo_skill():
    manifest = {"usage_spec": {"example_code": "print('ok')"}}
    skill = type(
        "Skill",
        (),
        {
            "id": "plugin.repo.skill",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(_FakeSandbox()),
    )

    with pytest.raises(ValueError, match="authenticated user installation"):
        await executor.execute(
            "plugin.repo.skill",
            session_id="u1",
            user_id=None,
            inputs={},
            intent="edit",
        )
