import asyncio
import re

import pytest

import app.core.sandbox.manager as sandbox_manager_module
from app.core.sandbox.manager import (
    _ERROR_CODE_BUSY,
    _ERROR_CODE_INTERNAL,
    _ERROR_CODE_NETWORK_DISCONNECT,
    _ERROR_CODE_RESOURCE_LIMIT,
    _ERROR_CODE_TIMEOUT,
    SandboxManager,
    _sanitize_k8s_label_value,
)


class _FakeSandbox:
    def __init__(self, sandbox_id: str = "fake-sandbox") -> None:
        self.id = sandbox_id
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class _FakeCodes:
    def __init__(self, run_impl):
        self._run_impl = run_impl

    async def run(self, _code: str, language=None):
        return await self._run_impl(language=language)


class _FakeInterpreter:
    def __init__(self, run_impl):
        self.codes = _FakeCodes(run_impl)


class _FakeText:
    def __init__(self, text: str):
        self.text = text


class _FakeLogs:
    def __init__(self, stdout: list[str] | None = None, stderr: list[str] | None = None):
        self.stdout = [_FakeText(item) for item in (stdout or [])]
        self.stderr = [_FakeText(item) for item in (stderr or [])]


class _FakeRunResult:
    def __init__(
        self,
        *,
        result: list[str] | None = None,
        stdout: list[str] | None = None,
        stderr: list[str] | None = None,
    ):
        self.result = [_FakeText(item) for item in (result or [])]
        self.logs = _FakeLogs(stdout=stdout, stderr=stderr)


@pytest.mark.asyncio
async def test_run_code_classifies_remote_disconnect(monkeypatch):
    manager = SandboxManager()
    sandbox = _FakeSandbox()

    async def fake_get_or_create(_session_id: str):
        return sandbox

    async def run_impl(**_kwargs):
        class RemoteProtocolError(Exception):
            pass

        class SandboxInternalException(Exception):
            pass

        try:
            raise RemoteProtocolError(
                "peer closed connection without sending complete message body (incomplete chunked read)"
            )
        except Exception as inner:
            raise SandboxInternalException(
                "Unexpected SDK error occurred"
            ) from inner

    class FakeCodeInterpreter:
        @staticmethod
        async def create(_sandbox):
            return _FakeInterpreter(run_impl)

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)
    monkeypatch.setattr(
        sandbox_manager_module, "CodeInterpreter", FakeCodeInterpreter
    )

    result = await manager.run_code("s1", "print('ok')")

    assert result["error_code"] == _ERROR_CODE_NETWORK_DISCONNECT
    assert "[SANDBOX_NETWORK_DISCONNECT]" in result["error"]
    assert "RemoteProtocolError" in result["error_detail"]
    assert sandbox.closed is True


@pytest.mark.asyncio
async def test_run_code_classifies_internal_error(monkeypatch):
    manager = SandboxManager()
    sandbox = _FakeSandbox()

    async def fake_get_or_create(_session_id: str):
        return sandbox

    async def run_impl(**_kwargs):
        class SandboxInternalException(Exception):
            pass

        raise SandboxInternalException("runtime crashed unexpectedly")

    class FakeCodeInterpreter:
        @staticmethod
        async def create(_sandbox):
            return _FakeInterpreter(run_impl)

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)
    monkeypatch.setattr(
        sandbox_manager_module, "CodeInterpreter", FakeCodeInterpreter
    )

    result = await manager.run_code("s1", "print('ok')")

    assert result["error_code"] == _ERROR_CODE_INTERNAL
    assert "[SANDBOX_INTERNAL_ERROR]" in result["error"]
    assert sandbox.closed is True


@pytest.mark.asyncio
async def test_run_code_classifies_timeout(monkeypatch):
    manager = SandboxManager()
    sandbox = _FakeSandbox()

    async def fake_get_or_create(_session_id: str):
        return sandbox

    async def run_impl(**_kwargs):
        raise asyncio.TimeoutError("request timed out")

    class FakeCodeInterpreter:
        @staticmethod
        async def create(_sandbox):
            return _FakeInterpreter(run_impl)

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)
    monkeypatch.setattr(
        sandbox_manager_module, "CodeInterpreter", FakeCodeInterpreter
    )

    result = await manager.run_code("s1", "print('ok')")

    assert result["error_code"] == _ERROR_CODE_TIMEOUT
    assert "[SANDBOX_TIMEOUT]" in result["error"]
    assert sandbox.closed is True


@pytest.mark.asyncio
async def test_run_code_classifies_resource_limit(monkeypatch):
    manager = SandboxManager()

    async def fake_get_or_create(_session_id: str):
        raise ResourceWarning("Global sandbox limit reached. Please wait.")

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)

    result = await manager.run_code("s1", "print('ok')")

    assert result["error_code"] == _ERROR_CODE_RESOURCE_LIMIT
    assert "[SANDBOX_RESOURCE_LIMIT]" in result["error"]


@pytest.mark.asyncio
async def test_run_code_classifies_session_busy(monkeypatch):
    manager = SandboxManager()
    sandbox = _FakeSandbox("busy-sbox")

    async def fake_get_or_create(_session_id: str):
        return sandbox

    async def run_impl(**_kwargs):
        raise RuntimeError("error running codes session is busy")

    class FakeCodeInterpreter:
        @staticmethod
        async def create(_sandbox):
            return _FakeInterpreter(run_impl)

    async def fake_stop_sandbox(_sandbox_id: str, session_id: str | None = None):
        return None

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)
    monkeypatch.setattr(manager, "stop_sandbox", fake_stop_sandbox)
    monkeypatch.setattr(
        sandbox_manager_module, "CodeInterpreter", FakeCodeInterpreter
    )

    result = await manager.run_code("s1", "print('ok')")

    assert result["error_code"] == _ERROR_CODE_BUSY
    assert "[SANDBOX_SESSION_BUSY]" in result["error"]
    assert sandbox.closed is True


@pytest.mark.asyncio
async def test_run_code_retries_once_when_session_busy(monkeypatch):
    manager = SandboxManager()
    sandboxes = [_FakeSandbox("sb-1"), _FakeSandbox("sb-2")]
    get_calls = {"value": 0}
    run_calls = {"value": 0}
    stopped: list[tuple[str, str | None]] = []

    async def fake_get_or_create(_session_id: str):
        idx = get_calls["value"]
        get_calls["value"] += 1
        return sandboxes[idx]

    async def run_impl(**_kwargs):
        run_calls["value"] += 1
        if run_calls["value"] == 1:
            raise RuntimeError("error running codes session is busy")
        return _FakeRunResult(result=["done"], stdout=["ok"], stderr=[])

    class FakeCodeInterpreter:
        @staticmethod
        async def create(_sandbox):
            return _FakeInterpreter(run_impl)

    async def fake_stop_sandbox(sandbox_id: str, session_id: str | None = None):
        stopped.append((sandbox_id, session_id))

    monkeypatch.setattr(manager, "get_or_create_sandbox", fake_get_or_create)
    monkeypatch.setattr(manager, "stop_sandbox", fake_stop_sandbox)
    monkeypatch.setattr(
        sandbox_manager_module, "CodeInterpreter", FakeCodeInterpreter
    )

    result = await manager.run_code("s1", "print('ok')")

    assert result["exit_code"] == 0
    assert result["result"] == ["done"]
    assert result["stdout"] == ["ok"]
    assert get_calls["value"] == 2
    assert run_calls["value"] == 2
    assert stopped == [("sb-1", "s1")]
    assert sandboxes[0].closed is True
    assert sandboxes[1].closed is True


def test_build_network_policy_returns_none_when_empty(monkeypatch):
    manager = SandboxManager()
    monkeypatch.setattr(
        sandbox_manager_module.settings,
        "OPENSANDBOX_NETWORK_POLICY_JSON",
        "",
        raising=False,
    )
    assert manager._build_network_policy() is None


def test_build_network_policy_returns_none_on_invalid_json(monkeypatch):
    manager = SandboxManager()
    monkeypatch.setattr(
        sandbox_manager_module.settings,
        "OPENSANDBOX_NETWORK_POLICY_JSON",
        "{bad json",
        raising=False,
    )
    assert manager._build_network_policy() is None


def test_build_network_policy_returns_dict_when_valid(monkeypatch):
    manager = SandboxManager()
    monkeypatch.setattr(
        sandbox_manager_module.settings,
        "OPENSANDBOX_NETWORK_POLICY_JSON",
        '{"egress":{"mode":"allowlist","hosts":["api.openai.com"]}}',
        raising=False,
    )
    assert manager._build_network_policy() == {
        "egress": {"mode": "allowlist", "hosts": ["api.openai.com"]}
    }


def test_build_sandbox_entrypoint_includes_bash_compat():
    entrypoint = sandbox_manager_module._build_sandbox_entrypoint(
        "/opt/opensandbox/code-interpreter.sh"
    )
    assert entrypoint[0] == "/bin/sh"
    assert entrypoint[1] == "-lc"
    assert "/usr/bin/bash" in entrypoint[2]
    assert "exec /opt/opensandbox/code-interpreter.sh" in entrypoint[2]


def test_is_sandbox_not_found_detects_not_found_message():
    manager = SandboxManager()
    exc = RuntimeError("Sandbox 1234 not found.")
    assert manager._is_sandbox_not_found(exc) is True


def test_is_sandbox_not_found_returns_false_for_other_errors():
    manager = SandboxManager()
    exc = RuntimeError("connection reset by peer")
    assert manager._is_sandbox_not_found(exc) is False


@pytest.mark.asyncio
async def test_reap_zombies_keeps_active_sandbox_when_ref_exists(monkeypatch):
    manager = SandboxManager()
    killed: list[str] = []
    removed: list[str] = []

    class _FakeRedis:
        async def smembers(self, _key):
            return {b"sbox-1"}

        async def srem(self, _key, sandbox_id):
            removed.append(sandbox_id)

    class _FakeService:
        async def kill_sandbox(self, sandbox_id):
            killed.append(sandbox_id)

    class _FakeFactory:
        def __init__(self, _config):
            pass

        def create_sandbox_service(self):
            return _FakeService()

    async def _fake_cache_get(key: str):
        if key == sandbox_manager_module.key_ref("sbox-1"):
            return "1"
        return None

    monkeypatch.setattr(manager, "_get_redis", lambda: _FakeRedis())
    monkeypatch.setattr(sandbox_manager_module, "AdapterFactory", _FakeFactory)
    monkeypatch.setattr(sandbox_manager_module.cache, "get", _fake_cache_get)

    await manager.reap_zombies()

    assert killed == []
    assert removed == []


@pytest.mark.asyncio
async def test_reap_zombies_reaps_sandbox_when_ref_missing(monkeypatch):
    manager = SandboxManager()
    killed: list[str] = []
    removed: list[str] = []

    class _FakeRedis:
        async def smembers(self, _key):
            return {b"sbox-2"}

        async def srem(self, _key, sandbox_id):
            removed.append(sandbox_id)

    class _FakeService:
        async def kill_sandbox(self, sandbox_id):
            killed.append(sandbox_id)

    class _FakeFactory:
        def __init__(self, _config):
            pass

        def create_sandbox_service(self):
            return _FakeService()

    async def _fake_cache_get(_key: str):
        return None

    monkeypatch.setattr(manager, "_get_redis", lambda: _FakeRedis())
    monkeypatch.setattr(sandbox_manager_module, "AdapterFactory", _FakeFactory)
    monkeypatch.setattr(sandbox_manager_module.cache, "get", _fake_cache_get)

    await manager.reap_zombies()

    assert killed == ["sbox-2"]
    assert removed == ["sbox-2"]


def test_sanitize_k8s_label_value_replaces_invalid_chars():
    value = _sanitize_k8s_label_value("user:820ae05c-6900-4b07-b3d1-1f1a0959bbd5")
    assert value == "user-820ae05c-6900-4b07-b3d1-1f1a0959bbd5"


def test_sanitize_k8s_label_value_truncates_to_valid_length():
    raw = "user:" + ("a" * 100)
    value = _sanitize_k8s_label_value(raw)
    assert len(value) <= 63
    assert re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?", value)


@pytest.mark.asyncio
async def test_create_sandbox_uses_sanitized_session_id_in_metadata(monkeypatch):
    manager = SandboxManager()
    captured: dict = {}

    class _FakeResponse:
        id = "sbx-1"

    class _FakeService:
        async def create_sandbox(self, **kwargs):
            captured.update(kwargs)
            return _FakeResponse()

    class _FakeFactory:
        def __init__(self, _config):
            pass

        def create_sandbox_service(self):
            return _FakeService()

    async def _fake_connect(_sandbox_id, _factory=None, _service=None, wait_ready=False):
        assert wait_ready is True
        return _FakeSandbox("sbx-1")

    monkeypatch.setattr(manager, "_get_redis", lambda: None)
    monkeypatch.setattr(manager, "_connect_sandbox", _fake_connect)
    monkeypatch.setattr(sandbox_manager_module, "AdapterFactory", _FakeFactory)

    sandbox = await manager._create_sandbox("user:820ae05c-6900-4b07-b3d1-1f1a0959bbd5")

    assert sandbox.id == "sbx-1"
    assert captured["metadata"]["session_id"] == "user-820ae05c-6900-4b07-b3d1-1f1a0959bbd5"
