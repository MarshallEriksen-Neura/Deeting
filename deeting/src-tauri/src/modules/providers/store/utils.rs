use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::EMBEDDING_CAPABILITY;
use crate::modules::providers::types::{
    BanditArmState, ProviderInstance, ProviderModel, UserEmbeddingConfig, UserSecretary,
};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;
use uuid::Uuid;

pub fn row_to_bandit_arm_state(row: &SqliteRow) -> Result<BanditArmState, ProviderError> {
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

pub fn row_to_instance(row: &SqliteRow) -> Result<ProviderInstance, ProviderError> {
    let meta_text: Option<String> = row.try_get("meta")?;
    let response_transform_text: Option<String> = row.try_get("response_transform")?;
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
        template_engine: row.try_get("template_engine")?,
        response_transform: response_transform_text.and_then(|t| serde_json::from_str(&t).ok()),
        is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
        is_local: row.try_get::<i64, _>("is_local")? != 0,
        credentials_ref: row.try_get("credentials_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub fn row_to_model(row: &SqliteRow) -> Result<ProviderModel, ProviderError> {
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
        upstream_path: normalize_upstream_path(Some(
            row.try_get::<String, _>("upstream_path")?.as_str(),
        ))
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

pub fn row_to_user_secretary(row: &SqliteRow) -> Result<UserSecretary, ProviderError> {
    Ok(UserSecretary {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        name: row.try_get("name")?,
        model_name: row.try_get("model_name")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub fn row_to_user_embedding_config(row: &SqliteRow) -> Result<UserEmbeddingConfig, ProviderError> {
    Ok(UserEmbeddingConfig {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        provider_model_id: row.try_get("provider_model_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub fn has_embedding_capability(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case(EMBEDDING_CAPABILITY))
}

pub fn contains_capability(capabilities: &[String], expected: &str) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case(expected))
}

pub fn parse_json_object_text(text: Option<String>) -> serde_json::Value {
    match text {
        Some(value) if !value.trim().is_empty() => {
            serde_json::from_str::<serde_json::Value>(&value)
                .ok()
                .filter(|item| item.is_object())
                .unwrap_or_else(|| serde_json::json!({}))
        }
        _ => serde_json::json!({}),
    }
}

pub fn normalize_upstream_path(path: Option<&str>) -> Option<String> {
    path.map(|value| value.trim().trim_start_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

pub fn normalize_source(source: Option<&str>) -> String {
    source
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string())
}

pub fn normalize_secret(secret: &str) -> Option<String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn now_rfc3339() -> Result<String, ProviderError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| ProviderError::Database(e.to_string()))
}
