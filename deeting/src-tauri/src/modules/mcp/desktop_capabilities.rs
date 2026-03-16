use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::modules::mcp::types::CreateLocalAssistantRequest;
use crate::modules::memory::types::{CreateLocalMemoryRequest, LocalMemorySearchQuery};
use crate::modules::monitor::types::{LocalMonitorListQuery, LocalMonitorTaskCreateRequest};
use crate::modules::providers::types::{ProviderPreset, ProviderVerifyRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopCapabilityKind {
    DirectCapability,
    SystemAction,
}

#[derive(Debug, Clone, Copy)]
pub struct DesktopOfficialSkillCapabilitySpec {
    pub id: &'static str,
    pub kind: DesktopCapabilityKind,
    pub callable_from_official_skill: bool,
    pub admin_only: bool,
}

const OFFICIAL_SKILL_CAPABILITIES: &[DesktopOfficialSkillCapabilitySpec] = &[
    DesktopOfficialSkillCapabilitySpec {
        id: "skill_registry.refresh",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "skill_registry.diagnostics",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "memory.append",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "memory.search",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "monitor.create",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "monitor.list",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider_preset.list",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider_preset.upsert",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider.verify",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "web.fetch",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "assistant.onboarding.submit",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "cloud.provider_preset.list",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: true,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "cloud.provider_preset.upsert",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: true,
    },
];

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DesktopCurrentUserInfo {
    pub(crate) is_superuser: bool,
    #[serde(default)]
    pub(crate) permission_flags: HashMap<String, i64>,
}

pub fn find_official_skill_capability(
    capability_id: &str,
) -> Option<&'static DesktopOfficialSkillCapabilitySpec> {
    let normalized = capability_id.trim();
    OFFICIAL_SKILL_CAPABILITIES
        .iter()
        .find(|spec| spec.id == normalized)
}

pub async fn dispatch_official_skill_capability(
    capability_id: &str,
    arguments: &Value,
) -> Result<Option<Value>, String> {
    let Some(spec) = find_official_skill_capability(capability_id) else {
        return Ok(None);
    };

    if !spec.callable_from_official_skill {
        return Err(format!(
            "desktop capability '{}' is not callable from official skills",
            spec.id
        ));
    }
    if spec.admin_only {
        ensure_desktop_admin_role(spec.id).await?;
    }

    match spec.id {
        "skill_registry.refresh" => dispatch_skill_registry_refresh(arguments).await.map(Some),
        "skill_registry.diagnostics" => dispatch_skill_registry_diagnostics().await.map(Some),
        "memory.append" => dispatch_memory_append(arguments).await.map(Some),
        "memory.search" => dispatch_memory_search(arguments).await.map(Some),
        "monitor.create" => dispatch_monitor_create(arguments).await.map(Some),
        "monitor.list" => dispatch_monitor_list(arguments).await.map(Some),
        "provider_preset.list" => dispatch_provider_preset_list().await.map(Some),
        "provider_preset.upsert" => dispatch_provider_preset_upsert(arguments).await.map(Some),
        "provider.verify" => dispatch_provider_verify(arguments).await.map(Some),
        "web.fetch" => dispatch_web_fetch(arguments).await.map(Some),
        "assistant.onboarding.submit" => dispatch_assistant_onboarding_submit(arguments)
            .await
            .map(Some),
        "cloud.provider_preset.list" => dispatch_cloud_provider_preset_list().await.map(Some),
        "cloud.provider_preset.upsert" => dispatch_cloud_provider_preset_upsert(arguments)
            .await
            .map(Some),
        _ => Ok(None),
    }
}

fn global_app_state_required() -> Result<crate::state::AppState, String> {
    crate::state::global_app_state().ok_or_else(|| "global app state is unavailable".to_string())
}

fn global_app_handle_required() -> Result<tauri::AppHandle, String> {
    crate::state::global_app_handle().ok_or_else(|| "global app handle is unavailable".to_string())
}

fn parse_memory_append_request(arguments: &Value) -> Result<CreateLocalMemoryRequest, String> {
    let mut payload = arguments.clone();
    if let Value::Object(object) = &mut payload {
        if object.get("meta_info").is_none() {
            if let Some(metadata) = object.get("metadata").cloned() {
                object.insert("meta_info".to_string(), metadata);
            }
        }
    }
    serde_json::from_value(payload).map_err(|err| err.to_string())
}

fn parse_provider_preset(arguments: &Value) -> Result<ProviderPreset, String> {
    let payload = arguments
        .get("preset")
        .cloned()
        .unwrap_or_else(|| arguments.clone());
    serde_json::from_value(payload).map_err(|err| err.to_string())
}

async fn desktop_cloud_base_url(app_state: &crate::state::AppState) -> Result<String, String> {
    let base_url = app_state.mcp.cloud_base_url.read().await.clone();
    let normalized = base_url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        Err("cloud API base URL not configured".to_string())
    } else {
        Ok(normalized)
    }
}

async fn desktop_auth_token(app_state: &crate::state::AppState) -> Result<String, String> {
    let token = app_state
        .mcp
        .store
        .get_desktop_config("auth.token")
        .await
        .map_err(|err| err.to_string())?
        .unwrap_or_default();
    let normalized = token.trim().to_string();
    if normalized.is_empty() {
        Err("desktop auth token is missing".to_string())
    } else {
        Ok(normalized)
    }
}

pub(crate) async fn desktop_current_user_info_optional() -> Option<DesktopCurrentUserInfo> {
    desktop_current_user_info().await.ok()
}

pub(crate) fn desktop_user_can_access_restricted_asset(
    user: Option<&DesktopCurrentUserInfo>,
    restricted: bool,
    allowed_roles: &[String],
    id_hint: Option<&str>,
) -> bool {
    if !restricted {
        return true;
    }
    let Some(current_user) = user else {
        return false;
    };
    if current_user.is_superuser {
        return true;
    }

    let allowed = allowed_roles
        .iter()
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if allowed.iter().any(|role| role == "admin") {
        if matches!(
            id_hint,
            Some("official.skills.provider_registry")
                | Some("cloud.provider_preset.list")
                | Some("cloud.provider_preset.upsert")
        ) {
            return false;
        }
        return current_user
            .permission_flags
            .iter()
            .any(|(key, value)| key.starts_with("can_") && *value > 0);
    }

    false
}

async fn desktop_current_user_info() -> Result<DesktopCurrentUserInfo, String> {
    let app_state = global_app_state_required()?;
    let base_url = desktop_cloud_base_url(&app_state).await?;
    let token = desktop_auth_token(&app_state).await?;
    let response = reqwest::Client::new()
        .get(format!("{}/api/v1/users/me", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("users/me returned {}", response.status().as_u16()));
    }
    response
        .json::<DesktopCurrentUserInfo>()
        .await
        .map_err(|err| err.to_string())
}

async fn ensure_desktop_admin_role(capability_id: &str) -> Result<(), String> {
    let current_user = desktop_current_user_info().await?;
    let allowed = match capability_id {
        "cloud.provider_preset.list" | "cloud.provider_preset.upsert" => current_user.is_superuser,
        _ => true,
    };
    if allowed {
        Ok(())
    } else {
        Err(format!(
            "desktop capability '{}' requires an administrator account",
            capability_id
        ))
    }
}

async fn dispatch_skill_registry_refresh(arguments: &Value) -> Result<Value, String> {
    let app_handle = global_app_handle_required()?;
    let app_state = global_app_state_required()?;
    let count =
        crate::modules::mcp::commands::register_local_skills_inner(app_handle, &app_state).await?;
    Ok(json!({
        "status": "ok",
        "registered": count,
        "arguments": arguments,
    }))
}

async fn dispatch_skill_registry_diagnostics() -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    serde_json::to_value(
        crate::modules::mcp::commands::maintenance_impl::build_local_capability_registry_diagnostics(
            &app_state,
        )
        .await?,
    )
    .map_err(|err| err.to_string())
}

async fn dispatch_memory_append(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload = parse_memory_append_request(arguments)?;
    let item = app_state
        .memory
        .service
        .append(payload)
        .await
        .map_err(|err| err.to_string())?;
    serde_json::to_value(item).map_err(|err| err.to_string())
}

async fn dispatch_memory_search(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload: LocalMemorySearchQuery =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let result = app_state
        .memory
        .service
        .search(payload)
        .await
        .map_err(|err| err.to_string())?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_monitor_create(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload: LocalMonitorTaskCreateRequest =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let result = app_state.monitor.create_task(payload).await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_monitor_list(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload = if arguments.is_null() || arguments.as_object().is_some_and(|o| o.is_empty()) {
        LocalMonitorListQuery {
            skip: None,
            limit: None,
            status: None,
        }
    } else {
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?
    };
    let result = app_state.monitor.list_tasks(payload).await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_provider_preset_list() -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let presets = app_state
        .providers
        .store
        .list_presets()
        .await
        .map_err(|err| err.to_string())?;
    serde_json::to_value(presets).map_err(|err| err.to_string())
}

async fn dispatch_provider_preset_upsert(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let preset = parse_provider_preset(arguments)?;
    let mut presets = app_state
        .providers
        .store
        .list_presets()
        .await
        .map_err(|err| err.to_string())?;
    let mut updated = false;
    if let Some(existing) = presets.iter_mut().find(|item| item.slug == preset.slug) {
        *existing = preset.clone();
        updated = true;
    } else {
        presets.push(preset.clone());
    }
    app_state
        .providers
        .store
        .replace_presets(presets)
        .await
        .map_err(|err| err.to_string())?;
    Ok(json!({
        "status": "ok",
        "updated": updated,
        "preset": preset,
    }))
}

async fn dispatch_cloud_provider_preset_list() -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let base_url = desktop_cloud_base_url(&app_state).await?;
    let token = desktop_auth_token(&app_state).await?;
    let response = reqwest::Client::new()
        .get(format!("{}/api/v1/admin/provider-presets", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "admin/provider-presets returned {}: {}",
            status.as_u16(),
            body
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())
}

async fn dispatch_cloud_provider_preset_upsert(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let base_url = desktop_cloud_base_url(&app_state).await?;
    let token = desktop_auth_token(&app_state).await?;
    let preset = parse_provider_preset(arguments)?;
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/v1/admin/provider-presets/upsert-from-desktop",
            base_url
        ))
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "preset": preset }))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "admin/provider-presets/upsert-from-desktop returned {}: {}",
            status.as_u16(),
            body
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())
}

async fn dispatch_provider_verify(arguments: &Value) -> Result<Value, String> {
    let payload: ProviderVerifyRequest =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let result = crate::modules::providers::commands::verify_local_provider(payload).await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_web_fetch(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let tool = crate::modules::mcp::commands::runtime::resolve_callable_mcp_tool_by_name(
        app_state.mcp.store.as_ref(),
        "fetch_web_content",
    )
    .await
    .map_err(|err| err.to_string())?;
    crate::modules::mcp::commands::runtime::execute_mcp_tool(
        app_state.mcp.store.as_ref(),
        &tool,
        arguments,
    )
    .await
}

async fn dispatch_assistant_onboarding_submit(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let asset_type = arguments
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or("");
    if asset_type != "assistant" {
        return Err(format!(
            "desktop capability 'assistant.onboarding.submit' does not support asset_type '{}'",
            asset_type
        ));
    }
    let payload = arguments
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let create_req: CreateLocalAssistantRequest =
        serde_json::from_value(payload).map_err(|err| err.to_string())?;
    let id = app_state
        .mcp
        .store
        .create_local_assistant(create_req)
        .await
        .map_err(|err| err.to_string())?;
    Ok(json!({
        "action": "created",
        "id": id,
    }))
}
