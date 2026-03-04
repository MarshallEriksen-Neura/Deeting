use crate::modules::providers::types::ProviderModel;
use crate::state::AppState;

pub const MODEL_CONFIG_REQUIRED_PREFIX: &str = "MODEL_CONFIG_REQUIRED";
pub const MODEL_CONFIG_SECRETARY: &str = "secretary";
pub const MODEL_CONFIG_EMBEDDING: &str = "embedding";

pub async fn ensure_required_local_models_configured(app_state: &AppState) -> Result<(), String> {
    let missing = collect_missing_required_local_models(app_state).await?;
    if missing.is_empty() {
        return Ok(());
    }
    Err(format_model_config_required_error(&missing))
}

pub fn format_model_config_required_error(missing: &[&str]) -> String {
    let mut normalized = Vec::new();
    if missing.iter().any(|value| *value == MODEL_CONFIG_SECRETARY) {
        normalized.push(MODEL_CONFIG_SECRETARY);
    }
    if missing.iter().any(|value| *value == MODEL_CONFIG_EMBEDDING) {
        normalized.push(MODEL_CONFIG_EMBEDDING);
    }
    if normalized.is_empty() {
        normalized.extend(
            missing
                .iter()
                .map(|value| *value)
                .filter(|value| !value.is_empty()),
        );
    }
    if normalized.is_empty() {
        normalized.push("unknown");
    }
    format!("{}::{}", MODEL_CONFIG_REQUIRED_PREFIX, normalized.join(","))
}

async fn collect_missing_required_local_models(
    app_state: &AppState,
) -> Result<Vec<&'static str>, String> {
    let active_models = app_state
        .providers
        .store
        .list_active_models()
        .await
        .map_err(|err| err.to_string())?;
    let secretary = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|err| err.to_string())?;
    let embedding = app_state
        .providers
        .store
        .get_or_create_user_embedding_config()
        .await
        .map_err(|err| err.to_string())?;

    let mut missing = Vec::new();
    let secretary_model_name = secretary.model_name.as_deref().map(str::trim).unwrap_or("");
    if secretary_model_name.is_empty()
        || !matches_active_model_reference(&active_models, secretary_model_name)
    {
        missing.push(MODEL_CONFIG_SECRETARY);
    }

    let embedding_model_id = embedding
        .provider_model_id
        .map(|value| value.to_string())
        .unwrap_or_default();
    if embedding_model_id.is_empty()
        || !matches_active_embedding_model(&active_models, embedding_model_id.as_str())
    {
        missing.push(MODEL_CONFIG_EMBEDDING);
    }

    Ok(missing)
}

fn matches_active_model_reference(models: &[ProviderModel], reference: &str) -> bool {
    models.iter().any(|model| {
        model.model_id.eq_ignore_ascii_case(reference)
            || model
                .unified_model_id
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(reference))
                .unwrap_or(false)
            || model
                .display_name
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(reference))
                .unwrap_or(false)
    })
}

fn matches_active_embedding_model(models: &[ProviderModel], provider_model_id: &str) -> bool {
    models
        .iter()
        .any(|model| model.id.to_string() == provider_model_id && has_embedding_capability(model))
}

fn has_embedding_capability(model: &ProviderModel) -> bool {
    model
        .capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("embedding"))
}
