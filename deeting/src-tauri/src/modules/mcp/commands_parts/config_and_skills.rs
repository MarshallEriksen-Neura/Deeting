use super::common_impl::to_string;
use super::support::*;

#[tauri::command]
pub async fn sync_official_skills_index(app_state: State<'_, AppState>) -> Result<usize, String> {
    let state = &app_state.mcp;
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/plugin-market/?limit=100",
        base_url.trim_end_matches('/')
    );

    let response = state.client.get(&url).send().await.map_err(to_string)?;
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
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("cloud base url is required".to_string());
    }
    *state.mcp.cloud_base_url.write().await = normalized;
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
    let url = state.mcp.local_gateway.base_url.read().await.clone();
    Ok(url)
}
