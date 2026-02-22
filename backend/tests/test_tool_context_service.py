import importlib

import pytest

from app.core.config import settings
from app.core.plugin_config import PluginConfigItem, PluginConfigLoader
from app.schemas.tool import ToolDefinition


def test_extract_last_user_message_empty():
    from app.services.tools.tool_context_service import extract_last_user_message

    assert extract_last_user_message([]) == ""


def test_extract_last_user_message_returns_last_user():
    from app.services.tools.tool_context_service import extract_last_user_message

    messages = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "need tools"},
    ]
    assert extract_last_user_message(messages) == "need tools"


def test_tool_context_service_importable():
    module = importlib.import_module("app.services.tools.tool_context_service")
    assert module.tool_context_service is not None


# ---------------------------------------------------------------------------
# PluginConfigLoader.get_plugins_for_user 测试
# ---------------------------------------------------------------------------

def _make_plugin(
    id: str,
    enabled_by_default: bool = True,
    restricted: bool = False,
    allowed_roles: list[str] | None = None,
    is_always_on: bool = False,
    tools: list[str] | None = None,
) -> PluginConfigItem:
    return PluginConfigItem(
        id=id,
        name=id,
        module="fake.module",
        class_name="FakePlugin",
        enabled_by_default=enabled_by_default,
        is_always_on=is_always_on,
        restricted=restricted,
        allowed_roles=allowed_roles or [],
        tools=tools or [],
    )


PUBLIC_PLUGIN = _make_plugin("pub", enabled_by_default=True, tools=["pub_tool"])
RESTRICTED_ADMIN = _make_plugin(
    "restricted_admin",
    enabled_by_default=False,
    restricted=True,
    allowed_roles=["admin"],
    tools=["admin_tool"],
)
DISABLED_PLUGIN = _make_plugin(
    "disabled",
    enabled_by_default=False,
    restricted=False,
    tools=["disabled_tool"],
)


def _loader_with(*plugins: PluginConfigItem) -> PluginConfigLoader:
    loader = PluginConfigLoader()
    loader.plugins = list(plugins)
    loader._loaded = True
    return loader


def test_get_plugins_for_user_public_only():
    """普通用户只能看到 enabled_by_default=True 的插件"""
    loader = _loader_with(PUBLIC_PLUGIN, RESTRICTED_ADMIN, DISABLED_PLUGIN)
    result = loader.get_plugins_for_user(user_roles={"user"}, is_superuser=False)
    ids = [p.id for p in result]
    assert "pub" in ids
    assert "restricted_admin" not in ids
    assert "disabled" not in ids


def test_get_plugins_for_user_admin_sees_restricted():
    """admin 角色用户能看到 restricted + allowed_roles=["admin"] 的插件"""
    loader = _loader_with(PUBLIC_PLUGIN, RESTRICTED_ADMIN, DISABLED_PLUGIN)
    result = loader.get_plugins_for_user(user_roles={"admin"}, is_superuser=False)
    ids = [p.id for p in result]
    assert "pub" in ids
    assert "restricted_admin" in ids
    assert "disabled" not in ids


def test_get_plugins_for_user_superuser_sees_all_restricted():
    """超级用户能看到所有 restricted 插件，即使角色不在 allowed_roles 内"""
    loader = _loader_with(PUBLIC_PLUGIN, RESTRICTED_ADMIN, DISABLED_PLUGIN)
    result = loader.get_plugins_for_user(user_roles=set(), is_superuser=True)
    ids = [p.id for p in result]
    assert "pub" in ids
    assert "restricted_admin" in ids
    assert "disabled" not in ids


def test_get_plugins_for_user_mismatched_role():
    """用户角色不在 allowed_roles 中，看不到受限插件"""
    loader = _loader_with(RESTRICTED_ADMIN)
    result = loader.get_plugins_for_user(user_roles={"editor"}, is_superuser=False)
    assert result == []


def test_get_indexable_plugins():
    """get_indexable_plugins 返回公开和受限插件，不含纯禁用的"""
    loader = _loader_with(PUBLIC_PLUGIN, RESTRICTED_ADMIN, DISABLED_PLUGIN)
    result = loader.get_indexable_plugins()
    ids = [p.id for p in result]
    assert "pub" in ids
    assert "restricted_admin" in ids
    assert "disabled" not in ids


def test_get_enabled_plugins_unchanged():
    """get_enabled_plugins 行为不变：只返回 enabled_by_default=True"""
    loader = _loader_with(PUBLIC_PLUGIN, RESTRICTED_ADMIN, DISABLED_PLUGIN)
    result = loader.get_enabled_plugins()
    ids = [p.id for p in result]
    assert ids == ["pub"]


@pytest.mark.asyncio
async def test_build_tools_jit_allows_dynamic_skill_tools_when_skill_runner_enabled(
    monkeypatch,
):
    from app.services.agent.agent_service import agent_service
    from app.services.tools.tool_context_service import ToolContextService

    async def _fake_initialize(**_kwargs):
        return None

    async def _fake_search_tools(*_args, **_kwargs):
        return [ToolDefinition(name="skill__demo", description="demo", input_schema={})]

    async def _fake_get_user_tools(*_args, **_kwargs):
        return []

    monkeypatch.setattr(agent_service, "initialize", _fake_initialize)
    monkeypatch.setattr(
        agent_service,
        "tools",
        [
            ToolDefinition(
                name="consult_expert_network",
                description="expert",
                input_schema={},
            )
        ],
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.plugin_config_loader.get_plugins_for_user",
        lambda *_args, **_kwargs: [
            _make_plugin(
                "system.expert_network",
                enabled_by_default=True,
                is_always_on=True,
                tools=["consult_expert_network"],
            ),
            _make_plugin(
                "core.execution.skill_runner",
                enabled_by_default=True,
                is_always_on=True,
                tools=[],
            ),
        ],
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.tool_sync_service.search_tools",
        _fake_search_tools,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.mcp_discovery_service.get_active_tool_payloads",
        _fake_get_user_tools,
    )
    monkeypatch.setattr(settings, "MCP_TOOL_JIT_THRESHOLD", -1)

    tools = await ToolContextService().build_tools(
        session=None,
        user_id="5eec3ecf-9bf2-4e27-b245-4c9695f5d4d2",
        query="run demo skill",
    )

    names = [tool.name for tool in tools]
    assert "consult_expert_network" in names
    assert "skill__demo" in names


@pytest.mark.asyncio
async def test_build_tools_jit_blocks_dynamic_skill_tools_without_skill_runner(
    monkeypatch,
):
    from app.services.agent.agent_service import agent_service
    from app.services.tools.tool_context_service import ToolContextService

    async def _fake_initialize(**_kwargs):
        return None

    async def _fake_search_tools(*_args, **_kwargs):
        return [ToolDefinition(name="skill__demo", description="demo", input_schema={})]

    async def _fake_get_user_tools(*_args, **_kwargs):
        return []

    monkeypatch.setattr(agent_service, "initialize", _fake_initialize)
    monkeypatch.setattr(
        agent_service,
        "tools",
        [
            ToolDefinition(
                name="consult_expert_network",
                description="expert",
                input_schema={},
            )
        ],
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.qdrant_is_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.plugin_config_loader.get_plugins_for_user",
        lambda *_args, **_kwargs: [
            _make_plugin(
                "system.expert_network",
                enabled_by_default=True,
                is_always_on=True,
                tools=["consult_expert_network"],
            )
        ],
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.tool_sync_service.search_tools",
        _fake_search_tools,
    )
    monkeypatch.setattr(
        "app.services.tools.tool_context_service.mcp_discovery_service.get_active_tool_payloads",
        _fake_get_user_tools,
    )
    monkeypatch.setattr(settings, "MCP_TOOL_JIT_THRESHOLD", -1)

    tools = await ToolContextService().build_tools(
        session=None,
        user_id="5eec3ecf-9bf2-4e27-b245-4c9695f5d4d2",
        query="run demo skill",
    )

    names = [tool.name for tool in tools]
    assert "consult_expert_network" in names
    assert "skill__demo" not in names
