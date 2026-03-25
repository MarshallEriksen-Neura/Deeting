use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::has_embedding_capability;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::ProviderModel;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone)]
struct PlatformEmbeddingProxyConfig {
    mcp_store: Arc<crate::modules::mcp::store::McpStore>,
    cloud_base_url: Arc<RwLock<String>>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Clone)]
pub struct EmbeddingService {
    store: Arc<ProviderStore>,
    client: reqwest::Client,
    platform_proxy: Option<PlatformEmbeddingProxyConfig>,
}

impl EmbeddingService {
    pub fn new(store: Arc<ProviderStore>) -> Self {
        Self {
            store,
            client: reqwest::Client::new(),
            platform_proxy: None,
        }
    }

    pub fn with_platform_proxy(
        store: Arc<ProviderStore>,
        mcp_store: Arc<crate::modules::mcp::store::McpStore>,
        cloud_base_url: Arc<RwLock<String>>,
    ) -> Self {
        Self {
            store,
            client: reqwest::Client::new(),
            platform_proxy: Some(PlatformEmbeddingProxyConfig {
                mcp_store,
                cloud_base_url,
            }),
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
            .get_instance_connection(&embedding_model.instance_id.to_string())
            .await?
            .ok_or_else(|| {
                ProviderError::Validation("Model instance connection not found".to_string())
            })?;

        if uses_platform_proxy(connection.credential_source.as_deref()) {
            return self
                .embed_text_via_platform_proxy(embedding_model, text)
                .await;
        }

        let instance = self
            .store
            .get_instance(&embedding_model.instance_id.to_string())
            .await?
            .ok_or_else(|| ProviderError::Validation("Model instance not found".to_string()))?;
        let preset = self.store.get_preset(&instance.preset_slug).await?;

        let prepared = crate::modules::providers::request_runtime::prepare_provider_request(
            preset.as_ref(),
            &instance,
            embedding_model,
            connection.secret_key.as_deref(),
            "embedding",
            serde_json::json!({
                "model": embedding_model.model_id.clone(),
                "input": text.to_string(),
            }),
            None,
            None,
        )
        .map_err(ProviderError::Network)?;

        let response = crate::modules::providers::request_runtime::send_prepared_json_request(
            &self.client,
            &prepared,
        )
        .await
        .map_err(ProviderError::Network)?;

        if !response.status.is_success() {
            let status = response.status;
            let body = response.text;
            return Err(ProviderError::Network(format!(
                "Embedding request failed: {} - {}",
                status, body
            )));
        }

        let result: EmbeddingResponse = serde_json::from_value(response.json.ok_or_else(|| {
            ProviderError::Network("Failed to parse embedding response JSON".to_string())
        })?)
        .map_err(|e| {
            ProviderError::Network(format!("Failed to parse embedding response: {}", e))
        })?;

        result
            .data
            .first()
            .map(|d| d.embedding.clone())
            .ok_or_else(|| ProviderError::Network("Empty embedding data in response".to_string()))
    }

    async fn embed_text_via_platform_proxy(
        &self,
        embedding_model: &ProviderModel,
        text: &str,
    ) -> Result<Vec<f32>, ProviderError> {
        let proxy = self.platform_proxy.as_ref().ok_or_else(|| {
            ProviderError::Validation(
                "Platform embedding proxy is not configured for this desktop runtime".to_string(),
            )
        })?;
        let url = build_platform_embedding_proxy_url(proxy.cloud_base_url.read().await.as_str())?;
        let auth_token = proxy
            .mcp_store
            .get_desktop_config("auth.token")
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ProviderError::Validation(
                    "Authentication required for platform embedding models".to_string(),
                )
            })?;
        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", auth_token))
            .json(&build_platform_embedding_proxy_body(embedding_model, text))
            .send()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        let status = response.status();
        let raw_text = response
            .text()
            .await
            .map_err(|err| ProviderError::Network(err.to_string()))?;
        if !status.is_success() {
            return Err(ProviderError::Network(format!(
                "Platform embedding request failed: {} - {}",
                status,
                extract_proxy_error_message(&raw_text)
            )));
        }
        let result: EmbeddingResponse = serde_json::from_str(&raw_text).map_err(|err| {
            ProviderError::Network(format!(
                "Failed to parse platform embedding response: {}",
                err
            ))
        })?;
        result
            .data
            .first()
            .map(|d| d.embedding.clone())
            .ok_or_else(|| ProviderError::Network("Empty embedding data in response".to_string()))
    }
}

fn uses_platform_proxy(credential_source: Option<&str>) -> bool {
    credential_source
        .map(str::trim)
        .map(|value| value.eq_ignore_ascii_case("platform"))
        .unwrap_or(false)
}

fn build_platform_embedding_proxy_url(base_url: &str) -> Result<String, ProviderError> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return Err(ProviderError::Validation(
            "cloud API base URL not configured; set api.base_url for platform models".to_string(),
        ));
    }
    Ok(format!("{}/api/v1/internal/embeddings", normalized))
}

fn build_platform_embedding_proxy_body(
    embedding_model: &ProviderModel,
    text: &str,
) -> serde_json::Value {
    serde_json::json!({
        "model": embedding_model.model_id.clone(),
        "input": text,
        "provider_model_id": embedding_model.id.to_string(),
    })
}

fn extract_proxy_error_message(raw_text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw_text)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|item| item.as_str())
                .or_else(|| value.get("detail").and_then(|item| item.as_str()))
                .map(|item| item.to_string())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| raw_text.to_string())
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
                    if configured_model.is_active
                        && has_embedding_capability(&configured_model.capabilities)
                    {
                        return Some(configured_model);
                    }
                }
            }
        }
    }

    models
        .iter()
        .find(|model| model.is_active && has_embedding_capability(&model.capabilities))
}

#[cfg(test)]
mod tests {
    use super::{
        build_platform_embedding_proxy_body, build_platform_embedding_proxy_url,
        select_embedding_model, uses_platform_proxy,
    };
    use crate::modules::providers::types::ProviderModel;
    use axum::{
        extract::State as AxumState,
        http::{HeaderMap, Uri},
        routing::post,
        Json, Router,
    };
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::net::TcpListener;
    use tokio::sync::RwLock;
    use uuid::Uuid;

    #[derive(Debug, Clone)]
    struct PlatformEmbeddingRequestCapture {
        path: String,
        authorization: Option<String>,
        payload: serde_json::Value,
    }

    async fn mock_platform_embedding_handler(
        AxumState(state): AxumState<Arc<Mutex<Option<PlatformEmbeddingRequestCapture>>>>,
        uri: Uri,
        headers: HeaderMap,
        Json(payload): Json<serde_json::Value>,
    ) -> Json<serde_json::Value> {
        let capture = PlatformEmbeddingRequestCapture {
            path: uri.path().to_string(),
            authorization: headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string()),
            payload,
        };
        *state.lock().expect("lock capture state") = Some(capture);
        Json(serde_json::json!({
            "data": [
                {
                    "embedding": [0.11, 0.22, 0.33]
                }
            ]
        }))
    }

    async fn start_mock_platform_embedding_server() -> (
        String,
        Arc<Mutex<Option<PlatformEmbeddingRequestCapture>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock platform embedding listener");
        let addr = listener
            .local_addr()
            .expect("read mock platform embedding listener addr");
        let capture = Arc::new(Mutex::new(None));
        let app = Router::new()
            .route(
                "/api/v1/internal/embeddings",
                post(mock_platform_embedding_handler),
            )
            .with_state(capture.clone());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        (format!("http://{}", addr), capture, server)
    }

    fn temp_sqlite_url(prefix: &str) -> String {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!("deeting-embedding-{prefix}-{}.db", Uuid::new_v4()));
        format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"))
    }

    async fn create_platform_embedding_service(
        cloud_base_url: String,
    ) -> (
        super::EmbeddingService,
        ProviderModel,
        Arc<crate::modules::mcp::store::McpStore>,
    ) {
        let provider_store = Arc::new(
            crate::modules::providers::store::ProviderStore::new(&temp_sqlite_url("provider"))
                .await
                .expect("create provider store"),
        );
        provider_store.init().await.expect("init provider store");

        let instance = provider_store
            .create_instance(crate::modules::providers::types::CreateInstanceRequest {
                preset_slug: "openai".to_string(),
                name: "Platform Embedding".to_string(),
                base_url: "https://platform".to_string(),
                chat_transport_path: None,
                description: None,
                icon: None,
                priority: Some(0),
                protocol: Some("openai".to_string()),
                model_prefix: None,
                auto_append_v1: Some(true),
                resource_name: None,
                deployment_name: None,
                api_version: None,
                project_id: None,
                region: None,
                is_local: Some(false),
                credential_source: Some("platform".to_string()),
                secret_key: None,
            })
            .await
            .expect("create platform instance");

        provider_store
            .quick_add_models(
                &instance.id.to_string(),
                vec!["text-embedding-3-small".to_string()],
                Some("embedding"),
            )
            .await
            .expect("quick add embedding model");

        let _ = provider_store
            .get_or_create_user_embedding_config()
            .await
            .expect("init embedding config");
        let model = provider_store
            .list_active_models()
            .await
            .expect("list active models")
            .into_iter()
            .find(|item| item.model_id == "text-embedding-3-small")
            .expect("platform embedding model");
        provider_store
            .update_user_embedding_config(
                crate::modules::providers::types::UserEmbeddingConfigUpdateRequest {
                    provider_model_id: Some(Some(model.id.to_string())),
                },
            )
            .await
            .expect("select platform embedding model");

        let mcp_store = Arc::new(
            crate::modules::mcp::store::McpStore::new(&temp_sqlite_url("mcp"))
                .await
                .expect("create mcp store"),
        );
        mcp_store.init().await.expect("init mcp store");
        mcp_store
            .set_desktop_config("auth.token", "desktop-test-token")
            .await
            .expect("set desktop auth token");

        let service = super::EmbeddingService::with_platform_proxy(
            provider_store,
            mcp_store.clone(),
            Arc::new(RwLock::new(cloud_base_url)),
        );
        (service, model, mcp_store)
    }

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

    #[test]
    fn build_upstream_endpoint_deduplicates_v1_prefix_for_embedding() {
        let helper = crate::modules::providers::request_runtime::build_upstream_url_with_params;
        assert_eq!(
            helper(
                "https://api.example.com/v1",
                "v1/embeddings",
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
                "embeddings",
                Some("openai"),
                Some(false),
                None,
            ),
            (
                "https://api.example.com/embeddings".to_string(),
                serde_json::json!({}),
            )
        );
    }

    #[test]
    fn uses_platform_proxy_only_for_platform_credential_source() {
        assert!(uses_platform_proxy(Some("platform")));
        assert!(uses_platform_proxy(Some(" platform ")));
        assert!(!uses_platform_proxy(Some("local")));
        assert!(!uses_platform_proxy(None));
    }

    #[test]
    fn build_platform_embedding_proxy_url_trims_trailing_slashes() {
        let url = build_platform_embedding_proxy_url("https://cloud.example.com///")
            .expect("platform proxy url");
        assert_eq!(url, "https://cloud.example.com/api/v1/internal/embeddings");
    }

    #[test]
    fn build_platform_embedding_proxy_body_includes_provider_model_id() {
        let model = mock_model("text-embedding-3-small", &["embedding"], true);
        let body = build_platform_embedding_proxy_body(&model, "hello world");

        assert_eq!(body["model"], model.model_id);
        assert_eq!(body["input"], "hello world");
        assert_eq!(body["provider_model_id"], model.id.to_string());
    }

    #[tokio::test]
    async fn platform_embedding_model_smoke_uses_internal_proxy_with_auth_token() {
        let (base_url, capture, server_handle) = start_mock_platform_embedding_server().await;
        let (service, model, _mcp_store) = create_platform_embedding_service(base_url).await;

        let vector = service
            .embed_text("hello world")
            .await
            .expect("platform embedding request should succeed");

        assert_eq!(vector, vec![0.11, 0.22, 0.33]);

        let captured = capture
            .lock()
            .expect("lock capture state")
            .clone()
            .expect("captured request");
        assert_eq!(captured.path, "/api/v1/internal/embeddings");
        assert_eq!(
            captured.authorization.as_deref(),
            Some("Bearer desktop-test-token")
        );
        assert_eq!(captured.payload["model"], model.model_id);
        assert_eq!(captured.payload["input"], "hello world");
        assert_eq!(captured.payload["provider_model_id"], model.id.to_string());

        server_handle.abort();
    }
}
