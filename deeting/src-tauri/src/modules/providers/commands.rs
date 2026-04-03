use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;
use sqlx::Row;
use tauri::State;
use uuid::Uuid;

use crate::modules::providers::types::{
    BanditArmState, BanditFeedbackRequest, CreateInstanceRequest, DesktopObjectStorageConfig,
    DesktopObjectStorageConfigUpdateRequest, DesktopObjectStorageReadRequest,
    DesktopObjectStorageReadTicket, DesktopObjectStorageUploadRequest,
    DesktopObjectStorageUploadTicket, LocalModelPoolMemberStatus, LocalModelPoolSessionBinding,
    LocalModelPoolStatus, LocalProviderHealth, ProviderInstance, ProviderModel,
    ProviderModelTestRequest, ProviderModelTestResponse, ProviderModelUpdateRequest,
    ProviderModelsQuickAddRequest, ProviderPreset, ProviderVerifyRequest, ProviderVerifyResponse,
    UpdateInstanceRequest, UserEmbeddingConfig, UserEmbeddingConfigUpdateRequest, UserSecretary,
    UserSecretaryUpdateRequest,
};
use crate::state::AppState;

fn provider_latency_from_meta(meta: &Value) -> i64 {
    let Some(object) = meta.as_object() else {
        return 0;
    };

    for key in ["latency_ms", "avg_latency_ms", "ttft_ms"] {
        let value = object
            .get(key)
            .and_then(|item| item.as_f64())
            .unwrap_or(0.0);
        if value.is_finite() && value > 0.0 {
            return value.round() as i64;
        }
    }

    0
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn normalize_pool_key(model: &ProviderModel) -> String {
    model
        .unified_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| model.model_id.trim())
        .to_string()
}

fn compute_health_score(
    provider_count: i64,
    active_provider_count: i64,
    success_rate: Option<f64>,
    avg_latency_ms: Option<f64>,
) -> i64 {
    if provider_count <= 0 {
        return 0;
    }

    let availability = (active_provider_count as f64 / provider_count as f64).clamp(0.0, 1.0);
    let success = success_rate.unwrap_or(0.65).clamp(0.0, 1.0);
    let latency = match avg_latency_ms.unwrap_or(1200.0) {
        value if value <= 600.0 => 1.0,
        value if value <= 1200.0 => 0.82,
        value if value <= 2400.0 => 0.58,
        value if value <= 4000.0 => 0.35,
        _ => 0.2,
    };

    ((availability * 0.5 + success * 0.35 + latency * 0.15) * 100.0).round() as i64
}

#[tauri::command]
pub async fn list_local_model_pools_status(
    state: State<'_, AppState>,
) -> Result<Vec<LocalModelPoolStatus>, String> {
    use crate::modules::providers::store::BANDIT_DEFAULT_SCENE;

    let instances = state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|e| e.to_string())?;
    let instance_map: HashMap<String, ProviderInstance> = instances
        .into_iter()
        .map(|instance| (instance.id.to_string(), instance))
        .collect();

    let models = state
        .providers
        .store
        .list_active_models()
        .await
        .map_err(|e| e.to_string())?;
    let models_by_provider_id: HashMap<String, ProviderModel> = models
        .iter()
        .cloned()
        .map(|model| (model.id.to_string(), model))
        .collect();

    let arm_states = state
        .providers
        .store
        .list_bandit_arm_states(Some(BANDIT_DEFAULT_SCENE.to_string()))
        .await
        .map_err(|e| e.to_string())?;
    let arm_map: HashMap<String, BanditArmState> = arm_states
        .into_iter()
        .filter_map(|state| state.arm_id.clone().map(|arm_id| (arm_id, state)))
        .collect();

    let session_rows = sqlx::query(
        r#"
        SELECT
          id,
          title,
          pinned_model_key,
          pinned_provider_model_id,
          last_active_at,
          updated_at
        FROM conversation_session
        WHERE pinned_provider_model_id IS NOT NULL
        ORDER BY COALESCE(last_active_at, updated_at, created_at) DESC;
        "#,
    )
    .fetch_all(&state.mcp.store.pool)
    .await
    .map_err(|err| err.to_string())?;

    let mut bindings_by_pool: HashMap<String, Vec<LocalModelPoolSessionBinding>> = HashMap::new();
    let mut pinned_counts: HashMap<String, i64> = HashMap::new();
    for row in session_rows {
        let Some(pinned_provider_model_id) = row
            .try_get::<Option<String>, _>("pinned_provider_model_id")
            .map_err(|err| err.to_string())?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        let pool_key = row
            .try_get::<Option<String>, _>("pinned_model_key")
            .map_err(|err| err.to_string())?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                models_by_provider_id
                    .get(&pinned_provider_model_id)
                    .map(normalize_pool_key)
            });
        let Some(pool_key) = pool_key else {
            continue;
        };

        *pinned_counts
            .entry(pinned_provider_model_id.clone())
            .or_insert(0) += 1;
        bindings_by_pool
            .entry(pool_key)
            .or_default()
            .push(LocalModelPoolSessionBinding {
                session_id: row
                    .try_get::<String, _>("id")
                    .map_err(|err| err.to_string())?,
                title: row
                    .try_get::<Option<String>, _>("title")
                    .map_err(|err| err.to_string())?,
                pinned_provider_model_id,
                last_active_at: row
                    .try_get::<Option<String>, _>("last_active_at")
                    .map_err(|err| err.to_string())?,
                updated_at: row
                    .try_get::<Option<String>, _>("updated_at")
                    .map_err(|err| err.to_string())?,
            });
    }

    let current_time = now_rfc3339();
    let mut grouped_models: HashMap<String, Vec<ProviderModel>> = HashMap::new();
    for model in models {
        grouped_models
            .entry(normalize_pool_key(&model))
            .or_default()
            .push(model);
    }

    let mut pools = grouped_models
        .into_iter()
        .map(|(pool_key, pool_models)| {
            let mut total_trials = 0_i64;
            let mut total_successes = 0_i64;
            let mut total_failures = 0_i64;
            let mut latency_sum = 0.0_f64;
            let mut latency_count = 0_i64;
            let mut cooling_down_count = 0_i64;

            let mut members = pool_models
                .iter()
                .map(|model| {
                    let arm = arm_map.get(&model.id.to_string());
                    let is_cooling_down = arm
                        .and_then(|state| state.cooldown_until.as_deref())
                        .map(|until| until > current_time.as_str())
                        .unwrap_or(false);
                    if is_cooling_down {
                        cooling_down_count += 1;
                    }

                    let total_trials_for_model = arm.map(|state| state.total_trials).unwrap_or(0);
                    let successes = arm.map(|state| state.successes).unwrap_or(0);
                    let failures = arm.map(|state| state.failures).unwrap_or(0);
                    total_trials += total_trials_for_model;
                    total_successes += successes;
                    total_failures += failures;

                    let avg_latency_ms = if let Some(state) = arm {
                        if state.total_trials > 0 && state.total_latency_ms > 0 {
                            let value = state.total_latency_ms as f64 / state.total_trials as f64;
                            latency_sum += value;
                            latency_count += 1;
                            Some(value)
                        } else {
                            let fallback = provider_latency_from_meta(&model.extra_meta);
                            if fallback > 0 {
                                let value = fallback as f64;
                                latency_sum += value;
                                latency_count += 1;
                                Some(value)
                            } else {
                                None
                            }
                        }
                    } else {
                        let fallback = provider_latency_from_meta(&model.extra_meta);
                        if fallback > 0 {
                            let value = fallback as f64;
                            latency_sum += value;
                            latency_count += 1;
                            Some(value)
                        } else {
                            None
                        }
                    };

                    let pinned_session_count = pinned_counts
                        .get(&model.id.to_string())
                        .copied()
                        .unwrap_or(0);
                    let instance = instance_map.get(&model.instance_id.to_string());
                    let success_rate = if total_trials_for_model > 0 {
                        Some(successes as f64 / total_trials_for_model as f64)
                    } else {
                        None
                    };

                    LocalModelPoolMemberStatus {
                        provider_model_id: model.id.to_string(),
                        instance_id: model.instance_id.to_string(),
                        instance_name: instance
                            .map(|item| item.name.clone())
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "Local Provider".to_string()),
                        provider: instance.map(|item| item.preset_slug.clone()),
                        model_id: model.model_id.clone(),
                        unified_model_id: model.unified_model_id.clone(),
                        display_name: model.display_name.clone(),
                        status: if is_cooling_down {
                            "cooldown".to_string()
                        } else if pinned_session_count > 0 {
                            "active".to_string()
                        } else if total_trials_for_model > 0 {
                            "ready".to_string()
                        } else {
                            "idle".to_string()
                        },
                        success_rate,
                        avg_latency_ms,
                        total_trials: total_trials_for_model,
                        successes,
                        failures,
                        cooldown_until: arm.and_then(|state| state.cooldown_until.clone()),
                        is_pinned: pinned_session_count > 0,
                        pinned_session_count,
                    }
                })
                .collect::<Vec<_>>();

            members.sort_by(|left, right| {
                right
                    .pinned_session_count
                    .cmp(&left.pinned_session_count)
                    .then_with(|| left.instance_name.cmp(&right.instance_name))
            });

            let bindings = bindings_by_pool.remove(&pool_key).unwrap_or_default();
            let provider_count = members.len() as i64;
            let active_provider_count = provider_count.saturating_sub(cooling_down_count);
            let success_rate = if total_trials > 0 {
                Some(total_successes as f64 / total_trials as f64)
            } else {
                None
            };
            let avg_latency_ms = if latency_count > 0 {
                Some(latency_sum / latency_count as f64)
            } else {
                None
            };
            let display_name = members
                .iter()
                .find_map(|member| member.display_name.clone())
                .unwrap_or_else(|| pool_key.clone());

            LocalModelPoolStatus {
                health_score: compute_health_score(
                    provider_count,
                    active_provider_count,
                    success_rate,
                    avg_latency_ms,
                ),
                pool_key,
                display_name,
                provider_count,
                active_provider_count,
                cooling_down_count,
                active_session_count: bindings.len() as i64,
                success_rate,
                avg_latency_ms,
                members,
                bindings,
            }
        })
        .collect::<Vec<_>>();

    pools.sort_by(|left, right| {
        right
            .active_session_count
            .cmp(&left.active_session_count)
            .then_with(|| right.health_score.cmp(&left.health_score))
            .then_with(|| left.display_name.cmp(&right.display_name))
    });

    Ok(pools)
}

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
pub async fn get_local_desktop_object_storage_config(
    state: State<'_, AppState>,
) -> Result<Option<DesktopObjectStorageConfig>, String> {
    state
        .providers
        .store
        .get_local_desktop_object_storage_config()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_local_desktop_object_storage_config(
    state: State<'_, AppState>,
    payload: DesktopObjectStorageConfigUpdateRequest,
) -> Result<DesktopObjectStorageConfig, String> {
    state
        .providers
        .store
        .update_local_desktop_object_storage_config(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_local_desktop_object_storage_config(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .providers
        .store
        .clear_local_desktop_object_storage_config()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prepare_local_desktop_object_storage_upload(
    state: State<'_, AppState>,
    payload: DesktopObjectStorageUploadRequest,
) -> Result<DesktopObjectStorageUploadTicket, String> {
    state
        .providers
        .store
        .prepare_local_desktop_object_storage_upload(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn prepare_local_desktop_object_storage_read(
    state: State<'_, AppState>,
    payload: DesktopObjectStorageReadRequest,
) -> Result<DesktopObjectStorageReadTicket, String> {
    state
        .providers
        .store
        .prepare_local_desktop_object_storage_read(payload)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_local_desktop_object_storage_object(
    state: State<'_, AppState>,
    object_key: String,
) -> Result<bool, String> {
    state
        .providers
        .store
        .delete_local_desktop_object_storage_object(&object_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replace_local_provider_presets(
    state: State<'_, AppState>,
    presets: Vec<ProviderPreset>,
) -> Result<usize, String> {
    let count = presets.len();
    state
        .providers
        .store
        .replace_presets(presets)
        .await
        .map_err(|e| e.to_string())?;
    Ok(count)
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
    state
        .providers
        .store
        .list_models(Some(instance_id), None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_local_provider_health(
    state: State<'_, AppState>,
) -> Result<Vec<LocalProviderHealth>, String> {
    let instances = state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|e| e.to_string())?;

    let mut items = Vec::with_capacity(instances.len());
    for instance in instances {
        if !instance.is_enabled {
            items.push(LocalProviderHealth {
                id: instance.id.to_string(),
                name: if instance.name.trim().is_empty() {
                    "Local Provider".to_string()
                } else {
                    instance.name
                },
                status: "down".to_string(),
                priority: instance.priority,
                latency: 0,
                sparkline: Vec::new(),
            });
            continue;
        }

        let models = state
            .providers
            .store
            .list_models(Some(instance.id.to_string()), None)
            .await
            .map_err(|e| e.to_string())?;
        let active_models: Vec<&ProviderModel> =
            models.iter().filter(|item| item.is_active).collect();
        let latencies: Vec<i64> = active_models
            .iter()
            .map(|item| provider_latency_from_meta(&item.extra_meta))
            .filter(|value| *value > 0)
            .collect();
        let avg_latency = if latencies.is_empty() {
            0
        } else {
            (latencies.iter().sum::<i64>() as f64 / latencies.len() as f64).round() as i64
        };
        let status = if active_models.is_empty() {
            "unknown"
        } else if avg_latency >= 5000 {
            "degraded"
        } else {
            "active"
        };

        items.push(LocalProviderHealth {
            id: instance.id.to_string(),
            name: if instance.name.trim().is_empty() {
                "Local Provider".to_string()
            } else {
                instance.name
            },
            status: status.to_string(),
            priority: instance.priority,
            latency: avg_latency.max(0),
            sparkline: latencies
                .into_iter()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
        });
    }

    items.sort_by(|left, right| left.priority.cmp(&right.priority));
    Ok(items)
}

#[tauri::command]
pub async fn verify_local_provider(
    state: State<'_, AppState>,
    payload: ProviderVerifyRequest,
) -> Result<ProviderVerifyResponse, String> {
    verify_local_provider_impl(&state, payload).await
}

pub(crate) async fn verify_local_provider_impl(
    state: &AppState,
    payload: ProviderVerifyRequest,
) -> Result<ProviderVerifyResponse, String> {
    let protocol = normalize_protocol(payload.protocol.as_deref());
    let started = Instant::now();
    let result = fetch_model_ids_from_upstream(
        &state,
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
    let connection = state
        .providers
        .store
        .get_instance_connection(&instance_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "instance not found".to_string())?;

    let result = fetch_model_ids_from_upstream(
        &state,
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
        .quick_add_models(&instance_id, model_ids, None)
        .await
        .map_err(|e| e.to_string())?;

    state
        .providers
        .store
        .list_models(Some(instance_id), None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_add_local_provider_models(
    state: State<'_, AppState>,
    instance_id: String,
    payload: ProviderModelsQuickAddRequest,
) -> Result<Vec<ProviderModel>, String> {
    state
        .providers
        .store
        .quick_add_models(&instance_id, payload.models, payload.capability.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    state
        .providers
        .store
        .list_models(Some(instance_id), None)
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
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "instance not found".to_string())?;
    let instance = state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "instance not found".to_string())?;
    let preset = state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(|e| e.to_string())?;

    if connection
        .credential_source
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("platform"))
        .unwrap_or(false)
    {
        return Err("platform models cannot be tested locally; use chat to verify".to_string());
    }

    let prompt = payload
        .and_then(|item| item.prompt)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ping".to_string());

    let capability = model
        .capabilities
        .first()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "chat".to_string());
    let request_data = match capability.as_str() {
        "embedding" => serde_json::json!({
            "model": model.model_id,
            "input": prompt,
        }),
        "image_generation" => serde_json::json!({
            "model": model.model_id,
            "prompt": prompt,
            "n": 1,
        }),
        "text_to_speech" => serde_json::json!({
            "model": model.model_id,
            "input": prompt,
            "voice": "alloy",
        }),
        "speech_to_text" => serde_json::json!({
            "model": model.model_id,
            "audio_data": prompt,
            "response_format": "json",
        }),
        "video_generation" => serde_json::json!({
            "model": model.model_id,
            "prompt": prompt,
        }),
        _ => serde_json::json!({
            "model": model.model_id,
            "messages": [{"role": "user", "content": prompt}],
            "stream": false,
            "max_tokens": 16,
        }),
    };
    let prepared = crate::modules::providers::request_runtime::prepare_provider_request(
        preset.as_ref(),
        &instance,
        &model,
        connection.secret_key.as_deref(),
        capability.as_str(),
        request_data,
        None,
        None,
    )?;
    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        state.mcp.store.as_ref(),
    )
    .await?;

    let started = Instant::now();
    let response =
        crate::modules::providers::request_runtime::send_prepared_json_request(&client, &prepared)
            .await?;
    let status = response.status;
    let body_json: Value = response
        .json
        .unwrap_or_else(|| serde_json::json!({ "raw": "failed to parse json response" }));

    let error = if status.is_success() {
        None
    } else {
        extract_error_message(&body_json)
            .or_else(|| Some(format!("upstream status {}", status.as_u16())))
    };
    let response_body = if status.is_success() && capability == "chat" {
        normalize_provider_test_response(
            &state.providers.transformer,
            &prepared,
            body_json.clone(),
            status.as_u16(),
        )
    } else {
        body_json
    };

    Ok(ProviderModelTestResponse {
        success: status.is_success(),
        latency_ms: started.elapsed().as_millis() as i64,
        status_code: status.as_u16() as i32,
        upstream_url: prepared.display_url(),
        response_body: Some(response_body),
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
        .list_bandit_arm_states(scene)
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

/// Sync platform (credits) models from GET /api/v1/credits/models into local platform instances.
/// Groups models by provider_slug and creates/updates one local instance per provider.
#[tauri::command]
pub async fn sync_platform_models(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderModel>, String> {
    sync_platform_models_impl(&state).await
}

/// Inner implementation callable from both Tauri command and background tasks.
pub async fn sync_platform_models_impl(state: &AppState) -> Result<Vec<ProviderModel>, String> {
    use crate::modules::providers::store::CHAT_UPSTREAM_PATH;
    use std::collections::HashMap;

    let base_url = state.mcp.transport.cloud_base_url.read().await.clone();
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("cloud API base URL not configured".to_string());
    }
    let url = format!("{}/api/v1/credits/models", base_url);

    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        state.mcp.store.as_ref(),
    )
    .await?;
    let mut request = client.get(&url);
    if let Some(token) = state
        .mcp
        .store
        .get_desktop_config("auth.token")
        .await
        .ok()
        .flatten()
    {
        let token = token.trim();
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let preview = if body.len() > 200 {
            body.chars().take(200).collect::<String>()
        } else {
            body
        };
        return Err(format!(
            "credits/models returned {}: {}",
            status.as_u16(),
            preview
        ));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let models_json = body
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| "credits/models response missing models array".to_string())?;

    if models_json.is_empty() {
        return Ok(vec![]);
    }

    // Group models by provider_slug
    let mut grouped: HashMap<String, (String, Vec<&Value>)> = HashMap::new();
    for m in models_json {
        let slug = m
            .get("provider_slug")
            .and_then(|v| v.as_str())
            .unwrap_or("platform")
            .to_string();
        let name = m
            .get("provider_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Platform")
            .to_string();
        grouped
            .entry(slug)
            .or_insert_with(|| (name, Vec::new()))
            .1
            .push(m);
    }

    let instances = state
        .providers
        .store
        .list_instances()
        .await
        .map_err(|e| e.to_string())?;

    let now = uuid::Uuid::nil();
    let mut all_synced: Vec<ProviderModel> = Vec::new();

    for (slug, (provider_name, group_models)) in &grouped {
        // Find or create a platform instance for this provider slug
        let platform_instance = instances.iter().find(|i| {
            i.credential_source.eq_ignore_ascii_case("platform")
                && i.preset_slug.eq_ignore_ascii_case(slug)
        });

        let instance_id = match platform_instance {
            Some(inst) => inst.id,
            None => {
                let created = state
                    .providers
                    .store
                    .create_instance(CreateInstanceRequest {
                        preset_slug: slug.clone(),
                        name: format!("{} (Platform)", provider_name),
                        base_url: "https://platform".to_string(),
                        chat_transport_path: None,
                        description: Some("Models billed via platform credits".to_string()),
                        icon: None,
                        priority: Some(0),
                        protocol: None,
                        model_prefix: None,
                        auto_append_v1: None,
                        resource_name: None,
                        deployment_name: None,
                        api_version: None,
                        project_id: None,
                        region: None,
                        app_id: None,
                        is_local: Some(false),
                        credential_source: Some("platform".to_string()),
                        secret_key: None,
                    })
                    .await
                    .map_err(|e| e.to_string())?;
                created.id
            }
        };

        let models: Vec<ProviderModel> = group_models
            .iter()
            .filter_map(|m| {
                let model_id = m
                    .get("model_id")
                    .or_else(|| m.get("id"))?
                    .as_str()?
                    .to_string();
                let display_name = m
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let capabilities: Vec<String> = m
                    .get("capabilities")
                    .and_then(|c| c.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_else(|| vec!["chat".to_string()]);
                let pricing = m
                    .get("pricing")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::new()));
                Some(ProviderModel {
                    id: now,
                    instance_id,
                    model_id,
                    unified_model_id: None,
                    display_name,
                    capabilities,
                    upstream_path: CHAT_UPSTREAM_PATH.to_string(),
                    pricing_config: pricing,
                    limit_config: Value::Object(serde_json::Map::new()),
                    tokenizer_config: Value::Object(serde_json::Map::new()),
                    routing_config: Value::Object(serde_json::Map::new()),
                    config_override: Value::Object(serde_json::Map::new()),
                    source: "platform".to_string(),
                    extra_meta: Value::Object(serde_json::Map::new()),
                    weight: 100,
                    priority: 0,
                    is_active: true,
                    synced_at: None,
                    created_at: None,
                    updated_at: None,
                })
            })
            .collect();

        if models.is_empty() {
            continue;
        }

        state
            .providers
            .store
            .sync_models(&instance_id.to_string(), models)
            .await
            .map_err(|e| e.to_string())?;

        let synced = state
            .providers
            .store
            .list_models(Some(instance_id.to_string()), None)
            .await
            .map_err(|e| e.to_string())?;
        all_synced.extend(synced);
    }

    Ok(all_synced)
}

async fn fetch_model_ids_from_upstream(
    state: &AppState,
    base_url: &str,
    secret_key: Option<&str>,
    protocol: Option<&str>,
    auto_append_v1: Option<bool>,
) -> Result<UpstreamModelsFetchResult, String> {
    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        state.mcp.store.as_ref(),
    )
    .await?;
    let normalized_protocol = normalize_protocol(protocol);
    let candidates = build_models_endpoints(base_url, &normalized_protocol, auto_append_v1);
    let has_secret = secret_key
        .map(str::trim)
        .map(|value| !value.is_empty())
        .unwrap_or(false);
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
                    let response_preview = parsed_body
                        .as_ref()
                        .and_then(|value| serde_json::to_string(value).ok())
                        .and_then(|value| compact_text_preview(&value, 240))
                        .or_else(|| compact_text_preview(&body_text, 240));
                    let upstream_error = parsed_body
                        .as_ref()
                        .and_then(extract_error_message)
                        .map(|message| format!("sync failed: {message} ({endpoint})"));
                    last_error = upstream_error.or_else(|| {
                        response_preview.map_or_else(
                            || Some(format!("sync failed: {status} ({endpoint})")),
                            |preview| {
                                Some(format!(
                                    "sync failed: {status} ({endpoint}) body: {preview}"
                                ))
                            },
                        )
                    });

                    // Auth failures on the primary compatible endpoint are definitive;
                    // falling back to /models often returns HTML and obscures the real cause.
                    if status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::FORBIDDEN
                    {
                        if !has_secret {
                            return Err(format!(
                                "sync failed: provider API key is empty, please open settings and save API key again ({endpoint})"
                            ));
                        }
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

fn compact_text_preview(input: &str, max_chars: usize) -> Option<String> {
    let compact = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }

    let mut preview = compact.chars().take(max_chars).collect::<String>();
    if compact.chars().count() > max_chars {
        preview.push_str("...");
    }
    Some(preview)
}

fn decode_model_ids_from_body(
    endpoint: &str,
    body_text: &str,
    content_type: Option<&str>,
) -> Result<Vec<String>, String> {
    let body: Value = serde_json::from_str(body_text).map_err(|err| {
        let preview_suffix = compact_text_preview(body_text, 240)
            .map(|preview| format!("; body preview: {preview}"))
            .unwrap_or_default();
        if let Some(content_type) = content_type {
            format!(
                "failed to parse model list from {endpoint} (content-type: {content_type}): {err}{preview_suffix}"
            )
        } else {
            format!("failed to parse model list from {endpoint}: {err}{preview_suffix}")
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

fn normalize_provider_test_response(
    transformer: &crate::modules::providers::response_transformer::ResponseTransformer,
    prepared: &crate::modules::providers::request_runtime::PreparedProviderRequest,
    raw: Value,
    status_code: u16,
) -> Value {
    transformer.transform(
        prepared.template_engine.as_str(),
        Some(prepared.response_decoder.as_str()),
        &prepared.response_transform,
        raw,
        status_code,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        apply_models_auth_headers, decode_model_ids_from_body, normalize_provider_test_response,
    };
    use crate::modules::providers::request_runtime::PreparedProviderRequest;
    use crate::modules::providers::response_transformer::ResponseTransformer;
    use reqwest::Client;
    use serde_json::json;
    use std::collections::BTreeMap;

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
        assert!(err.contains("body preview: <html>not-json</html>"));
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

    #[test]
    fn build_upstream_endpoint_deduplicates_v1_prefix() {
        let helper = crate::modules::providers::request_runtime::build_upstream_url_with_params;
        assert_eq!(
            helper(
                "https://api.example.com/v1",
                "v1/chat/completions",
                Some("openai"),
                None,
                None,
            ),
            (
                "https://api.example.com/v1/chat/completions".to_string(),
                serde_json::json!({}),
            )
        );
        assert_eq!(
            helper(
                "https://api.example.com/v1",
                "/v1/embeddings",
                Some("openai"),
                None,
                None,
            ),
            (
                "https://api.example.com/v1/embeddings".to_string(),
                serde_json::json!({}),
            )
        );
        assert_eq!(
            helper(
                "https://api.example.com",
                "chat/completions",
                Some("openai"),
                Some(false),
                None,
            ),
            (
                "https://api.example.com/chat/completions".to_string(),
                serde_json::json!({}),
            )
        );
    }

    #[test]
    fn normalize_provider_test_response_uses_responses_decoder() {
        let transformer = ResponseTransformer::new();
        let prepared = PreparedProviderRequest {
            method: "POST".to_string(),
            url: "https://api.openai.com/v1/responses".to_string(),
            query_params: BTreeMap::new(),
            headers: BTreeMap::new(),
            body: json!({}),
            template_engine: "openai_compat".to_string(),
            response_decoder: "openai_responses".to_string(),
            response_transform: json!({}),
            async_config: json!({}),
        };

        let normalized = normalize_provider_test_response(
            &transformer,
            &prepared,
            json!({
                "model": "gpt-5.3-codex",
                "output": [{
                    "type": "message",
                    "content": [{"type": "output_text", "text": "pong local responses"}]
                }],
                "usage": { "input_tokens": 1, "output_tokens": 2, "total_tokens": 3 },
                "status": "completed"
            }),
            200,
        );

        assert_eq!(
            normalized["choices"][0]["message"]["content"],
            json!("pong local responses")
        );
        assert_eq!(normalized["usage"]["total_tokens"], json!(3));
    }

    #[test]
    fn apply_models_auth_headers_uses_anthropic_headers() {
        let client = Client::new();
        let request = apply_models_auth_headers(
            client.get("https://api.anthropic.com/v1/models"),
            "anthropic",
            Some("sk-ant-test"),
        )
        .build()
        .expect("build request");

        assert_eq!(
            request
                .headers()
                .get("x-api-key")
                .and_then(|value| value.to_str().ok()),
            Some("sk-ant-test")
        );
        assert_eq!(
            request
                .headers()
                .get("anthropic-version")
                .and_then(|value| value.to_str().ok()),
            Some("2023-06-01")
        );
        assert!(request.headers().get("authorization").is_none());
    }
}
