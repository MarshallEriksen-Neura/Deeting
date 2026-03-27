use serde_json::Value;

pub(crate) mod store;

pub(crate) use crate::modules::desktop_runtime::desktop_capabilities::{
    DesktopCurrentUserInfo, DesktopOfficialSkillCapabilitySpec,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OfficialSkillHostToolRoute {
    DesktopCapability,
    SearchSdk,
    Unsupported,
}

pub(crate) async fn build_search_sdk_result(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
) -> Value {
    crate::modules::desktop_runtime::runtime::capability_discovery::build_capability_search_result(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
    )
    .await
}

pub(crate) async fn dispatch_search_sdk(
    mcp_store: &crate::modules::mcp::store::McpStore,
    arguments: &Value,
) -> Result<Value, String> {
    let app_state = crate::state::global_app_state()
        .ok_or_else(|| "global app state is unavailable".to_string())?;
    let query = arguments.get("query").and_then(Value::as_str).unwrap_or("");
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(8);

    Ok(build_search_sdk_result(
        mcp_store,
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        query,
        limit,
    )
    .await)
}

pub(crate) fn resolve_official_skill_host_tool_route(
    tool_name: &str,
) -> OfficialSkillHostToolRoute {
    let normalized_tool_name = tool_name.trim();
    if normalized_tool_name.is_empty() {
        return OfficialSkillHostToolRoute::Unsupported;
    }

    if find_official_skill_capability(normalized_tool_name).is_some() {
        return OfficialSkillHostToolRoute::DesktopCapability;
    }

    match normalized_tool_name {
        "search_sdk" => OfficialSkillHostToolRoute::SearchSdk,
        _ => OfficialSkillHostToolRoute::Unsupported,
    }
}

pub(crate) fn find_official_skill_capability(
    capability_id: &str,
) -> Option<&'static DesktopOfficialSkillCapabilitySpec> {
    crate::modules::desktop_runtime::desktop_capabilities::find_official_skill_capability(
        capability_id,
    )
}

pub(crate) async fn dispatch_official_skill_capability(
    capability_id: &str,
    arguments: &Value,
) -> Result<Option<Value>, String> {
    crate::modules::desktop_runtime::desktop_capabilities::dispatch_official_skill_capability(
        capability_id,
        arguments,
    )
    .await
}

pub(crate) async fn dispatch_internal_skill_host_tool(
    mcp_store: &crate::modules::mcp::store::McpStore,
    tool_name: &str,
    arguments: &Value,
) -> Result<Option<Value>, String> {
    match resolve_official_skill_host_tool_route(tool_name) {
        OfficialSkillHostToolRoute::DesktopCapability => {
            dispatch_official_skill_capability(tool_name, arguments).await
        }
        OfficialSkillHostToolRoute::SearchSdk => {
            dispatch_search_sdk(mcp_store, arguments).await.map(Some)
        }
        OfficialSkillHostToolRoute::Unsupported => Ok(None),
    }
}

pub(crate) async fn current_desktop_user_info_optional() -> Option<DesktopCurrentUserInfo> {
    crate::modules::desktop_runtime::desktop_capabilities::desktop_current_user_info_optional()
        .await
}

pub(crate) fn current_user_can_access_restricted_asset(
    user: Option<&DesktopCurrentUserInfo>,
    restricted: bool,
    allowed_roles: &[String],
    id_hint: Option<&str>,
) -> bool {
    crate::modules::desktop_runtime::desktop_capabilities::desktop_user_can_access_restricted_asset(
        user,
        restricted,
        allowed_roles,
        id_hint,
    )
}
