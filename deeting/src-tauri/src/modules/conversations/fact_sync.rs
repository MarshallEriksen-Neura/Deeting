use mcp_session::context::LocalConversationRuntimeWindow;
use mcp_session::conversation::{
    LocalConversationCompareFinalizeRequest, LocalConversationCompareFinalizeResponse,
};
use mcp_storage::helpers::now_rfc3339;
use mcp_storage::helpers::now_unix_epoch;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use crate::modules::memory::fact_extractor::FactExtractionOutcome;
use crate::modules::memory::service::MemoryService;
use crate::modules::memory::types::{
    LocalMemoryItem, LocalMemoryListQuery, UpdateLocalMemoryRequest,
};
use crate::state::AppState;

const FACT_EXTRACTION_LAST_HASH_KEY_PREFIX: &str = "fact_extraction.last_hash";
const FACT_EXTRACTION_LAST_RUN_AT_KEY_PREFIX: &str = "fact_extraction.last_run_at";
const FACT_EXTRACTION_LAST_VERSION_KEY_PREFIX: &str = "fact_extraction.last_version";
const FACT_EXTRACTION_ENGINE_VERSION: &str = "2026-04-16-heuristic-v1";
const FACT_EXTRACTION_COMPARE_FINALIZE_COOLDOWN_SECONDS: i64 = 120;
const FACT_EXTRACTION_CHAT_TURN_MIN_INTERVAL_SECONDS: i64 = 120;
const FACT_EXTRACTION_STALE_DELETE_AFTER_ROUNDS: i64 = 2;

pub(crate) fn build_fact_extraction_last_hash_key(session_id: &str) -> String {
    format!("{}.{}", FACT_EXTRACTION_LAST_HASH_KEY_PREFIX, session_id)
}

pub(crate) fn build_fact_extraction_last_run_at_key(session_id: &str) -> String {
    format!("{}.{}", FACT_EXTRACTION_LAST_RUN_AT_KEY_PREFIX, session_id)
}

pub(crate) fn build_fact_extraction_last_version_key(session_id: &str) -> String {
    format!("{}.{}", FACT_EXTRACTION_LAST_VERSION_KEY_PREFIX, session_id)
}

fn hash_fact_extraction_conversation_text(conversation_text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(conversation_text.trim().as_bytes());
    hex::encode(hasher.finalize())
}

pub(crate) async fn sync_compare_finalize_memories(
    app_state: AppState,
    _payload: &LocalConversationCompareFinalizeRequest,
    response: &LocalConversationCompareFinalizeResponse,
) -> Result<(), String> {
    let fact_app_state = app_state.clone();
    let fact_session_id = response.session_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = refresh_session_auto_extracted_facts_with_source(
            fact_app_state,
            &fact_session_id,
            "compare_finalize",
        )
        .await
        {
            log::warn!(
                "compare finalize fact rebuild failed for session {}: {}",
                fact_session_id,
                err
            );
        }
    });

    Ok(())
}

pub(crate) async fn refresh_session_auto_extracted_facts(
    app_state: AppState,
    session_id: &str,
) -> Result<FactExtractionOutcome, String> {
    refresh_session_auto_extracted_facts_with_source(app_state, session_id, "new_chat").await
}

pub(crate) async fn refresh_session_auto_extracted_facts_after_chat_turn(
    app_state: AppState,
    session_id: &str,
) -> Result<FactExtractionOutcome, String> {
    refresh_session_auto_extracted_facts_with_source(app_state, session_id, "chat_turn").await
}

async fn refresh_session_auto_extracted_facts_with_source(
    app_state: AppState,
    session_id: &str,
    trigger_source: &str,
) -> Result<FactExtractionOutcome, String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Ok(FactExtractionOutcome::Skipped);
    }
    let normalized_trigger_source = trigger_source.trim().to_string();
    let last_run_at_key = build_fact_extraction_last_run_at_key(&normalized_session_id);
    let existing_last_run_at = app_state
        .mcp
        .store
        .get_desktop_config(&last_run_at_key)
        .await
        .map_err(|err| err.to_string())?;
    let now_epoch = now_unix_epoch().map_err(|err| err.to_string())?;
    if let Some(last_run_at) = existing_last_run_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok())
    {
        let min_interval = if normalized_trigger_source == "compare_finalize" {
            FACT_EXTRACTION_COMPARE_FINALIZE_COOLDOWN_SECONDS
        } else {
            FACT_EXTRACTION_CHAT_TURN_MIN_INTERVAL_SECONDS
        };
        if now_epoch.saturating_sub(last_run_at) < min_interval {
            log::info!(
                "fact extraction refresh skipped {} cooldown session={}",
                normalized_trigger_source,
                normalized_session_id
            );
            return Ok(FactExtractionOutcome::Skipped);
        }
    }

    let runtime_window = app_state
        .mcp
        .store
        .load_local_conversation_runtime_window(&normalized_session_id)
        .await
        .map_err(|err| err.to_string())?;

    if runtime_window.messages.len() < 2 {
        return Ok(FactExtractionOutcome::Skipped);
    }

    let Some(conversation_text) = build_fact_rebuild_conversation_text(&runtime_window) else {
        return Ok(FactExtractionOutcome::Skipped);
    };
    let conversation_hash = hash_fact_extraction_conversation_text(&conversation_text);
    let hash_key = build_fact_extraction_last_hash_key(&normalized_session_id);
    let version_key = build_fact_extraction_last_version_key(&normalized_session_id);
    let existing_hash = app_state
        .mcp
        .store
        .get_desktop_config(&hash_key)
        .await
        .map_err(|err| err.to_string())?;
    let existing_version = app_state
        .mcp
        .store
        .get_desktop_config(&version_key)
        .await
        .map_err(|err| err.to_string())?;
    if existing_hash
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        == Some(conversation_hash.as_str())
        && existing_version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(FACT_EXTRACTION_ENGINE_VERSION)
    {
        log::info!(
            "fact extraction refresh skipped unchanged session={}",
            normalized_session_id
        );
        return Ok(FactExtractionOutcome::Skipped);
    }
    if existing_hash
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        == Some(conversation_hash.as_str())
    {
        log::info!(
            "fact extraction refresh forced by extractor version session={} stored_version={} current_version={}",
            normalized_session_id,
            existing_version.as_deref().unwrap_or("-"),
            FACT_EXTRACTION_ENGINE_VERSION
        );
    }

    let outcome =
        crate::modules::memory::fact_extractor::extract_and_store_facts_with_secretary_model(
            &app_state,
            app_state.memory.service.clone(),
            &conversation_text,
            &normalized_session_id,
            runtime_window.assistant_id.as_deref(),
        )
        .await?;

    let reconciled = reconcile_session_auto_extraction_memories(
        app_state.memory.service.as_ref(),
        &normalized_session_id,
        touched_memory_ids_from_outcome(&outcome),
    )
    .await?;
    if reconciled.marked_stale > 0 || reconciled.deleted > 0 || reconciled.reactivated > 0 {
        log::info!(
            "fact extraction reconcile session={} reactivated={} marked_stale={} deleted={}",
            normalized_session_id,
            reconciled.reactivated,
            reconciled.marked_stale,
            reconciled.deleted
        );
    }

    if let Err(err) = app_state
        .mcp
        .store
        .set_desktop_config(&hash_key, &conversation_hash)
        .await
    {
        log::warn!(
            "fact extraction hash marker write failed session={} err={}",
            normalized_session_id,
            err
        );
    }
    if let Ok(now_epoch) = now_unix_epoch().map_err(|err| err.to_string()) {
        if let Err(err) = app_state
            .mcp
            .store
            .set_desktop_config(&last_run_at_key, &now_epoch.to_string())
            .await
        {
            log::warn!(
                "fact extraction run marker write failed session={} err={}",
                normalized_session_id,
                err
            );
        }
    }
    if let Err(err) = app_state
        .mcp
        .store
        .set_desktop_config(&version_key, FACT_EXTRACTION_ENGINE_VERSION)
        .await
    {
        log::warn!(
            "fact extraction version marker write failed session={} err={}",
            normalized_session_id,
            err
        );
    }

    Ok(outcome)
}

#[derive(Debug, Default)]
struct FactReconcileSummary {
    reactivated: usize,
    marked_stale: usize,
    deleted: usize,
}

async fn reconcile_session_auto_extraction_memories(
    memory_service: &MemoryService,
    session_id: &str,
    touched_memory_ids: HashSet<String>,
) -> Result<FactReconcileSummary, String> {
    let mut summary = FactReconcileSummary::default();
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let existing_items = list_session_auto_extraction_memories(memory_service, session_id).await?;

    for item in existing_items {
        let touched = touched_memory_ids.contains(item.id.as_str());
        let mut metadata = item
            .meta_info
            .clone()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        metadata
            .entry("source".to_string())
            .or_insert_with(|| Value::String("auto_extraction".to_string()));
        let auto_extraction = metadata
            .entry("auto_extraction".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        let Some(auto_extraction) = auto_extraction.as_object_mut() else {
            continue;
        };

        if touched {
            auto_extraction.insert("state".to_string(), Value::String("active".to_string()));
            auto_extraction.insert("stale_rounds".to_string(), Value::from(0));
            auto_extraction.insert("last_reconciled_at".to_string(), Value::String(now.clone()));
            if auto_extraction
                .get("stale_candidate_at")
                .is_some_and(|value| !value.is_null())
            {
                auto_extraction.insert("stale_candidate_at".to_string(), Value::Null);
                memory_service
                    .update(
                        &item.id,
                        UpdateLocalMemoryRequest {
                            content: item.content.clone(),
                            meta_info: Some(Value::Object(metadata)),
                            category: item.category.clone(),
                            source: item.source.clone(),
                            tags: item.tags.clone(),
                        },
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                summary.reactivated += 1;
            }
            continue;
        }

        let stale_rounds = auto_extraction
            .get("stale_rounds")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            + 1;
        if stale_rounds >= FACT_EXTRACTION_STALE_DELETE_AFTER_ROUNDS {
            let deleted = memory_service
                .delete(&item.id)
                .await
                .map_err(|err| err.to_string())?;
            if deleted {
                summary.deleted += 1;
            }
            continue;
        }

        auto_extraction.insert("state".to_string(), Value::String("stale".to_string()));
        auto_extraction.insert("stale_rounds".to_string(), Value::from(stale_rounds));
        auto_extraction.insert("stale_candidate_at".to_string(), Value::String(now.clone()));
        auto_extraction.insert("last_reconciled_at".to_string(), Value::String(now.clone()));
        memory_service
            .update(
                &item.id,
                UpdateLocalMemoryRequest {
                    content: item.content.clone(),
                    meta_info: Some(Value::Object(metadata)),
                    category: item.category.clone(),
                    source: item.source.clone(),
                    tags: item.tags.clone(),
                },
            )
            .await
            .map_err(|err| err.to_string())?;
        summary.marked_stale += 1;
    }

    Ok(summary)
}

fn touched_memory_ids_from_outcome(outcome: &FactExtractionOutcome) -> HashSet<String> {
    match outcome {
        FactExtractionOutcome::Processed(summary) => summary
            .touched_memory_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>(),
        FactExtractionOutcome::NoFacts | FactExtractionOutcome::Skipped => HashSet::new(),
    }
}

async fn list_session_auto_extraction_memories(
    memory_service: &MemoryService,
    session_id: &str,
) -> Result<Vec<LocalMemoryItem>, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    let mut cursor = None;
    loop {
        let page = memory_service
            .list(LocalMemoryListQuery {
                cursor: cursor.clone(),
                limit: Some(200),
                session_id: Some(normalized_session_id.to_string()),
                capability_id: None,
            })
            .await
            .map_err(|err| err.to_string())?;

        for item in page.items {
            if is_auto_extracted_memory(&item) {
                items.push(item);
            }
        }

        if !page.has_more {
            break;
        }
        cursor = page.next_cursor;
    }

    Ok(items)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn clear_session_auto_extraction_memories(
    memory_service: &MemoryService,
    session_id: &str,
) -> Result<usize, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(0);
    }

    let mut deleted = 0usize;
    let mut cursor = None;
    loop {
        let page = memory_service
            .list(LocalMemoryListQuery {
                cursor: cursor.clone(),
                limit: Some(200),
                session_id: Some(normalized_session_id.to_string()),
                capability_id: None,
            })
            .await
            .map_err(|err| err.to_string())?;

        for item in &page.items {
            if !is_auto_extracted_memory(item) {
                continue;
            }
            let removed = memory_service
                .delete(&item.id)
                .await
                .map_err(|err| err.to_string())?;
            if removed {
                deleted += 1;
            }
        }

        if !page.has_more {
            break;
        }
        cursor = page.next_cursor;
    }

    Ok(deleted)
}

fn is_auto_extracted_memory(item: &LocalMemoryItem) -> bool {
    item.source
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
        .unwrap_or(false)
        || item
            .meta_info
            .as_ref()
            .and_then(|value| value.get("source"))
            .and_then(|value| value.as_str())
            .map(|value| value.eq_ignore_ascii_case("auto_extraction"))
            .unwrap_or(false)
}

fn build_fact_rebuild_conversation_text(
    runtime_window: &LocalConversationRuntimeWindow,
) -> Option<String> {
    let mut sections = Vec::new();
    if let Some(summary_text) = extract_summary_text(runtime_window.summary.as_ref()) {
        sections.push(format!("Summary: {}", summary_text));
    }

    for message in &runtime_window.messages {
        if !message.role.trim().eq_ignore_ascii_case("user") {
            continue;
        }
        let Some(content) = history_message_text(message.content.as_ref()) else {
            continue;
        };
        sections.push(format!("User: {}", content));
    }

    let conversation = sections.join("\n").trim().to_string();
    if conversation.is_empty() {
        None
    } else {
        Some(conversation)
    }
}

fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn history_message_text(content: Option<&Value>) -> Option<String> {
    content
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{
        build_fact_extraction_last_run_at_key, build_fact_rebuild_conversation_text,
        clear_session_auto_extraction_memories,
        refresh_session_auto_extracted_facts_after_chat_turn, FactExtractionOutcome,
    };
    use crate::modules::browser_agent::BrowserAgentState;
    use crate::modules::code_mode::CodemodeToolState;
    use crate::modules::im::wechat::WechatState;
    use crate::modules::knowledge::KnowledgeState;
    use crate::modules::mcp::McpRuntimeState;
    use crate::modules::memory::types::{CreateLocalMemoryRequest, LocalMemoryListQuery};
    use crate::modules::monitor::MonitorState;
    use crate::modules::providers::ProviderState;
    use crate::modules::sandbox::SandboxState;
    use crate::state::AppState;
    use axum::{extract::State as AxumState, routing::post, Json, Router};
    use mcp_session::context::LocalConversationRuntimeWindow;
    use mcp_session::conversation::{
        CreateConversationMessageRequest, LocalConversationCreateRequest,
        LocalConversationHistoryMessage,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::time::Duration;
    use tokio::net::TcpListener;
    use uuid::Uuid;

    async fn create_test_memory_state(test_name: &str) -> crate::modules::memory::MemoryState {
        let mut lancedb_path = std::env::temp_dir();
        lancedb_path.push(format!(
            "deeting-tauri-conversation-fact-sync-{test_name}-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&lancedb_path).expect("create lancedb dir");
        let lancedb_uri = lancedb_path.to_string_lossy().replace('\\', "/");
        crate::modules::memory::MemoryState::new(&lancedb_uri)
            .await
            .expect("create test memory state")
    }

    async fn insert_embedding_instance(
        store: &crate::modules::providers::store::ProviderStore,
        base_url: &str,
    ) -> String {
        let instance_id = Uuid::new_v4().to_string();
        let credential_id = Uuid::new_v4().to_string();
        let now = crate::modules::providers::store::utils::now_rfc3339().expect("time");
        let meta = serde_json::json!({
            "protocol": "openai",
            "auto_append_v1": true,
        })
        .to_string();
        sqlx::query(
            "INSERT INTO provider_instances (
                id, preset_slug, name, base_url, description, icon, priority, meta,
                is_enabled, is_local, credentials_ref, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&instance_id)
        .bind("openai")
        .bind("Mock Embedding Provider")
        .bind(base_url)
        .bind::<Option<&str>>(None)
        .bind::<Option<&str>>(None)
        .bind(0_i64)
        .bind(&meta)
        .bind(1_i64)
        .bind(1_i64)
        .bind(format!("db:{credential_id}"))
        .bind(&now)
        .bind(&now)
        .execute(&store.pool)
        .await
        .expect("insert embedding instance");

        sqlx::query(
            "INSERT INTO provider_credentials (id, instance_id, alias, secret_key, created_at)
             VALUES (?, ?, 'default', 'test-secret', ?)",
        )
        .bind(&credential_id)
        .bind(&instance_id)
        .bind(&now)
        .execute(&store.pool)
        .await
        .expect("insert embedding credential");

        instance_id
    }

    async fn create_test_provider_state(test_name: &str, base_url: &str) -> ProviderState {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-tauri-fact-sync-provider-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let state = ProviderState::new(&database_url)
            .await
            .expect("create test provider state");
        let instance_id = insert_embedding_instance(state.store.as_ref(), base_url).await;
        state
            .store
            .quick_add_models(
                &instance_id,
                vec!["text-embedding-3-small".to_string()],
                None,
            )
            .await
            .expect("quick add embedding model");
        let models = state
            .store
            .list_models(Some(instance_id), None)
            .await
            .expect("list provider models");
        let embedding_model = models
            .into_iter()
            .find(|model| model.model_id == "text-embedding-3-small")
            .expect("embedding model");
        let _ = state
            .store
            .get_or_create_user_embedding_config()
            .await
            .expect("init embedding config");
        state
            .store
            .update_user_embedding_config(
                crate::modules::providers::types::UserEmbeddingConfigUpdateRequest {
                    provider_model_id: Some(Some(embedding_model.id.to_string())),
                    multimodal_provider_model_id: None,
                },
            )
            .await
            .expect("set embedding model");
        state
    }

    #[derive(Clone)]
    struct MockEmbeddingServerState {
        vectors: HashMap<String, Vec<f32>>,
    }

    async fn mock_embedding_handler(
        AxumState(state): AxumState<MockEmbeddingServerState>,
        Json(payload): Json<serde_json::Value>,
    ) -> Json<serde_json::Value> {
        let input = payload
            .get("input")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let embedding = state
            .vectors
            .get(&input)
            .cloned()
            .unwrap_or_else(|| vec![0.0, 0.0, 0.0]);
        Json(serde_json::json!({
            "data": [
                {
                    "embedding": embedding,
                }
            ]
        }))
    }

    async fn start_mock_embedding_server(
        vectors: HashMap<String, Vec<f32>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock embedding listener");
        let addr = listener
            .local_addr()
            .expect("read mock embedding listener addr");
        let app = Router::new()
            .route("/embeddings", post(mock_embedding_handler))
            .route("/v1/embeddings", post(mock_embedding_handler))
            .with_state(MockEmbeddingServerState { vectors });
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        (format!("http://{}", addr), server)
    }

    async fn create_test_app_state(test_name: &str) -> (AppState, tokio::task::JoinHandle<()>) {
        let vectors = HashMap::from([
            ("user: i live in shanghai.".to_string(), vec![1.0, 0.0, 0.0]),
            (
                "user: i live in shanghai.\nuser: please remember that for next time.".to_string(),
                vec![0.9, 0.1, 0.0],
            ),
        ]);
        let (base_url, server) = start_mock_embedding_server(vectors).await;

        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-tauri-fact-sync-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = crate::modules::mcp::store::McpStore::new(&database_url)
            .await
            .expect("create test mcp store");
        store.init().await.expect("init test mcp store");
        let _ = store
            .ensure_local_source()
            .await
            .expect("ensure local source");
        crate::modules::code_mode::core_tool_contracts::sync_core_tool_registry_entries(&store)
            .await
            .expect("sync core tool registry");
        store
            .sync_all_mcp_tool_registry_entries()
            .await
            .expect("sync mcp tool registry");
        store
            .sync_all_assistant_registry_entries()
            .await
            .expect("sync assistant registry");

        let pool = store.pool.clone();
        let provider_state = create_test_provider_state(test_name, &base_url).await;
        let memory_state = create_test_memory_state(test_name).await;
        memory_state
            .service
            .recreate_local_asset_table(3)
            .await
            .expect("recreate local asset table");
        let knowledge_state = KnowledgeState::with_pool(pool.clone())
            .await
            .expect("create knowledge state");
        let code_mode = CodemodeToolState::with_pool(pool.clone())
            .await
            .expect("create code mode state");
        let wechat = WechatState::with_pool(pool.clone(), &database_url)
            .await
            .expect("create wechat state");
        let monitor = MonitorState::with_pool(pool.clone(), provider_state.store.clone(), None)
            .await
            .expect("create monitor state");

        let app_state = AppState::new(
            McpRuntimeState::new(
                std::sync::Arc::new(store),
                crate::modules::mcp::process::ProcessManager::new(),
                "http://127.0.0.1".to_string(),
            ),
            BrowserAgentState::new(),
            knowledge_state,
            provider_state,
            memory_state,
            SandboxState::new(
                std::env::temp_dir().join(format!("deeting-fact-sync-sandbox-{}", Uuid::new_v4())),
            ),
            code_mode,
            monitor,
            wechat,
        );

        (app_state, server)
    }

    #[tokio::test]
    async fn clear_session_auto_extraction_memories_pages_and_preserves_manual_rows() {
        let memory_state = create_test_memory_state("compare-finalize-cleanup").await;
        let session_id = "session-compare-finalize";

        for index in 0..35 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("auto fact {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "auto_extraction" })),
                    category: Some("fact".to_string()),
                    source: Some("auto_extraction".to_string()),
                    tags: None,
                })
                .await
                .expect("append auto-extracted memory");
        }

        for index in 0..2 {
            memory_state
                .service
                .append(CreateLocalMemoryRequest {
                    content: format!("manual note {index}"),
                    session_id: Some(session_id.to_string()),
                    capability_id: None,
                    meta_info: Some(json!({ "source": "manual" })),
                    category: Some("note".to_string()),
                    source: Some("manual".to_string()),
                    tags: None,
                })
                .await
                .expect("append manual memory");
        }

        let deleted =
            clear_session_auto_extraction_memories(memory_state.service.as_ref(), session_id)
                .await
                .expect("clear auto-extracted memories");

        assert_eq!(deleted, 35);

        let remaining = memory_state
            .service
            .list(LocalMemoryListQuery {
                cursor: None,
                limit: Some(100),
                session_id: Some(session_id.to_string()),
                capability_id: None,
            })
            .await
            .expect("list remaining memories");

        assert_eq!(remaining.items.len(), 2);
        assert!(remaining
            .items
            .iter()
            .all(|item| item.source.as_deref() == Some("manual")));
    }

    #[tokio::test]
    async fn refresh_after_chat_turn_marks_last_run_for_desktop_chat_path() {
        let (app_state, server) = create_test_app_state("chat-turn-trigger").await;
        let session = app_state
            .mcp
            .store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("Fact Trigger".to_string()),
            })
            .await
            .expect("create local conversation");

        app_state
            .mcp
            .store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "I live in Shanghai.".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user message");
        app_state
            .mcp
            .store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "I will remember that.".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant message");

        let outcome = refresh_session_auto_extracted_facts_after_chat_turn(
            app_state.clone(),
            &session.session_id,
        )
        .await
        .expect("refresh facts after chat turn");

        assert!(!matches!(outcome, FactExtractionOutcome::Skipped));

        let last_run_at = app_state
            .mcp
            .store
            .get_desktop_config(&build_fact_extraction_last_run_at_key(&session.session_id))
            .await
            .expect("read last run marker");
        assert!(last_run_at
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()));

        server.abort();
    }

    #[test]
    fn build_fact_rebuild_conversation_text_uses_summary_and_user_messages() {
        let runtime_window = LocalConversationRuntimeWindow {
            session_id: "session-1".to_string(),
            assistant_id: Some("assistant-1".to_string()),
            meta: None,
            summary: Some(json!({ "summary_text": "User is building desktop compare mode." })),
            messages: vec![
                LocalConversationHistoryMessage {
                    role: "user".to_string(),
                    content: Some(json!("Please compare these answers.")),
                    turn_index: Some(1),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
                LocalConversationHistoryMessage {
                    role: "assistant".to_string(),
                    content: Some(json!("Winner answer kept in canonical history.")),
                    turn_index: Some(2),
                    created_at: None,
                    is_truncated: Some(false),
                    name: None,
                    meta_info: None,
                },
            ],
        };

        let conversation = build_fact_rebuild_conversation_text(&runtime_window)
            .expect("build fact rebuild conversation");

        assert!(conversation.contains("Summary: User is building desktop compare mode."));
        assert!(conversation.contains("User: Please compare these answers."));
        assert!(!conversation.contains("Assistant: Winner answer kept in canonical history."));
    }
}
