use std::time::Instant;

use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::modules::providers::types::{
    BanditArmState, BanditFeedbackRequest, CreateInstanceRequest, ProviderInstance, ProviderModel,
    ProviderModelTestRequest, ProviderModelTestResponse, ProviderModelUpdateRequest,
    ProviderModelsQuickAddRequest, ProviderPreset, UpdateInstanceRequest, UserEmbeddingConfig,
    UserEmbeddingConfigUpdateRequest, UserSecretary, UserSecretaryUpdateRequest,
};
use crate::state::AppState;

#[tauri::command]
pub async fn list_local_provider_presets(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderPreset>, String> {
    state
        .providers
        .store
        .list_presets()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_local_user_secretary(state: State<'_, AppState>) -> Result<UserSecretary, String> {
    state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_local_user_secretary(
    state: State<'_, AppState>,
    payload: UserSecretaryUpdateRequest,
) -> Result<UserSecretary, String> {
    state
        .providers
        .store
        .update_user_secretary(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_local_user_embedding_config(
    state: State<'_, AppState>,
) -> Result<UserEmbeddingConfig, String> {
    state
        .providers
        .store
        .get_or_create_user_embedding_config()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_local_user_embedding_config(
    state: State<'_, AppState>,
    payload: UserEmbeddingConfigUpdateRequest,
) -> Result<UserEmbeddingConfig, String> {
    state
        .providers
        .store
        .update_user_embedding_config(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replace_local_provider_presets(
    state: State<'_, AppState>,
    presets: Vec<ProviderPreset>,
) -> Result<usize, String> {
    state
        .providers
        .store
        .replace_presets(presets)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_local_provider_instances(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderInstance>, String> {
    state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_local_provider_instance(
    state: State<'_, AppState>,
    payload: CreateInstanceRequest,
) -> Result<ProviderInstance, String> {
    state
        .providers
        .store
        .create_instance(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_local_provider_instance(
    state: State<'_, AppState>,
    instance_id: String,
    payload: UpdateInstanceRequest,
) -> Result<ProviderInstance, String> {
    state
        .providers
        .store
        .update_instance(&instance_id, payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_local_provider_instance(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<(), String> {
    state
        .providers
        .store
        .delete_instance(&instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_local_provider_models(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<Vec<ProviderModel>, String> {
    let id = Uuid::parse_str(&instance_id).map_err(|e| e.to_string())?;
    state
        .providers
        .store
        .list_models(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_local_provider_models(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<Vec<ProviderModel>, String> {
    let id = Uuid::parse_str(&instance_id).map_err(|e| e.to_string())?;
    let connection = state
        .providers
        .store
        .get_instance_connection(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "instance not found".to_string())?;

    let model_ids =
        fetch_model_ids_from_upstream(&connection.base_url, connection.secret_key.as_deref())
            .await?;
    if model_ids.is_empty() {
        return Err("no models discovered from upstream".to_string());
    }

    state
        .providers
        .store
        .quick_add_models(&id, model_ids, Some("chat".to_string()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_add_local_provider_models(
    state: State<'_, AppState>,
    instance_id: String,
    payload: ProviderModelsQuickAddRequest,
) -> Result<Vec<ProviderModel>, String> {
    let id = Uuid::parse_str(&instance_id).map_err(|e| e.to_string())?;
    state
        .providers
        .store
        .quick_add_models(&id, payload.models, payload.capability)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_local_provider_model(
    state: State<'_, AppState>,
    model_id: String,
    payload: ProviderModelUpdateRequest,
) -> Result<ProviderModel, String> {
    let id = Uuid::parse_str(&model_id).map_err(|e| e.to_string())?;
    state
        .providers
        .store
        .update_model(&id, payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_local_provider_model(
    state: State<'_, AppState>,
    model_id: String,
    payload: Option<ProviderModelTestRequest>,
) -> Result<ProviderModelTestResponse, String> {
    let id = Uuid::parse_str(&model_id).map_err(|e| e.to_string())?;
    let model = state
        .providers
        .store
        .get_model(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "model not found".to_string())?;

    let connection = state
        .providers
        .store
        .get_instance_connection(&model.instance_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "instance not found".to_string())?;

    let prompt = payload
        .and_then(|item| item.prompt)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ping".to_string());

    let endpoint = build_upstream_endpoint(&connection.base_url, &model.upstream_path);
    let body = serde_json::json!({
        "model": model.model_id,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false
    });

    let started = Instant::now();
    let mut request = reqwest::Client::new().post(&endpoint).json(&body);
    if let Some(secret_key) = connection.secret_key.as_deref() {
        if !secret_key.trim().is_empty() {
            request = request.bearer_auth(secret_key.trim());
        }
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let body_json: Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({ "raw": "failed to parse json response" }));

    let error = if status.is_success() {
        None
    } else {
        extract_error_message(&body_json)
            .or_else(|| Some(format!("upstream status {}", status.as_u16())))
    };

    Ok(ProviderModelTestResponse {
        success: status.is_success(),
        latency_ms: started.elapsed().as_millis() as i64,
        status_code: status.as_u16() as i32,
        upstream_url: endpoint,
        response_body: Some(body_json),
        error,
    })
}

#[tauri::command]
pub async fn get_local_bandit_arm_state(
    state: State<'_, AppState>,
    scene: String,
    arm_id: String,
) -> Result<Option<BanditArmState>, String> {
    state
        .providers
        .store
        .get_bandit_arm_state(&scene, &arm_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_local_bandit_arm_states(
    state: State<'_, AppState>,
    scene: Option<String>,
) -> Result<Vec<BanditArmState>, String> {
    state
        .providers
        .store
        .list_bandit_arm_states(scene.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_local_bandit_feedback(
    state: State<'_, AppState>,
    payload: BanditFeedbackRequest,
) -> Result<BanditArmState, String> {
    state
        .providers
        .store
        .record_bandit_feedback(payload)
        .await
        .map_err(|e| e.to_string())
}

async fn fetch_model_ids_from_upstream(
    base_url: &str,
    secret_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let candidates = build_models_endpoints(base_url);
    let mut last_error = None;

    for endpoint in candidates {
        let mut request = client.get(&endpoint);
        if let Some(key) = secret_key {
            let value = key.trim();
            if !value.is_empty() {
                request = request.bearer_auth(value);
            }
        }

        match request.send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    last_error = Some(format!("sync failed: {}", response.status()));
                    continue;
                }
                let body: Value = response.json().await.map_err(|e| e.to_string())?;
                let ids = extract_model_ids(&body);
                if !ids.is_empty() {
                    return Ok(ids);
                }
                last_error = Some("upstream returned empty model list".to_string());
            }
            Err(err) => {
                last_error = Some(err.to_string());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "failed to sync models from upstream".to_string()))
}

fn build_models_endpoints(base_url: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return vec![];
    }

    if base.ends_with("/v1") {
        return vec![
            format!("{base}/models"),
            format!("{}/models", base.trim_end_matches("/v1")),
        ];
    }

    vec![format!("{base}/v1/models"), format!("{base}/models")]
}

fn build_upstream_endpoint(base_url: &str, upstream_path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let path = upstream_path.trim().trim_start_matches('/').to_string();
    if path.is_empty() {
        if base.ends_with("/v1") {
            return format!("{base}/chat/completions");
        }
        return format!("{base}/v1/chat/completions");
    }
    format!("{base}/{path}")
}

fn extract_model_ids(value: &Value) -> Vec<String> {
    let mut ids = Vec::new();

    if let Some(array) = value.get("data").and_then(|item| item.as_array()) {
        for item in array {
            if let Some(id) = item.get("id").and_then(|field| field.as_str()) {
                let trimmed = id.trim();
                if !trimmed.is_empty() {
                    ids.push(trimmed.to_string());
                }
            }
        }
    }

    if ids.is_empty() {
        if let Some(array) = value.as_array() {
            for item in array {
                if let Some(id) = item.as_str() {
                    let trimmed = id.trim();
                    if !trimmed.is_empty() {
                        ids.push(trimmed.to_string());
                    }
                } else if let Some(id) = item.get("id").and_then(|field| field.as_str()) {
                    let trimmed = id.trim();
                    if !trimmed.is_empty() {
                        ids.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    ids.sort();
    ids.dedup();
    ids
}

fn extract_error_message(value: &Value) -> Option<String> {
    if let Some(message) = value
        .get("error")
        .and_then(|item| item.get("message"))
        .and_then(|item| item.as_str())
    {
        let trimmed = message.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(message) = value.get("message").and_then(|item| item.as_str()) {
        let trimmed = message.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}
