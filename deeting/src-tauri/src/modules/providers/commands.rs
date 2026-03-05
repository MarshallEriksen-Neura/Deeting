use std::time::Instant;

use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::modules::providers::types::{
    BanditArmState, BanditFeedbackRequest, CreateInstanceRequest, ProviderInstance, ProviderModel,
    ProviderModelTestRequest, ProviderModelTestResponse, ProviderModelUpdateRequest,
    ProviderModelsQuickAddRequest, ProviderPreset, ProviderVerifyRequest, ProviderVerifyResponse,
    UpdateInstanceRequest, UserEmbeddingConfig, UserEmbeddingConfigUpdateRequest, UserSecretary,
    UserSecretaryUpdateRequest,
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
pub async fn verify_local_provider(
    payload: ProviderVerifyRequest,
) -> Result<ProviderVerifyResponse, String> {
    let protocol = normalize_protocol(payload.protocol.as_deref());
    let started = Instant::now();
    let result = fetch_model_ids_from_upstream(
        &payload.base_url,
        Some(payload.api_key.as_str()),
        Some(protocol.as_str()),
        payload.auto_append_v1,
    )
    .await?;

    let latency_ms = started.elapsed().as_millis() as i64;
    let has_models = !result.ids.is_empty();

    Ok(ProviderVerifyResponse {
        success: true,
        message: if has_models {
            "Verification successful".to_string()
        } else {
            "Verification successful, but no models returned".to_string()
        },
        latency_ms,
        discovered_models: result.ids,
        probe_url: Some(result.endpoint),
    })
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

    let result = fetch_model_ids_from_upstream(
        &connection.base_url,
        connection.secret_key.as_deref(),
        connection.protocol.as_deref(),
        connection.auto_append_v1,
    )
    .await?;
    let model_ids = result.ids;
    if model_ids.is_empty() {
        return Err(format!(
            "no models discovered from upstream: {}",
            result.endpoint
        ));
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
    protocol: Option<&str>,
    auto_append_v1: Option<bool>,
) -> Result<UpstreamModelsFetchResult, String> {
    let client = reqwest::Client::new();
    let normalized_protocol = normalize_protocol(protocol);
    let candidates = build_models_endpoints(base_url, &normalized_protocol, auto_append_v1);
    if candidates.is_empty() {
        return Err("base_url is empty".to_string());
    }
    let mut last_error = None;

    for endpoint in candidates {
        let mut request = client.get(&endpoint);
        request = apply_models_auth_headers(request, &normalized_protocol, secret_key);

        match request.send().await {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let body_text = response.text().await.unwrap_or_default();
                    let parsed_body = serde_json::from_str::<Value>(&body_text).ok();
                    let upstream_error = parsed_body
                        .as_ref()
                        .and_then(extract_error_message)
                        .map(|message| format!("sync failed: {message} ({endpoint})"));
                    last_error = upstream_error
                        .or_else(|| Some(format!("sync failed: {status} ({endpoint})")));

                    // Auth failures on the primary compatible endpoint are definitive;
                    // falling back to /models often returns HTML and obscures the real cause.
                    if status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::FORBIDDEN
                    {
                        break;
                    }
                    continue;
                }
                let content_type = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
                let body_text = match response.text().await {
                    Ok(value) => value,
                    Err(err) => {
                        last_error =
                            Some(format!("failed to read model list from {endpoint}: {err}"));
                        continue;
                    }
                };

                match decode_model_ids_from_body(&endpoint, &body_text, content_type.as_deref()) {
                    Ok(ids) => return Ok(UpstreamModelsFetchResult { ids, endpoint }),
                    Err(err) => {
                        last_error = Some(err);
                        continue;
                    }
                }
            }
            Err(err) => {
                last_error = Some(format!("{err} ({endpoint})"));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "failed to sync models from upstream".to_string()))
}

struct UpstreamModelsFetchResult {
    ids: Vec<String>,
    endpoint: String,
}

fn decode_model_ids_from_body(
    endpoint: &str,
    body_text: &str,
    content_type: Option<&str>,
) -> Result<Vec<String>, String> {
    let body: Value = serde_json::from_str(body_text).map_err(|err| {
        if let Some(content_type) = content_type {
            format!(
                "failed to parse model list from {endpoint} (content-type: {content_type}): {err}"
            )
        } else {
            format!("failed to parse model list from {endpoint}: {err}")
        }
    })?;

    let ids = extract_model_ids(&body);
    if !ids.is_empty() {
        return Ok(ids);
    }

    if let Some(message) = extract_error_message(&body) {
        return Err(format!("sync failed: {message} ({endpoint})"));
    }

    Err(format!("no models discovered from upstream: {endpoint}"))
}

fn normalize_protocol(protocol: Option<&str>) -> String {
    protocol
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".to_string())
}

fn apply_models_auth_headers(
    request: reqwest::RequestBuilder,
    protocol: &str,
    secret_key: Option<&str>,
) -> reqwest::RequestBuilder {
    let Some(value) = secret_key.map(str::trim).filter(|item| !item.is_empty()) else {
        return request;
    };

    if protocol.contains("anthropic") || protocol.contains("claude") {
        return request
            .header("x-api-key", value)
            .header("anthropic-version", "2023-06-01");
    }

    request.bearer_auth(value)
}

fn build_models_endpoints(
    base_url: &str,
    protocol: &str,
    auto_append_v1: Option<bool>,
) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return vec![];
    }

    if protocol.contains("anthropic") || protocol.contains("claude") {
        if base.ends_with("/v1") {
            return vec![format!("{base}/models")];
        }
        return vec![format!("{base}/v1/models"), format!("{base}/models")];
    }

    if base.ends_with("/v1") {
        return vec![
            format!("{base}/models"),
            format!("{}/models", base.trim_end_matches("/v1")),
        ];
    }

    if auto_append_v1.unwrap_or(true) {
        vec![format!("{base}/v1/models"), format!("{base}/models")]
    } else {
        vec![format!("{base}/models"), format!("{base}/v1/models")]
    }
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

#[cfg(test)]
mod tests {
    use super::decode_model_ids_from_body;

    #[test]
    fn decode_model_ids_from_body_extracts_ids_from_data() {
        let body = r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#;
        let ids = decode_model_ids_from_body("https://example.com/v1/models", body, None)
            .expect("should parse model ids");
        assert_eq!(ids, vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]);
    }

    #[test]
    fn decode_model_ids_from_body_reports_parse_error() {
        let err = decode_model_ids_from_body(
            "https://example.com/models",
            "<html>not-json</html>",
            Some("text/html"),
        )
        .expect_err("should fail for non-json body");
        assert!(err.contains("failed to parse model list from https://example.com/models"));
        assert!(err.contains("content-type: text/html"));
    }

    #[test]
    fn decode_model_ids_from_body_reports_empty_models() {
        let err = decode_model_ids_from_body(
            "https://example.com/v1/models",
            r#"{"object":"list","data":[]}"#,
            Some("application/json"),
        )
        .expect_err("should fail when no models are present");
        assert_eq!(
            err,
            "no models discovered from upstream: https://example.com/v1/models"
        );
    }
}
