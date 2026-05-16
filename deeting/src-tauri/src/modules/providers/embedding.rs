use crate::modules::providers::error::ProviderError;
use crate::modules::providers::store::utils::has_embedding_capability;
use crate::modules::providers::store::ProviderStore;
use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};
use serde::Deserialize;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone)]
struct PlatformEmbeddingProxyConfig {
    mcp_store: Arc<crate::modules::mcp::store::McpStore>,
    #[allow(dead_code)]
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

const EMBEDDING_CHUNK_TARGET_CHARS: usize = 3000;
const EMBEDDING_CHUNK_OVERLAP_CHARS: usize = 300;
const EMBEDDING_CHUNK_MAX_DEPTH: usize = 8;

#[derive(Clone)]
struct ResolvedEmbeddingRequest {
    model: ProviderModel,
    instance: ProviderInstance,
    preset: Option<ProviderPreset>,
    secret_key: Option<String>,
}

struct PendingEmbeddingChunk {
    text: String,
    depth: usize,
}

#[derive(Clone)]
pub struct EmbeddingService {
    store: Arc<ProviderStore>,
    client: reqwest::Client,
    mcp_store: Option<Arc<crate::modules::mcp::store::McpStore>>,
    platform_proxy: Option<PlatformEmbeddingProxyConfig>,
}

impl EmbeddingService {
    pub fn new(
        store: Arc<ProviderStore>,
        mcp_store: Option<Arc<crate::modules::mcp::store::McpStore>>,
    ) -> Self {
        Self {
            store,
            client: reqwest::Client::new(),
            mcp_store,
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
            mcp_store: Some(mcp_store.clone()),
            platform_proxy: Some(PlatformEmbeddingProxyConfig {
                mcp_store,
                cloud_base_url,
            }),
        }
    }

    async fn upstream_client(&self) -> Result<reqwest::Client, ProviderError> {
        match self.mcp_store.as_ref() {
            Some(store) => {
                crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
                    store.as_ref(),
                )
                .await
                .map_err(ProviderError::Network)
            }
            None => Ok(self.client.clone()),
        }
    }

    pub async fn embed_text(&self, text: &str) -> Result<Vec<f32>, ProviderError> {
        let request = self.resolve_embedding_request().await?;
        let mut pending = VecDeque::from([PendingEmbeddingChunk {
            text: text.to_string(),
            depth: 0,
        }]);
        let mut vectors: Vec<Vec<f32>> = Vec::new();
        let mut weights: Vec<usize> = Vec::new();

        while let Some(chunk) = pending.pop_front() {
            match self.request_text_embedding(&request, &chunk.text).await {
                Ok(vector) => {
                    weights.push(chunk.text.chars().count().max(1));
                    vectors.push(vector);
                }
                Err(error) if is_input_too_long_error(&error) => {
                    if chunk.depth >= EMBEDDING_CHUNK_MAX_DEPTH {
                        return Err(ProviderError::Network(
                            "embedding input remains too long after chunk retries".to_string(),
                        ));
                    }

                    let chunks = split_text_for_embedding(&chunk.text, true);
                    if chunks.len() <= 1 {
                        return Err(error);
                    }

                    log::warn!(
                        "EmbeddingService: input too long, applying chunk fallback depth={} chunks={}",
                        chunk.depth,
                        chunks.len()
                    );

                    for next in chunks.into_iter().rev() {
                        pending.push_front(PendingEmbeddingChunk {
                            text: next,
                            depth: chunk.depth + 1,
                        });
                    }
                }
                Err(error) => return Err(error),
            }
        }

        if vectors.is_empty() {
            return Err(ProviderError::Network(
                "Empty embedding data in response".to_string(),
            ));
        }
        if vectors.len() == 1 {
            return vectors.pop().ok_or_else(|| {
                ProviderError::Network("Empty embedding data in response".to_string())
            });
        }
        aggregate_chunk_vectors(vectors, weights)
    }

    async fn resolve_embedding_request(&self) -> Result<ResolvedEmbeddingRequest, ProviderError> {
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
            return Err(ProviderError::Validation(
                "platform credits embedding runtime has been disabled; switch embedding model to local credentials"
                    .to_string(),
            ));
        }

        let instance = self
            .store
            .get_instance(&embedding_model.instance_id.to_string())
            .await?
            .ok_or_else(|| ProviderError::Validation("Model instance not found".to_string()))?;
        let preset = self.store.get_preset(&instance.preset_slug).await?;

        Ok(ResolvedEmbeddingRequest {
            model: embedding_model.clone(),
            instance,
            preset,
            secret_key: connection.secret_key,
        })
    }

    async fn request_text_embedding(
        &self,
        request: &ResolvedEmbeddingRequest,
        text: &str,
    ) -> Result<Vec<f32>, ProviderError> {
        let prepared = crate::modules::providers::request_runtime::prepare_provider_request(
            request.preset.as_ref(),
            &request.instance,
            &request.model,
            request.secret_key.as_deref(),
            "embedding",
            serde_json::json!({
                "model": request.model.model_id.clone(),
                "input": text.to_string(),
            }),
            None,
            None,
        )
        .map_err(ProviderError::Network)?;

        let client = self.upstream_client().await?;
        let response = crate::modules::providers::request_runtime::send_prepared_json_request(
            &client, &prepared,
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

    #[allow(dead_code)]
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
        let client = self.upstream_client().await?;
        let response = client
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

#[cfg_attr(not(test), allow(dead_code))]
fn build_platform_embedding_proxy_url(base_url: &str) -> Result<String, ProviderError> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return Err(ProviderError::Validation(
            "cloud API base URL not configured; set api.base_url for platform models".to_string(),
        ));
    }
    Ok(format!("{}/api/v1/internal/embeddings", normalized))
}

#[cfg_attr(not(test), allow(dead_code))]
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

#[cfg_attr(not(test), allow(dead_code))]
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

fn split_text_for_embedding(text: &str, force: bool) -> Vec<String> {
    let raw = text.to_string();
    let chars: Vec<char> = raw.chars().collect();
    if chars.is_empty() {
        return vec![String::new()];
    }

    if chars.len() <= EMBEDDING_CHUNK_TARGET_CHARS {
        if force && chars.len() > 1 {
            let midpoint = chars.len() / 2;
            return vec![
                chars[..midpoint].iter().collect::<String>(),
                chars[midpoint..].iter().collect::<String>(),
            ];
        }
        return vec![raw];
    }

    let mut chunks = Vec::new();
    let step = (EMBEDDING_CHUNK_TARGET_CHARS.saturating_sub(EMBEDDING_CHUNK_OVERLAP_CHARS)).max(1);
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + EMBEDDING_CHUNK_TARGET_CHARS).min(chars.len());
        let chunk = chars[start..end].iter().collect::<String>();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        if end >= chars.len() {
            break;
        }
        start += step;
    }
    chunks
}

/// Combine multiple chunk embeddings into a single vector via weighted
/// mean + L2 normalization.
///
/// Contract:
/// - `vectors` and `weights` must have the same length; mismatch is an
///   error rather than a silent zip-truncate.
/// - `weights` are typically chunk character counts. A zero weight is
///   honored as "skip this chunk", letting callers opt out without
///   removing the vector from the input.
/// - At least one weight must be > 0; otherwise `Validation` is returned
///   (nothing to average).
///
/// On an all-zero merged vector the function skips L2 normalization and
/// returns the raw (zero) average — a deliberate fallback so downstream
/// cosine search degrades to "no matches" instead of producing NaNs.
fn aggregate_chunk_vectors(
    vectors: Vec<Vec<f32>>,
    weights: Vec<usize>,
) -> Result<Vec<f32>, ProviderError> {
    // Contract checks first — zip() below would silently truncate on a
    // length mismatch and quietly drop data, so fail loudly before any
    // math runs.
    if weights.len() != vectors.len() {
        return Err(ProviderError::Validation(format!(
            "aggregate_chunk_vectors: weight count {} does not match vector count {}",
            weights.len(),
            vectors.len()
        )));
    }
    if vectors.is_empty() {
        return Err(ProviderError::Validation(
            "aggregate_chunk_vectors: no embedding chunks to aggregate".to_string(),
        ));
    }

    let dim = vectors[0].len();
    if dim == 0 {
        return Err(ProviderError::Validation(
            "aggregate_chunk_vectors: embedding vector has zero dimension".to_string(),
        ));
    }
    if vectors.iter().any(|vector| vector.len() != dim) {
        return Err(ProviderError::Validation(format!(
            "aggregate_chunk_vectors: inconsistent vector dimensions (expected {dim})"
        )));
    }

    let total_weight = weights.iter().map(|weight| *weight as f32).sum::<f32>();
    if total_weight <= f32::EPSILON {
        return Err(ProviderError::Validation(
            "aggregate_chunk_vectors: weights must contain at least one positive value".to_string(),
        ));
    }

    let mut merged = vec![0.0f32; dim];
    for (vector, weight) in vectors.iter().zip(weights.iter()) {
        // weight == 0 intentionally excludes the chunk from the merge.
        let weight = *weight as f32;
        for (idx, value) in vector.iter().enumerate() {
            merged[idx] += *value * weight;
        }
    }

    let averaged = merged
        .into_iter()
        .map(|value| value / total_weight)
        .collect::<Vec<_>>();
    let norm = averaged
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if norm <= f32::EPSILON {
        // All-zero aggregate; L2 norm is undefined. Returning the raw
        // (zero) vector makes downstream cosine search return no matches
        // instead of dividing by ~0 and producing NaNs.
        return Ok(averaged);
    }
    Ok(averaged.into_iter().map(|value| value / norm).collect())
}

fn is_input_too_long_error(error: &ProviderError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    let bad_request = message.contains("status=400")
        || message.contains("400 bad request")
        || message.contains("bad request");
    if !bad_request {
        return false;
    }
    (message.contains("input length")
        && message.contains("token")
        && message.contains("exceeds maximum allowed token size"))
        || message.contains("maximum context length")
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
        aggregate_chunk_vectors, build_platform_embedding_proxy_body,
        build_platform_embedding_proxy_url, select_embedding_model, split_text_for_embedding,
        uses_platform_proxy, EmbeddingService,
    };
    use crate::modules::providers::error::ProviderError;
    use crate::modules::providers::types::ProviderModel;
    use axum::{
        extract::State as AxumState,
        http::{HeaderMap, StatusCode, Uri},
        routing::post,
        Json, Router,
    };
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::net::TcpListener;
    use tokio::sync::RwLock;
    use uuid::Uuid;

    #[allow(dead_code)]
    #[derive(Debug, Clone)]
    struct PlatformEmbeddingRequestCapture {
        path: String,
        authorization: Option<String>,
        payload: serde_json::Value,
    }

    #[derive(Debug, Default)]
    struct LocalEmbeddingRequestCapture {
        max_chars: usize,
        calls: Vec<String>,
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

    async fn mock_local_embedding_handler(
        AxumState(state): AxumState<Arc<Mutex<LocalEmbeddingRequestCapture>>>,
        Json(payload): Json<serde_json::Value>,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let text = payload
            .get("input")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        let mut guard = state.lock().expect("lock local capture state");
        guard.calls.push(text.clone());
        if text.chars().count() > guard.max_chars {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!(
                        "Input length {} exceeds maximum allowed token size {}",
                        text.chars().count(),
                        guard.max_chars
                    )
                })),
            );
        }
        (
            StatusCode::OK,
            Json(serde_json::json!({
                "data": [
                    {
                        "embedding": [text.chars().count() as f32, 0.0]
                    }
                ]
            })),
        )
    }

    async fn start_mock_local_embedding_server(
        max_chars: usize,
    ) -> (
        String,
        Arc<Mutex<LocalEmbeddingRequestCapture>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock local embedding listener");
        let addr = listener
            .local_addr()
            .expect("read mock local embedding listener addr");
        let capture = Arc::new(Mutex::new(LocalEmbeddingRequestCapture {
            max_chars,
            calls: Vec::new(),
        }));
        let app = Router::new()
            .route("/v1/embeddings", post(mock_local_embedding_handler))
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
                app_id: None,
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
                    multimodal_provider_model_id: None,
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

    async fn create_local_embedding_service(base_url: String) -> EmbeddingService {
        let provider_store = Arc::new(
            crate::modules::providers::store::ProviderStore::new(&temp_sqlite_url("local"))
                .await
                .expect("create local provider store"),
        );
        provider_store
            .init()
            .await
            .expect("init local provider store");

        let instance = provider_store
            .create_instance(crate::modules::providers::types::CreateInstanceRequest {
                preset_slug: "openai".to_string(),
                name: "Local Embedding".to_string(),
                base_url,
                chat_transport_path: None,
                description: None,
                icon: None,
                priority: Some(0),
                protocol: Some("openai".to_string()),
                model_prefix: None,
                auto_append_v1: Some(false),
                resource_name: None,
                deployment_name: None,
                api_version: None,
                project_id: None,
                region: None,
                app_id: None,
                is_local: Some(true),
                credential_source: Some("local".to_string()),
                secret_key: Some("desktop-test-secret".to_string()),
            })
            .await
            .expect("create local instance");

        provider_store
            .quick_add_models(
                &instance.id.to_string(),
                vec!["text-embedding-3-small".to_string()],
                Some("embedding"),
            )
            .await
            .expect("quick add local embedding model");

        let _ = provider_store
            .get_or_create_user_embedding_config()
            .await
            .expect("init local embedding config");
        let model = provider_store
            .list_active_models()
            .await
            .expect("list local active models")
            .into_iter()
            .find(|item| item.model_id == "text-embedding-3-small")
            .expect("local embedding model");
        provider_store
            .update_user_embedding_config(
                crate::modules::providers::types::UserEmbeddingConfigUpdateRequest {
                    provider_model_id: Some(Some(model.id.to_string())),
                    multimodal_provider_model_id: None,
                },
            )
            .await
            .expect("select local embedding model");

        EmbeddingService::new(provider_store, None)
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
    async fn platform_embedding_model_smoke_returns_disabled_error_without_proxy_request() {
        let (base_url, capture, server_handle) = start_mock_platform_embedding_server().await;
        let (service, _model, _mcp_store) = create_platform_embedding_service(base_url).await;

        let err = service
            .embed_text("hello world")
            .await
            .expect_err("platform embedding runtime should be disabled");
        assert!(
            err.to_string()
                .contains("platform credits embedding runtime has been disabled"),
            "unexpected error: {err}"
        );

        let captured = capture.lock().expect("lock capture state").clone();
        assert!(
            captured.is_none(),
            "proxy request should not be issued when runtime is disabled"
        );

        server_handle.abort();
    }

    #[test]
    fn split_text_for_embedding_force_splits_small_input_in_half() {
        let chunks = split_text_for_embedding("abcdefghij", true);

        assert_eq!(chunks, vec!["abcde".to_string(), "fghij".to_string()]);
    }

    #[test]
    fn aggregate_chunk_vectors_rejects_mismatched_weight_count() {
        let err = aggregate_chunk_vectors(vec![vec![1.0, 0.0], vec![0.0, 1.0]], vec![1])
            .expect_err("mismatched weights should be rejected");

        assert!(matches!(err, ProviderError::Validation(_)));
        assert!(
            err.to_string().contains("weight count"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn aggregate_chunk_vectors_allows_zero_weight_to_exclude_chunk() {
        let vector = aggregate_chunk_vectors(vec![vec![1.0, 0.0], vec![0.0, 1.0]], vec![0, 1])
            .expect("zero-weight chunk should be ignored");

        assert_eq!(vector, vec![0.0, 1.0]);
    }

    #[test]
    fn aggregate_chunk_vectors_rejects_all_zero_weights() {
        let err = aggregate_chunk_vectors(vec![vec![1.0, 0.0], vec![0.0, 1.0]], vec![0, 0])
            .expect_err("all-zero weights cannot produce an average");

        assert!(matches!(err, ProviderError::Validation(_)));
        assert!(
            err.to_string().contains("at least one positive value"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn embed_text_splits_and_aggregates_when_upstream_rejects_long_input() {
        let (base_url, capture, server_handle) = start_mock_local_embedding_server(5).await;
        let service = create_local_embedding_service(base_url).await;

        let vector = service
            .embed_text("abcdefghij")
            .await
            .expect("embedding with fallback");

        let calls = capture
            .lock()
            .expect("lock local capture state")
            .calls
            .clone();
        assert_eq!(calls, vec!["abcdefghij", "abcde", "fghij"]);
        assert_eq!(vector, vec![1.0, 0.0]);

        server_handle.abort();
    }

    #[tokio::test]
    async fn embed_text_recursively_splits_when_chunk_is_still_too_long() {
        let (base_url, capture, server_handle) = start_mock_local_embedding_server(2).await;
        let service = create_local_embedding_service(base_url).await;

        let vector = service
            .embed_text("abcdefgh")
            .await
            .expect("recursive embedding fallback");

        let calls = capture
            .lock()
            .expect("lock local capture state")
            .calls
            .clone();
        assert_eq!(calls[0], "abcdefgh");
        assert!(calls.contains(&"abcd".to_string()));
        assert!(calls.contains(&"efgh".to_string()));
        assert_eq!(calls.iter().filter(|item| item.as_str() == "ab").count(), 1);
        assert_eq!(calls.iter().filter(|item| item.as_str() == "cd").count(), 1);
        assert_eq!(calls.iter().filter(|item| item.as_str() == "ef").count(), 1);
        assert_eq!(calls.iter().filter(|item| item.as_str() == "gh").count(), 1);
        assert_eq!(vector, vec![1.0, 0.0]);

        server_handle.abort();
    }
}
