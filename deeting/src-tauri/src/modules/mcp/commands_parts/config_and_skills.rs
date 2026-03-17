use super::support::*;
use super::{common_impl::to_string, reindex_local_skill_bundle_asset};

#[tauri::command]
pub async fn sync_official_skills_index(app_state: State<'_, AppState>) -> Result<usize, String> {
    let state = &app_state.mcp;
    let base_url = state.transport.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/plugin-market/?limit=100",
        base_url.trim_end_matches('/')
    );

    let response = state
        .transport
        .client
        .get(&url)
        .send()
        .await
        .map_err(to_string)?;
    if !response.status().is_success() {
        return Err("failed to fetch marketplace index".to_string());
    }

    let skills: Vec<serde_json::Value> = response.json().await.map_err(to_string)?;
    let count = skills.len();

    for skill in skills {
        let id = skill["id"].as_str().unwrap_or("").to_string();
        let name = skill["name"].as_str().unwrap_or("").to_string();
        let desc = skill["description"].as_str().unwrap_or("").to_string();

        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            let text = format!("name: {}\ndescription: {}", name, desc);
            if let Ok(vector) = app_state_clone.providers.embedding.embed_text(&text).await {
                let _ = app_state_clone
                    .memory
                    .service
                    .upsert_asset(
                        id,
                        name,
                        desc,
                        "skill".to_string(),
                        "cloud_mirror".to_string(),
                        None,
                        vector,
                        Some(skill),
                    )
                    .await;
            }
        });
    }

    Ok(count)
}

#[tauri::command]
pub async fn enable_local_skill(
    state: State<'_, AppState>,
    skill_id: Option<String>,
    #[allow(non_snake_case)] skillId: Option<String>,
) -> Result<(), String> {
    let normalized_skill_id = skillId.or(skill_id).unwrap_or_default().trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skillId is required".to_string());
    }

    let updated = state
        .mcp
        .store
        .enable_local_skills_by_ids(&[normalized_skill_id.clone()])
        .await
        .map_err(to_string)?;
    if updated <= 0 {
        return Err(format!(
            "local skill {} is not installed and cannot be enabled",
            normalized_skill_id
        ));
    }

    reindex_local_skill_bundle_asset(state.inner(), &normalized_skill_id).await?;

    Ok(())
}

#[tauri::command]
pub async fn disable_local_skill(
    state: State<'_, AppState>,
    skill_id: Option<String>,
    #[allow(non_snake_case)] skillId: Option<String>,
) -> Result<(), String> {
    let normalized_skill_id = skillId.or(skill_id).unwrap_or_default().trim().to_string();
    if normalized_skill_id.is_empty() {
        return Err("skillId is required".to_string());
    }

    let updated = state
        .mcp
        .store
        .disable_local_skills_by_ids(&[normalized_skill_id.clone()])
        .await
        .map_err(to_string)?;
    if updated <= 0 {
        return Err(format!(
            "local skill {} is not installed or already disabled",
            normalized_skill_id
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("cloud base url is required".to_string());
    }
    *state.mcp.transport.cloud_base_url.write().await = normalized;
    Ok(())
}

#[tauri::command]
pub async fn get_desktop_config(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .mcp
        .store
        .get_desktop_config(key.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_effective_desktop_scout_base_url(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    resolve_effective_desktop_scout_base_url(state.mcp.store.as_ref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_desktop_config(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("config key is required".to_string());
    }
    state
        .mcp
        .store
        .set_desktop_config(&key, value.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_gateway_url(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let url = state
        .mcp
        .transport
        .local_gateway
        .base_url
        .read()
        .await
        .clone();
    Ok(url)
}
