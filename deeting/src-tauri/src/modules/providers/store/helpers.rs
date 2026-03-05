use super::*;

pub(super) fn resolve_capabilities(
    payload: &ProviderModelUpdateRequest,
    fallback: Vec<String>,
) -> Vec<String> {
    if let Some(caps) = payload.capabilities.clone() {
        let filtered: Vec<String> = caps
            .into_iter()
            .map(|cap| cap.trim().to_string())
            .filter(|cap| !cap.is_empty())
            .collect();
        if !filtered.is_empty() {
            return filtered;
        }
    }

    if let Some(routing_config) = payload.routing_config.clone() {
        if let Some(array) = routing_config
            .get("capabilities")
            .and_then(|value| value.as_array())
        {
            let caps: Vec<String> = array
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                .filter(|value| !value.is_empty())
                .collect();
            if !caps.is_empty() {
                return caps;
            }
        }
    }

    fallback
}

pub(super) fn ensure_json_object(value: serde_json::Value) -> serde_json::Value {
    if value.is_object() {
        value
    } else {
        serde_json::json!({})
    }
}

pub(super) fn parse_json_object_text(text: Option<String>) -> serde_json::Value {
    match text {
        Some(value) if !value.trim().is_empty() => serde_json::from_str::<serde_json::Value>(&value)
            .ok()
            .filter(|item| item.is_object())
            .unwrap_or_else(|| serde_json::json!({})),
        _ => serde_json::json!({}),
    }
}

pub(super) fn normalize_upstream_path(path: Option<&str>) -> Option<String> {
    path.map(|value| value.trim().trim_start_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn normalize_source(source: Option<&str>) -> String {
    source
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string())
}

pub(super) fn normalize_secret(secret: &str) -> Option<String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn infer_model_capability(model_id: &str) -> &'static str {
    let normalized = model_id.trim().to_ascii_lowercase();

    let embedding_markers = [
        "text-embedding",
        "embedding",
        "embed",
        "ada-002",
        "retriever",
        "rerank",
        "bge",
        "e5",
        "gte",
        "nomic-embed",
        "nv-embed",
    ];
    if matches_any_marker(&normalized, &embedding_markers) {
        EMBEDDING_CAPABILITY
    } else if matches_any_marker(
        &normalized,
        &[
            "video-generation",
            "text-to-video",
            "image-to-video",
            "video_gen",
            "cogvideo",
            "hunyuan-video",
            "kling",
            "veo",
            "sora",
            "pika",
            "luma",
            "mochi",
            "-video",
            "video-",
        ],
    ) {
        VIDEO_GENERATION_CAPABILITY
    } else if matches_any_marker(
        &normalized,
        &[
            "image-generation",
            "text-to-image",
            "image-gen",
            "dall-e",
            "dalle",
            "stable-diffusion",
            "sdxl",
            "flux",
            "midjourney",
            "imagen",
            "playground",
            "recraft",
            "kandinsky",
            "diffusion",
        ],
    ) {
        IMAGE_GENERATION_CAPABILITY
    } else if matches_any_marker(
        &normalized,
        &[
            "speech-to-text",
            "speech_to_text",
            "audio-to-text",
            "transcribe",
            "transcription",
            "whisper",
            "asr",
            "stt",
            "wav2vec",
            "deepgram",
        ],
    ) {
        SPEECH_TO_TEXT_CAPABILITY
    } else if matches_any_marker(
        &normalized,
        &[
            "text-to-speech",
            "text_to_speech",
            "speech-synthesis",
            "audio-speech",
            "gpt-4o-mini-tts",
            "tts",
            "bark",
            "vits",
            "fish-speech",
            "kokoro",
            "piper",
        ],
    ) {
        TEXT_TO_SPEECH_CAPABILITY
    } else {
        CHAT_CAPABILITY
    }
}

pub(super) fn default_upstream_path_for_capability(capability: &str) -> &'static str {
    if capability.eq_ignore_ascii_case(EMBEDDING_CAPABILITY) {
        EMBEDDING_UPSTREAM_PATH
    } else if capability.eq_ignore_ascii_case(IMAGE_GENERATION_CAPABILITY) {
        IMAGE_GENERATION_UPSTREAM_PATH
    } else if capability.eq_ignore_ascii_case(TEXT_TO_SPEECH_CAPABILITY) {
        TEXT_TO_SPEECH_UPSTREAM_PATH
    } else if capability.eq_ignore_ascii_case(SPEECH_TO_TEXT_CAPABILITY) {
        SPEECH_TO_TEXT_UPSTREAM_PATH
    } else if capability.eq_ignore_ascii_case(VIDEO_GENERATION_CAPABILITY) {
        VIDEO_GENERATION_UPSTREAM_PATH
    } else {
        CHAT_UPSTREAM_PATH
    }
}

pub(super) fn matches_any_marker(model_id: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| model_id.contains(marker))
}

pub(super) fn insert_meta_if_non_empty(
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(raw) = value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            target.insert(
                key.to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
}

pub(super) fn build_instance_meta_json(
    protocol: Option<&str>,
    model_prefix: Option<&str>,
    auto_append_v1: Option<bool>,
    resource_name: Option<&str>,
    deployment_name: Option<&str>,
    api_version: Option<&str>,
    project_id: Option<&str>,
    region: Option<&str>,
) -> serde_json::Value {
    let mut meta = serde_json::Map::new();
    insert_meta_if_non_empty(&mut meta, "protocol", protocol);
    insert_meta_if_non_empty(&mut meta, "model_prefix", model_prefix);
    if let Some(value) = auto_append_v1 {
        meta.insert("auto_append_v1".to_string(), serde_json::Value::Bool(value));
    }
    insert_meta_if_non_empty(&mut meta, "resource_name", resource_name);
    insert_meta_if_non_empty(&mut meta, "deployment_name", deployment_name);
    insert_meta_if_non_empty(&mut meta, "api_version", api_version);
    insert_meta_if_non_empty(&mut meta, "project_id", project_id);
    insert_meta_if_non_empty(&mut meta, "region", region);
    serde_json::Value::Object(meta)
}

pub(super) fn merge_instance_meta_json(
    existing: serde_json::Value,
    protocol: Option<&str>,
    model_prefix: Option<&str>,
    auto_append_v1: Option<bool>,
    resource_name: Option<&str>,
    deployment_name: Option<&str>,
    api_version: Option<&str>,
    project_id: Option<&str>,
    region: Option<&str>,
) -> serde_json::Value {
    let mut next = ensure_json_object(existing);
    let Some(map) = next.as_object_mut() else {
        return serde_json::json!({});
    };

    if let Some(value) = protocol {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "protocol".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = model_prefix {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "model_prefix".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = auto_append_v1 {
        map.insert("auto_append_v1".to_string(), serde_json::Value::Bool(value));
    }
    if let Some(value) = resource_name {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "resource_name".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = deployment_name {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "deployment_name".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = api_version {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "api_version".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = project_id {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "project_id".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }
    if let Some(value) = region {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            map.insert(
                "region".to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
    }

    serde_json::Value::Object(map.clone())
}

pub(super) fn normalize_bandit_scene(scene: Option<&str>) -> Result<String, ProviderError> {
    let normalized = scene.unwrap_or(BANDIT_DEFAULT_SCENE).trim().to_string();
    if normalized.is_empty() {
        return Err(ProviderError::Validation("scene is required".to_string()));
    }
    Ok(normalized)
}

pub(super) fn extract_routing_string(
    config: Option<&serde_json::Value>,
    key: &str,
) -> Option<String> {
    config
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn extract_routing_f64(config: Option<&serde_json::Value>, key: &str) -> Option<f64> {
    let value = config.and_then(|item| item.get(key))?;
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value
        .as_str()
        .and_then(|raw| raw.trim().parse::<f64>().ok())
}

pub(super) fn extract_routing_i64(config: Option<&serde_json::Value>, key: &str) -> Option<i64> {
    let value = config.and_then(|item| item.get(key))?;
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    if let Some(number) = value.as_u64() {
        return i64::try_from(number).ok();
    }
    value
        .as_str()
        .and_then(|raw| raw.trim().parse::<i64>().ok())
}

pub(super) fn now_plus_seconds_rfc3339(seconds: i64) -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .saturating_add(time::Duration::seconds(seconds.max(0)))
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}

pub(super) fn row_to_bandit_arm_state(row: &SqliteRow) -> Result<BanditArmState, ProviderError> {
    Ok(BanditArmState {
        id: row.try_get("id")?,
        provider_model_id: row.try_get("provider_model_id")?,
        scene: row.try_get("scene")?,
        arm_id: row.try_get("arm_id")?,
        reward_metric_type: row.try_get("reward_metric_type")?,
        strategy: row.try_get("strategy")?,
        epsilon: row.try_get::<f64, _>("epsilon").unwrap_or(0.1),
        alpha: row.try_get::<f64, _>("alpha").unwrap_or(1.0),
        beta: row.try_get::<f64, _>("beta").unwrap_or(1.0),
        total_trials: row.try_get::<i64, _>("total_trials").unwrap_or(0),
        successes: row.try_get::<i64, _>("successes").unwrap_or(0),
        failures: row.try_get::<i64, _>("failures").unwrap_or(0),
        total_latency_ms: row.try_get::<i64, _>("total_latency_ms").unwrap_or(0),
        latency_p95_ms: row.try_get("latency_p95_ms")?,
        total_cost: row.try_get::<f64, _>("total_cost").unwrap_or(0.0),
        last_reward: row.try_get::<f64, _>("last_reward").unwrap_or(0.0),
        cooldown_until: row.try_get("cooldown_until")?,
        version: row.try_get::<i64, _>("version").unwrap_or(1),
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_instance(row: &SqliteRow) -> Result<ProviderInstance, ProviderError> {
    let meta_text: Option<String> = row.try_get("meta")?;
    Ok(ProviderInstance {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid uuid: {e}")))?,
        preset_slug: row.try_get("preset_slug")?,
        name: row.try_get("name")?,
        base_url: row.try_get("base_url")?,
        description: row.try_get("description")?,
        icon: row.try_get("icon")?,
        priority: row.try_get::<i64, _>("priority").unwrap_or(0),
        meta: parse_json_object_text(meta_text),
        is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
        is_local: row.try_get::<i64, _>("is_local")? != 0,
        credentials_ref: row.try_get("credentials_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_model(row: &SqliteRow) -> Result<ProviderModel, ProviderError> {
    let caps_str: String = row.try_get("capabilities")?;
    let pricing_config: Option<String> = row.try_get("pricing_config")?;
    let limit_config: Option<String> = row.try_get("limit_config")?;
    let tokenizer_config: Option<String> = row.try_get("tokenizer_config")?;
    let routing_config: Option<String> = row.try_get("routing_config")?;
    let config_override: Option<String> = row.try_get("config_override")?;
    let extra_meta: Option<String> = row.try_get("extra_meta")?;
    Ok(ProviderModel {
        id: Uuid::parse_str(row.try_get::<String, _>("id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid model uuid: {e}")))?,
        instance_id: Uuid::parse_str(row.try_get::<String, _>("instance_id")?.as_str())
            .map_err(|e| ProviderError::Database(format!("invalid instance uuid: {e}")))?,
        capabilities: serde_json::from_str(&caps_str).unwrap_or_default(),
        model_id: row.try_get("model_id")?,
        unified_model_id: row.try_get("unified_model_id")?,
        display_name: row.try_get("display_name")?,
        upstream_path: normalize_upstream_path(Some(row.try_get::<String, _>("upstream_path")?.as_str()))
            .unwrap_or_else(|| "v1/chat/completions".to_string()),
        pricing_config: parse_json_object_text(pricing_config),
        limit_config: parse_json_object_text(limit_config),
        tokenizer_config: parse_json_object_text(tokenizer_config),
        routing_config: parse_json_object_text(routing_config),
        config_override: parse_json_object_text(config_override),
        source: normalize_source(Some(row.try_get::<String, _>("source")?.as_str())),
        extra_meta: parse_json_object_text(extra_meta),
        weight: row.try_get::<i64, _>("weight").unwrap_or(100),
        priority: row.try_get::<i64, _>("priority").unwrap_or(0),
        is_active: row.try_get::<i64, _>("is_active")? != 0,
        synced_at: row.try_get("synced_at")?,
        created_at: row.try_get("created_at").ok(),
        updated_at: row.try_get("updated_at").ok(),
    })
}

pub(super) fn row_to_user_secretary(row: &SqliteRow) -> Result<UserSecretary, ProviderError> {
    Ok(UserSecretary {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        name: row.try_get("name")?,
        model_name: row.try_get("model_name")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn row_to_user_embedding_config(
    row: &SqliteRow,
) -> Result<UserEmbeddingConfig, ProviderError> {
    Ok(UserEmbeddingConfig {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        provider_model_id: row.try_get("provider_model_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(super) fn has_embedding_capability(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case(EMBEDDING_CAPABILITY))
}

pub(super) fn contains_capability(capabilities: &[String], expected: &str) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case(expected))
}

pub(super) fn now_rfc3339() -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}
