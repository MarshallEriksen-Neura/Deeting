use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::ProviderModel;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

pub struct EmbeddingService {
    store: Arc<ProviderStore>,
    client: reqwest::Client,
}

impl EmbeddingService {
    pub fn new(store: Arc<ProviderStore>) -> Self {
        Self {
            store,
            client: reqwest::Client::new(),
        }
    }

    pub async fn embed_text(&self, text: &str) -> Result<Vec<f32>, ProviderError> {
        let models = self.store.list_active_models().await?;
        let embedding_config = self.store.get_or_create_user_embedding_config().await?;

        let embedding_model = select_embedding_model(&models, embedding_config.provider_model_id)
            .ok_or_else(|| {
            ProviderError::Validation("No active embedding model found".to_string())
        })?;

        let connection = self
            .store
            .get_instance_connection(&embedding_model.instance_id)
            .await?
            .ok_or_else(|| {
                ProviderError::Validation("Model instance connection not found".to_string())
            })?;

        let url = format!(
            "{}/{}",
            connection.base_url.trim_end_matches('/'),
            embedding_model.upstream_path.trim_start_matches('/')
        );

        let mut request = self.client.post(&url);
        if let Some(key) = connection.secret_key {
            request = request.header("Authorization", format!("Bearer {}", key));
        }

        let response = request
            .json(&EmbeddingRequest {
                model: embedding_model.model_id.clone(),
                input: text.to_string(),
            })
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::Network(format!(
                "Embedding request failed: {} - {}",
                status, body
            )));
        }

        let result: EmbeddingResponse = response.json().await.map_err(|e| {
            ProviderError::Network(format!("Failed to parse embedding response: {}", e))
        })?;

        result
            .data
            .first()
            .map(|d| d.embedding.clone())
            .ok_or_else(|| ProviderError::Network("Empty embedding data in response".to_string()))
    }
}

pub(crate) fn select_embedding_model<'a>(
    models: &'a [ProviderModel],
    configured_provider_model_id: Option<String>,
) -> Option<&'a ProviderModel> {
    if let Some(raw_provider_model_id) = configured_provider_model_id {
        let trimmed = raw_provider_model_id.trim();
        if !trimmed.is_empty() {
            if let Ok(target_id) = Uuid::parse_str(trimmed) {
                if let Some(configured_model) = models.iter().find(|model| model.id == target_id) {
                    if configured_model.is_active && has_embedding_capability(configured_model) {
                        return Some(configured_model);
                    }
                }
            }
        }
    }

    models
        .iter()
        .find(|model| model.is_active && has_embedding_capability(model))
}

fn has_embedding_capability(model: &ProviderModel) -> bool {
    model
        .capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("embedding"))
}

#[cfg(test)]
mod tests {
    use super::select_embedding_model;
    use crate::modules::providers::types::ProviderModel;
    use serde_json::json;
    use uuid::Uuid;

    fn mock_model(model_id: &str, capabilities: &[&str], is_active: bool) -> ProviderModel {
        ProviderModel {
            id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            model_id: model_id.to_string(),
            unified_model_id: None,
            display_name: Some(model_id.to_string()),
            capabilities: capabilities.iter().map(|item| item.to_string()).collect(),
            upstream_path: "v1/embeddings".to_string(),
            pricing_config: json!({}),
            limit_config: json!({}),
            tokenizer_config: json!({}),
            routing_config: json!({}),
            config_override: json!({}),
            source: "manual".to_string(),
            extra_meta: json!({}),
            weight: 100,
            priority: 0,
            is_active,
            synced_at: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn select_embedding_model_prefers_configured_provider_model_id() {
        let first = mock_model("text-embedding-3-small", &["embedding"], true);
        let second = mock_model("text-embedding-3-large", &["embedding"], true);
        let models = vec![first.clone(), second.clone()];

        let selected =
            select_embedding_model(&models, Some(second.id.to_string())).expect("selected model");

        assert_eq!(selected.id, second.id);
        assert_eq!(selected.model_id, "text-embedding-3-large");
    }

    #[test]
    fn select_embedding_model_falls_back_when_configured_model_not_embedding() {
        let first = mock_model("text-embedding-3-small", &["embedding"], true);
        let second = mock_model("gpt-4o-mini", &["chat"], true);
        let models = vec![first.clone(), second.clone()];

        let selected =
            select_embedding_model(&models, Some(second.id.to_string())).expect("selected model");

        assert_eq!(selected.id, first.id);
    }

    #[test]
    fn select_embedding_model_returns_none_when_no_embedding_model_exists() {
        let only_chat = mock_model("gpt-4o-mini", &["chat"], true);
        let models = vec![only_chat];

        let selected = select_embedding_model(&models, None);

        assert!(selected.is_none());
    }
}
