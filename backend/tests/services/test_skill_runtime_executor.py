import pytest
from itertools import count

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
    def __init__(self, stdout_text: str = "ok", error=None) -> None:
        self.logs = _FakeExecutionLogs(stdout_text=stdout_text)
        self.result = []
        self.error = error


class _FakeCommands:
    def __init__(
        self,
        has_requirements: bool = False,
        *,
        execution_error=None,
    ) -> None:
        self.commands_ran: list[str] = []
        self.has_requirements = has_requirements
        self.execution_error = execution_error
        self.repo_present = False

    async def run(self, command: str, *, opts=None, handlers=None):
        self.commands_ran.append(command)
        if command.startswith("rm -rf "):
            self.repo_present = False
            return _FakeExecution(stdout_text="ok")
        if command.startswith("git clone "):
            self.repo_present = True
            return _FakeExecution(stdout_text="ok")
        if command.startswith("if [ -d "):
            signal = "1" if self.repo_present else "0"
            return _FakeExecution(stdout_text=signal)
        if command == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi":
            signal = "1" if self.has_requirements else "0"
            return _FakeExecution(stdout_text=signal)
        error = self.execution_error if "command -v python3" in command else None
        return _FakeExecution(stdout_text="ok", error=error)


class _FakeFiles:
    def __init__(self) -> None:
        self.writes: dict[str, str] = {}

    async def write_file(self, path: str, data, **_kwargs):
        self.writes[path] = data if isinstance(data, str) else data.decode("utf-8")

    async def read_bytes(self, path: str, **_kwargs):
        return b"artifact"


class _FakeSandbox:
    _counter = count(1)

    def __init__(
        self,
        *,
        has_requirements: bool = False,
        execution_error=None,
    ) -> None:
        self.id = f"fake_sandbox_{next(self._counter)}"
        self.commands = _FakeCommands(
            has_requirements=has_requirements,
            execution_error=execution_error,
        )
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
    assert sandbox.commands.commands_ran[0].startswith("mkdir -p ")
    assert sandbox.commands.commands_ran[1].startswith("rm -rf /workspace/skills/docx/repo")
    assert "git clone" in sandbox.commands.commands_ran[2]
    assert sandbox.commands.commands_ran[3] == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    assert sandbox.commands.commands_ran[4] == "pip install lxml"
    assert "command -v python3" in sandbox.commands.commands_ran[5]
    assert "/workspace/skills/docx/run.py" in sandbox.commands.commands_ran[5]
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

    assert sandbox.commands.commands_ran[3] == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    assert sandbox.commands.commands_ran[4] == "pip install -r requirements.txt"
    assert "command -v python3" in sandbox.commands.commands_ran[5]
    assert "/workspace/skills/repo.with.requirements/run.py" in sandbox.commands.commands_ran[5]


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

    assert sandbox.commands.commands_ran[3] == "if [ -f requirements.txt ]; then echo 1; else echo 0; fi"
    assert "command -v python3" in sandbox.commands.commands_ran[4]
    assert "/workspace/skills/repo.no.dependencies/run.py" in sandbox.commands.commands_ran[4]
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


@pytest.mark.asyncio
async def test_executor_surfaces_execution_error_from_sandbox():
    manifest = {"usage_spec": {"example_code": "print('ok')"}}
    skill = type(
        "Skill",
        (),
        {
            "id": "repo.exec.error",
            "runtime": "opensandbox",
            "source_repo": "https://example.com/repo.git",
            "source_revision": "main",
            "source_subdir": None,
            "manifest_json": manifest,
        },
    )()
    execution_error = type(
        "Err",
        (),
        {
            "name": "CommandExecError",
            "value": "fork/exec /usr/bin/bash: no such file or directory",
            "traceback": [],
        },
    )()
    sandbox = _FakeSandbox(execution_error=execution_error)
    executor = SkillRuntimeExecutor(
        _FakeRepo(skill),
        sandbox_manager=_FakeSandboxManager(sandbox),
    )

    result = await executor.execute(
        "repo.exec.error",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={},
        intent="dry_run",
    )

    assert result["exit_code"] == 1
    assert result["error"]["name"] == "CommandExecError"


@pytest.mark.asyncio
async def test_executor_reuses_repo_and_dependency_cache_within_same_sandbox():
    manifest = {
        "usage_spec": {"example_code": "print('ok')"},
        "installation": {"dependencies": ["lxml"]},
    }
    skill = type(
        "Skill",
        (),
        {
            "id": "repo.cache.hit",
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

    await executor.execute(
        "repo.cache.hit",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={},
        intent="edit",
    )
    before_second = len(sandbox.commands.commands_ran)

    await executor.execute(
        "repo.cache.hit",
        session_id="u1",
        user_id="00000000-0000-0000-0000-000000000001",
        inputs={},
        intent="edit",
    )
    second_run_cmds = sandbox.commands.commands_ran[before_second:]

    assert sum(1 for cmd in sandbox.commands.commands_ran if cmd.startswith("git clone")) == 1
    assert sum(1 for cmd in sandbox.commands.commands_ran if cmd.startswith("pip install lxml")) == 1
    assert any(cmd.startswith("if [ -d /workspace/skills/repo.cache.hit/repo") for cmd in second_run_cmds)
