import asyncio

import pytest

import app.core.sandbox.manager as sandbox_manager_module
from app.core.sandbox.manager import (
    _ERROR_CODE_INTERNAL,
    _ERROR_CODE_NETWORK_DISCONNECT,
    _ERROR_CODE_RESOURCE_LIMIT,
    _ERROR_CODE_TIMEOUT,
    SandboxManager,
)


class _FakeSandbox:
    def __init__(self) -> None:
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
