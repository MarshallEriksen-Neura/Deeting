use crate::modules::ai_upstream::{resolve_local_model_connection, LocalModelConnection};
use crate::modules::providers::store::utils::has_embedding_capability;
use crate::modules::providers::types::{ProviderModel, UserSecretary};
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
    if !matches_active_secretary_model(&active_models, &secretary) {
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

pub(crate) fn build_local_secretary_model_resolution_request(
    secretary: &UserSecretary,
) -> Result<(String, Option<String>), String> {
    let normalized_model_name = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let normalized_provider_model_id = secretary
        .provider_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if normalized_model_name.is_none() && normalized_provider_model_id.is_none() {
        return Err("secretary model is not configured".to_string());
    }

    Ok((
        normalized_model_name.unwrap_or_default(),
        normalized_provider_model_id,
    ))
}

pub(crate) async fn resolve_local_secretary_model_connection(
    app_state: &AppState,
) -> Result<LocalModelConnection, String> {
    let secretary = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|err| err.to_string())?;
    let (requested_model, requested_provider_model_id) =
        build_local_secretary_model_resolution_request(&secretary)?;

    resolve_local_model_connection(
        app_state,
        &requested_model,
        requested_provider_model_id.as_deref(),
    )
    .await
}

fn matches_active_secretary_model(models: &[ProviderModel], secretary: &UserSecretary) -> bool {
    let provider_model_id = secretary
        .provider_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(provider_model_id) = provider_model_id {
        if models
            .iter()
            .any(|model| model.id.to_string() == provider_model_id)
        {
            return true;
        }
    }

    let model_name = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    model_name
        .map(|value| matches_active_model_reference(models, value))
        .unwrap_or(false)
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
    models.iter().any(|model| {
        model.id.to_string() == provider_model_id && has_embedding_capability(&model.capabilities)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn build_model(model_id: &str) -> ProviderModel {
        ProviderModel {
            id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            model_id: model_id.to_string(),
            unified_model_id: None,
            display_name: None,
            capabilities: vec!["chat".to_string()],
            upstream_path: "/v1/chat/completions".to_string(),
            pricing_config: json!({}),
            limit_config: json!({}),
            tokenizer_config: json!({}),
            routing_config: json!({}),
            config_override: json!({}),
            source: "manual".to_string(),
            extra_meta: json!({}),
            weight: 100,
            priority: 0,
            is_active: true,
            synced_at: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn build_secretary(
        legacy_model_name: Option<&str>,
        provider_model_id: Option<String>,
    ) -> UserSecretary {
        UserSecretary {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            user_id: "00000000-0000-0000-0000-000000000000".to_string(),
            name: "secretary".to_string(),
            model_name: legacy_model_name.map(str::to_string),
            provider_model_id,
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:01Z".to_string(),
        }
    }

    #[test]
    fn matches_active_secretary_model_prefers_provider_model_id() {
        let model = build_model("gpt-4o-mini");
        let secretary = build_secretary(Some("missing-model"), Some(model.id.to_string()));

        assert!(matches_active_secretary_model(&[model], &secretary));
    }

    #[test]
    fn matches_active_secretary_model_falls_back_to_legacy_model_name() {
        let model = build_model("gpt-4o-mini");
        let secretary = build_secretary(Some("gpt-4o-mini"), Some(" ".to_string()));

        assert!(matches_active_secretary_model(&[model], &secretary));
    }

    #[test]
    fn secretary_model_resolution_request_prefers_provider_model_id_when_present() {
        let secretary = build_secretary(
            Some("gpt-4o-mini"),
            Some(" 11111111-1111-4111-8111-111111111111 ".to_string()),
        );

        let (model_name, provider_model_id) =
            build_local_secretary_model_resolution_request(&secretary)
                .expect("secretary model request");

        assert_eq!(model_name, "gpt-4o-mini");
        assert_eq!(
            provider_model_id.as_deref(),
            Some("11111111-1111-4111-8111-111111111111")
        );
    }

    #[test]
    fn secretary_model_resolution_request_falls_back_to_legacy_model_name() {
        let secretary = build_secretary(Some(" gpt-4o-mini "), Some(" ".to_string()));

        let (model_name, provider_model_id) =
            build_local_secretary_model_resolution_request(&secretary)
                .expect("legacy secretary model request");

        assert_eq!(model_name, "gpt-4o-mini");
        assert_eq!(provider_model_id, None);
    }

    #[test]
    fn secretary_model_resolution_request_requires_configured_secretary_model() {
        let secretary = build_secretary(Some(" "), Some(" ".to_string()));

        let error = build_local_secretary_model_resolution_request(&secretary)
            .expect_err("missing secretary model should fail");

        assert!(error.contains("secretary model"));
    }
}
