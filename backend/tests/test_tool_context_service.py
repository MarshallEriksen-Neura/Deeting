import importlib

from app.core.plugin_config import PluginConfigItem, PluginConfigLoader


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
