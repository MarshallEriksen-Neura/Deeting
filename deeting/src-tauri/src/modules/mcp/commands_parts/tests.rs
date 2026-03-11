#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::{
        apply_config_payload_to_store, list_local_stdio_tools,
    };
    use axum::{
        extract::State as AxumState,
        routing::{get, post},
        Json, Router,
    };
    use serde::Deserialize;
    use std::collections::{HashMap, HashSet};
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tokio::net::TcpListener;
    use tokio::sync::RwLock;

    fn env_lock() -> &'static Mutex<()> {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    async fn create_test_store(test_name: &str) -> crate::modules::mcp::store::McpStore {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!("deeting-tauri-{test_name}-{}.db", Uuid::new_v4()));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));

        let store = crate::modules::mcp::store::McpStore::new(&database_url)
            .await
            .expect("create test mcp store");
        store.init().await.expect("init test mcp store");
        let _ = store
            .ensure_cloud_source("http://127.0.0.1:8000")
            .await
            .expect("ensure cloud source");
        let _ = store
            .ensure_local_source()
            .await
            .expect("ensure local source");
        store
    }

    async fn create_test_memory_state(
        test_name: &str,
        vector_dim: i32,
    ) -> crate::modules::memory::MemoryState {
        let mut lancedb_path = std::env::temp_dir();
        lancedb_path.push(format!(
            "deeting-tauri-lancedb-{test_name}-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&lancedb_path).expect("create lancedb dir");
        let lancedb_uri = lancedb_path.to_string_lossy().replace('\\', "/");
        let state = crate::modules::memory::MemoryState::new(&lancedb_uri)
            .await
            .expect("create test memory state");
        state
            .service
            .recreate_local_asset_table(vector_dim)
            .await
            .expect("recreate local asset table");
        state
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

    async fn create_test_provider_state(
        test_name: &str,
        base_url: &str,
    ) -> crate::modules::providers::ProviderState {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-tauri-provider-{test_name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let state = crate::modules::providers::ProviderState::new(&database_url)
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

    async fn start_failing_embedding_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind failing embedding listener");
        let addr = listener
            .local_addr()
            .expect("read failing embedding listener addr");
        let app = Router::new();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        (format!("http://{}", addr), server)
    }

    async fn seed_cloud_assistant_for_consult(
        store: &crate::modules::mcp::store::McpStore,
        assistant_id: &str,
        name: &str,
        description: &str,
    ) {
        store
            .sync_cloud_system_assistants(&[CloudSystemAssistantSnapshot {
                assistant_id: assistant_id.to_string(),
                icon_id: None,
                share_slug: None,
                summary: Some(description.to_string()),
                published_at: None,
                install_count: 0,
                rating_avg: 0.0,
                rating_count: 0,
                version: CloudSystemAssistantVersionSnapshot {
                    id: format!("{assistant_id}-v1"),
                    version: "1.0.0".to_string(),
                    name: name.to_string(),
                    description: Some(description.to_string()),
                    system_prompt: Some("You are a helpful specialist.".to_string()),
                    tags: vec!["weather".to_string(), "天气".to_string()],
                    published_at: None,
                },
            }])
            .await
            .expect("sync cloud assistant");
        store
            .install_local_assistant(
                assistant_id,
                LocalAssistantInstallCreateRequest {
                    follow_latest: Some(true),
                    pinned_version_id: None,
                },
            )
            .await
            .expect("install local assistant");
    }

    async fn upsert_test_tool(
        store: &crate::modules::mcp::store::McpStore,
        name: &str,
        command: &str,
    ) -> McpTool {
        upsert_test_tool_with_identifier(store, name, command, Some(format!("test/{name}"))).await
    }

    async fn upsert_test_tool_with_identifier(
        store: &crate::modules::mcp::store::McpStore,
        name: &str,
        command: &str,
        identifier: Option<String>,
    ) -> McpTool {
        let source = store
            .ensure_local_source()
            .await
            .expect("ensure local source for test tool");
        let config_json = serde_json::json!({
            "command": command,
            "args": [],
            "capabilities": ["test"],
            "description": "test tool",
        })
        .to_string();
        store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: source.id.clone(),
                identifier,
                name: name.to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec!["test".to_string()],
                description: "test tool".to_string(),
                error: None,
                command: Some(command.to_string()),
                args: None,
                env: None,
                config_json: config_json.clone(),
                config_hash: hash_config(&config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("upsert test tool")
    }

    async fn upsert_test_remote_sse_tool(
        store: &crate::modules::mcp::store::McpStore,
        server_name: &str,
        tool_name: &str,
    ) -> McpTool {
        let source = store
            .ensure_local_source()
            .await
            .expect("ensure local source for remote test tool");
        let identifier = format!("{}/remote/{}/{}", source.id, server_name, tool_name);
        let config_json = serde_json::json!({
            "type": "sse",
            "transport": "sse",
            "server_type": "sse",
            "server_name": server_name,
            "source_entry_name": server_name,
            "url": "https://example.com/sse",
            "sse_url": "https://example.com/sse",
            "remote_tool_name": tool_name,
            "input_schema": {
                "type": "object"
            }
        })
        .to_string();
        store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: source.id.clone(),
                identifier: Some(identifier),
                name: tool_name.to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec!["remote".to_string()],
                description: "remote test tool".to_string(),
                error: None,
                command: None,
                args: None,
                env: None,
                config_json: config_json.clone(),
                config_hash: hash_config(&config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("upsert remote sse test tool")
    }

    #[cfg(not(target_os = "windows"))]
    fn write_mock_stdio_mcp_server_script(test_name: &str) -> PathBuf {
        let mut script_path = std::env::temp_dir();
        script_path.push(format!(
            "deeting-mock-stdio-mcp-{test_name}-{}.py",
            Uuid::new_v4()
        ));
        std::fs::write(
            &script_path,
            r#"import json
import sys

TOOL = {
    "name": "echo",
    "description": "Echo test payload",
    "inputSchema": {
        "type": "object",
        "properties": {
            "message": {"type": "string"}
        }
    }
}

for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    msg = json.loads(line)
    method = msg.get("method")

    if method == "notifications/initialized":
        continue
    if method == "initialize":
        result = {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mock-stdio-mcp", "version": "0.1.0"}
        }
    elif method == "tools/list":
        result = {"tools": [TOOL]}
    elif method == "tools/call":
        params = msg.get("params") or {}
        arguments = params.get("arguments") or {}
        result = {
            "content": [{"type": "text", "text": json.dumps(arguments, sort_keys=True)}],
            "structuredContent": {"echo": arguments},
            "isError": False
        }
    else:
        if "id" in msg:
            print(json.dumps({
                "jsonrpc": "2.0",
                "id": msg["id"],
                "error": {"code": -32601, "message": f"unsupported method: {method}"}
            }), flush=True)
        continue

    if "id" in msg:
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
"#,
        )
        .expect("write mock stdio mcp server script");
        script_path
    }

    #[cfg(not(target_os = "windows"))]
    async fn upsert_test_stdio_mcp_tool(
        store: &crate::modules::mcp::store::McpStore,
        server_name: &str,
        tool_name: &str,
        script_path: &Path,
    ) -> McpTool {
        let source = store
            .ensure_local_source()
            .await
            .expect("ensure local source for stdio test tool");
        let identifier = format!("{}/stdio/{}/{}", source.id, server_name, tool_name);
        let config_json = serde_json::json!({
            "type": "stdio",
            "transport": "stdio",
            "server_type": "stdio",
            "server_name": server_name,
            "source_entry_name": server_name,
            "runtime_protocol": "mcp",
            "mcp_tool_name": tool_name,
            "command": "python3",
            "args": [script_path.to_string_lossy().to_string()],
            "input_schema": {
                "type": "object",
                "properties": {
                    "message": {"type": "string"}
                }
            }
        })
        .to_string();
        store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: source.id.clone(),
                identifier: Some(identifier),
                name: tool_name.to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec!["mcp".to_string()],
                description: "stdio mcp test tool".to_string(),
                error: None,
                command: Some("python3".to_string()),
                args: Some(vec![script_path.to_string_lossy().to_string()]),
                env: None,
                config_json: config_json.clone(),
                config_hash: hash_config(&config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("upsert stdio mcp test tool")
    }

    #[derive(Clone)]
    struct MockSystemAssetsServerState {
        payload: serde_json::Value,
    }

    async fn mock_system_assets_handler(
        AxumState(state): AxumState<MockSystemAssetsServerState>,
        uri: axum::http::Uri,
    ) -> Json<serde_json::Value> {
        let path = uri.path();
        let items = state
            .payload
            .get("items")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let filtered_items = if path.ends_with("/assistants") {
            items.into_iter()
                .filter(|item| {
                    item.get("asset_id")
                        .and_then(|value| value.as_str())
                        .map(|value| value.starts_with("assistant:"))
                        .unwrap_or(false)
                })
                .collect::<Vec<_>>()
        } else if path.ends_with("/skills") {
            items.into_iter()
                .filter(|item| {
                    item.get("asset_id")
                        .and_then(|value| value.as_str())
                        .map(|value| value.starts_with("skill:"))
                        .unwrap_or(false)
                })
                .collect::<Vec<_>>()
        } else {
            items
        };
        Json(serde_json::json!({ "items": filtered_items }))
    }

    async fn start_mock_system_assets_server(
        payload: serde_json::Value,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock system assets listener");
        let addr = listener
            .local_addr()
            .expect("read mock system assets listener addr");
        let app = Router::new()
            .route("/api/v1/system-assets/assistants", get(mock_system_assets_handler))
            .route("/api/v1/system-assets/skills", get(mock_system_assets_handler))
            .with_state(MockSystemAssetsServerState { payload });
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        (format!("http://{}", addr), server)
    }

    #[derive(Clone, Debug, Deserialize)]
    struct SearchSdkBenchmarkCase {
        query: String,
        embedding: Vec<f32>,
        expected_name: String,
        expected_group: String,
        expected_intent: String,
        expected_domain: Option<String>,
        forbidden_groups: Vec<String>,
    }

    #[derive(Debug)]
    struct SearchSdkBenchmarkCaseResult {
        query: String,
        expected_name: String,
        expected_group: String,
        top1_name: Option<String>,
        found_rank: Option<usize>,
        found_in_top3: bool,
        group_match: bool,
        actual_intent: Option<String>,
        actual_domain: Option<String>,
        false_positive: bool,
    }

    #[derive(Debug)]
    struct SearchSdkBenchmarkSummary {
        total_cases: usize,
        top1_hits: usize,
        top3_hits: usize,
        group_hits: usize,
        intent_hits: usize,
        domain_hits: usize,
        domain_case_count: usize,
        false_positive_cases: usize,
        case_results: Vec<SearchSdkBenchmarkCaseResult>,
    }

    impl SearchSdkBenchmarkSummary {
        fn top1_accuracy(&self) -> f64 {
            ratio(self.top1_hits, self.total_cases)
        }

        fn top3_coverage(&self) -> f64 {
            ratio(self.top3_hits, self.total_cases)
        }

        fn group_accuracy(&self) -> f64 {
            ratio(self.group_hits, self.total_cases)
        }

        fn intent_accuracy(&self) -> f64 {
            ratio(self.intent_hits, self.total_cases)
        }

        fn domain_accuracy(&self) -> f64 {
            ratio(self.domain_hits, self.domain_case_count)
        }

        fn false_positive_rate(&self) -> f64 {
            ratio(self.false_positive_cases, self.total_cases)
        }

        fn as_debug_json(&self) -> serde_json::Value {
            serde_json::json!({
                "total_cases": self.total_cases,
                "top1_hits": self.top1_hits,
                "top1_accuracy": self.top1_accuracy(),
                "top3_hits": self.top3_hits,
                "top3_coverage": self.top3_coverage(),
                "group_hits": self.group_hits,
                "group_accuracy": self.group_accuracy(),
                "intent_hits": self.intent_hits,
                "intent_accuracy": self.intent_accuracy(),
                "domain_hits": self.domain_hits,
                "domain_case_count": self.domain_case_count,
                "domain_accuracy": self.domain_accuracy(),
                "false_positive_cases": self.false_positive_cases,
                "false_positive_rate": self.false_positive_rate(),
                "cases": self.case_results.iter().map(|item| serde_json::json!({
                    "query": item.query,
                    "expected_name": item.expected_name,
                    "expected_group": item.expected_group,
                    "top1_name": item.top1_name,
                    "found_rank": item.found_rank,
                    "found_in_top3": item.found_in_top3,
                    "group_match": item.group_match,
                    "actual_intent": item.actual_intent,
                    "actual_domain": item.actual_domain,
                    "false_positive": item.false_positive,
                })).collect::<Vec<_>>()
            })
        }
    }

    fn ratio(numerator: usize, denominator: usize) -> f64 {
        if denominator == 0 {
            0.0
        } else {
            numerator as f64 / denominator as f64
        }
    }

    fn default_search_sdk_benchmark_cases() -> Vec<SearchSdkBenchmarkCase> {
        serde_json::from_str(include_str!("fixtures/search_sdk_benchmark_cases.json"))
            .expect("parse search_sdk benchmark fixtures")
    }

    fn write_search_sdk_benchmark_summary(
        path: &Path,
        summary: &SearchSdkBenchmarkSummary,
    ) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let payload = serde_json::to_vec_pretty(&summary.as_debug_json())
            .expect("serialize benchmark summary");
        std::fs::write(path, payload)
    }

    fn maybe_export_search_sdk_benchmark_summary_from_env(
        summary: &SearchSdkBenchmarkSummary,
    ) -> Option<PathBuf> {
        let output_path = std::env::var("DEETING_SEARCH_SDK_BENCHMARK_SUMMARY_PATH")
            .ok()
            .map(PathBuf::from)?;
        if output_path.as_os_str().is_empty() {
            return None;
        }
        write_search_sdk_benchmark_summary(&output_path, summary)
            .expect("write benchmark summary artifact");
        Some(output_path)
    }

    async fn seed_search_sdk_benchmark_catalog(
        store: &crate::modules::mcp::store::McpStore,
        memory_state: &crate::modules::memory::MemoryState,
    ) {
        store
            .upsert_local_skill_install_state(
                "skill.web-tools",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.web-tools\"}",
                "/tmp/skill.web-tools",
                None,
            )
            .await
            .expect("enable local web skill");
        store
            .upsert_local_skill_install_state(
                "skill.stocks",
                Some("1.0.0"),
                false,
                Some("python"),
                "{\"id\":\"skill.stocks\"}",
                "/tmp/skill.stocks",
                None,
            )
            .await
            .expect("insert disabled local stock skill");

        memory_state
            .store
            .upsert_asset(
                "tool.search_web".to_string(),
                "search_web".to_string(),
                "抓取网页内容并提取标题".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.web-tools".to_string()),
                vec![1.0, 0.0, 0.0, 0.0, 0.0],
                Some(serde_json::json!({
                    "read_only": true,
                    "permission_scope": ["network_read"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Page URL", "example": "https://example.com"},
                            "timeout": {"type": "integer", "default": 30}
                        },
                        "required": ["url"]
                    }
                })),
            )
            .await
            .expect("insert web tool asset");
        memory_state
            .store
            .upsert_asset(
                "skill.weather".to_string(),
                "Weather Skill".to_string(),
                "查询天气预报与降雨提醒".to_string(),
                "skill".to_string(),
                "cloud_mirror".to_string(),
                None,
                vec![0.0, 1.0, 0.0, 0.0, 0.0],
                Some(serde_json::json!({"id": "skill.weather"})),
            )
            .await
            .expect("insert weather cloud skill asset");
        memory_state
            .store
            .upsert_asset(
                "tool.stock_quotes".to_string(),
                "stock_quotes".to_string(),
                "查询股票实时行情".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.stocks".to_string()),
                vec![0.0, 0.0, 1.0, 0.0, 0.0],
                None,
            )
            .await
            .expect("insert disabled stock tool asset");
    }

    fn result_group_contains_name(result: &serde_json::Value, group: &str, name: &str) -> bool {
        result
            .get(group)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .any(|item| item["name"] == serde_json::json!(name))
            })
            .unwrap_or(false)
    }

    async fn run_search_sdk_benchmark_suite(
        test_name: &str,
        cases: &[SearchSdkBenchmarkCase],
    ) -> SearchSdkBenchmarkSummary {
        let vectors = cases
            .iter()
            .map(|case| (case.query.to_lowercase(), case.embedding.clone()))
            .collect::<HashMap<_, _>>();
        let (base_url, server_handle) = start_mock_embedding_server(vectors).await;
        let provider_state = create_test_provider_state(test_name, &base_url).await;
        let memory_state = create_test_memory_state(test_name, 5).await;
        let store = create_test_store(test_name).await;
        seed_search_sdk_benchmark_catalog(&store, &memory_state).await;

        let mut top1_hits = 0_usize;
        let mut top3_hits = 0_usize;
        let mut group_hits = 0_usize;
        let mut intent_hits = 0_usize;
        let mut domain_hits = 0_usize;
        let mut domain_case_count = 0_usize;
        let mut false_positive_cases = 0_usize;
        let mut case_results = Vec::with_capacity(cases.len());

        for case in cases {
            let result = build_local_sdk_search_result_with_runtime(
                &store,
                &provider_state.embedding,
                memory_state.service.as_ref(),
                &case.query,
                8,
            )
            .await;
            let group_items = result
                .get(&case.expected_group)
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            let found_rank = group_items
                .iter()
                .position(|item| item["name"] == serde_json::json!(case.expected_name))
                .map(|index| index + 1);
            let top1_name = group_items
                .first()
                .and_then(|item| item.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            let found_in_top3 = found_rank.map(|rank| rank <= 3).unwrap_or(false);
            let group_match = found_rank.is_some();
            let actual_intent = result
                .get("normalized_query")
                .and_then(|value| value.get("intent"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            let actual_domain = result
                .get("normalized_query")
                .and_then(|value| value.get("domain"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            let false_positive = case
                .forbidden_groups
                .iter()
                .any(|group| result_group_contains_name(&result, group, &case.expected_name));

            if top1_name.as_deref() == Some(case.expected_name.as_str()) {
                top1_hits += 1;
            }
            if found_in_top3 {
                top3_hits += 1;
            }
            if group_match {
                group_hits += 1;
            }
            if actual_intent.as_deref() == Some(case.expected_intent.as_str()) {
                intent_hits += 1;
            }
            if let Some(expected_domain) = case.expected_domain.as_deref() {
                domain_case_count += 1;
                if actual_domain.as_deref() == Some(expected_domain) {
                    domain_hits += 1;
                }
            }
            if false_positive {
                false_positive_cases += 1;
            }

            case_results.push(SearchSdkBenchmarkCaseResult {
                query: case.query.clone(),
                expected_name: case.expected_name.clone(),
                expected_group: case.expected_group.clone(),
                top1_name,
                found_rank,
                found_in_top3,
                group_match,
                actual_intent,
                actual_domain,
                false_positive,
            });
        }

        server_handle.abort();

        SearchSdkBenchmarkSummary {
            total_cases: cases.len(),
            top1_hits,
            top3_hits,
            group_hits,
            intent_hits,
            domain_hits,
            domain_case_count,
            false_positive_cases,
            case_results,
        }
    }

    #[test]
    fn extract_chat_tool_calls_works() {
        let payload = serde_json::json!({
            "content": "hello",
            "tool_calls": [
                {
                    "id": "call_1",
                    "name": "execute_code_plan",
                    "arguments": {"code": "print(1)"}
                }
            ]
        });

        let calls = extract_chat_tool_calls(&payload);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "execute_code_plan");
        assert_eq!(
            calls[0].arguments.get("code").and_then(|v| v.as_str()),
            Some("print(1)")
        );
    }

    #[test]
    fn build_auto_code_mode_tool_feedback_contains_round() {
        let feedback = build_auto_code_mode_tool_feedback(
            2,
            &[serde_json::json!({"id":"call_1","status":"success"})],
            &["ok".to_string()],
        );
        assert!(feedback.contains("round 2"));
        assert!(feedback.contains("\"tool_calls\""));
        assert!(feedback.contains("\"results\""));
    }

    #[test]
    fn build_local_code_mode_entry_tools_exposes_core_function_schemas() {
        let payload = build_local_code_mode_entry_tools();
        let tools = payload
            .get("tools")
            .and_then(|value| value.as_array())
            .expect("wrapped tools array");

        let names = tools
            .iter()
            .filter_map(|tool| tool.get("function"))
            .filter_map(|function| function.get("name"))
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"search_sdk"));
        assert!(names.contains(&"consult_expert_network"));
        assert!(names.contains(&"attach_capability"));
        assert!(names.contains(&"detach_capability"));
        assert!(names.contains(&"execute_code_plan"));
        assert!(names.contains(&"sys_submit_onboarding_request"));
    }

    #[tokio::test]
    async fn search_sdk_smoke_surfaces_installed_skill_bundle_as_recipe() {
        let query = "帮我抓取网页并提取标题";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            query.to_lowercase(),
            vec![1.0, 0.0, 0.0],
        )]))
        .await;
        let provider_state = create_test_provider_state("sdk-smoke-tool", &base_url).await;
        let memory_state = create_test_memory_state("sdk-smoke-tool", 3).await;
        let store = create_test_store("sdk-smoke-tool").await;

        store
            .upsert_local_skill_install_state(
                "skill.web-tools",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.web-tools\"}",
                "/tmp/skill.web-tools",
                None,
            )
            .await
            .expect("enable local skill");
        memory_state
            .store
            .upsert_asset(
                "tool.search_web".to_string(),
                "search_web".to_string(),
                "抓取网页内容并提取标题".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.web-tools".to_string()),
                vec![1.0, 0.0, 0.0],
                Some(serde_json::json!({
                    "read_only": true,
                    "permission_scope": ["network_read"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Page URL", "example": "https://example.com"},
                            "timeout": {"type": "integer", "default": 30}
                        },
                        "required": ["url"]
                    }
                })),
            )
            .await
            .expect("insert tool asset");

        let result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            8,
        )
        .await;

        let recipes = result["recipes"].as_array().expect("recipes array");
        let matched = recipes
            .iter()
            .find(|item| item["name"] == serde_json::json!("search_web"))
            .expect("matched skill recipe");
        assert_eq!(
            result["format_version"],
            serde_json::json!("sdk_control_plane.v1")
        );
        assert_eq!(matched["source"], serde_json::json!("local_mcp"));
        assert_eq!(matched["semantic_kind"], serde_json::json!("recipe"));
        assert_eq!(matched["status"]["callable"], serde_json::json!(false));
        assert_eq!(matched["pkg_name"], serde_json::json!("skill.web-tools"));
        assert_eq!(
            matched["status"]["recommended_action"],
            serde_json::json!("read_skill_docs")
        );
        assert_eq!(
            result["normalized_query"]["intent"],
            serde_json::json!("web_fetch")
        );
        assert_eq!(
            result["normalized_query"]["wants_recipes"],
            serde_json::json!(false)
        );
        let normalized_query = result["normalized_query"]
            .as_object()
            .expect("normalized query");
        assert_eq!(normalized_query.len(), 6);
        assert_eq!(
            normalized_query.get("intent"),
            Some(&serde_json::json!("web_fetch"))
        );
        assert_eq!(
            normalized_query.get("domain"),
            Some(&serde_json::json!("web"))
        );
        assert_eq!(
            normalized_query.get("wants_recipes"),
            Some(&serde_json::json!(false))
        );
        assert_eq!(
            normalized_query.get("requires_network"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(matched["description"], serde_json::json!("抓取网页内容并提取标题"));
        assert!(matched.get("required_parameters").is_none());
        assert!(matched.get("python_stub").is_none());

        server_handle.abort();
    }

    #[tokio::test]
    async fn search_sdk_smoke_surfaces_cloud_skill_as_install_hint() {
        let query = "帮我找个天气 skill";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            query.to_lowercase(),
            vec![0.0, 1.0, 0.0],
        )]))
        .await;
        let provider_state = create_test_provider_state("sdk-smoke-skill", &base_url).await;
        let memory_state = create_test_memory_state("sdk-smoke-skill", 3).await;
        let store = create_test_store("sdk-smoke-skill").await;

        memory_state
            .store
            .upsert_asset(
                "skill.weather".to_string(),
                "Weather Skill".to_string(),
                "查询天气预报与降雨提醒".to_string(),
                "skill".to_string(),
                "cloud_mirror".to_string(),
                None,
                vec![0.0, 1.0, 0.0],
                Some(serde_json::json!({"id": "skill.weather"})),
            )
            .await
            .expect("insert cloud skill asset");

        let result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            8,
        )
        .await;

        let recipes = result["recipes"].as_array().expect("recipes array");
        let hint = recipes
            .iter()
            .find(|item| item["name"] == serde_json::json!("Weather Skill"))
            .expect("weather skill hint");
        assert_eq!(hint["status"]["install_required"], serde_json::json!(true));
        assert_eq!(hint["status"]["callable"], serde_json::json!(false));
        assert_eq!(hint["asset_type"], serde_json::json!("skill"));
        assert_eq!(
            hint["status"]["recommended_action"],
            serde_json::json!("install_skill")
        );
        assert_eq!(hint["semantic_kind"], serde_json::json!("recipe"));

        server_handle.abort();
    }

    #[tokio::test]
    async fn search_sdk_smoke_routes_disabled_local_skill_bundle_to_recipes() {
        let query = "帮我查股票行情";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            query.to_lowercase(),
            vec![0.0, 0.0, 1.0],
        )]))
        .await;
        let provider_state = create_test_provider_state("sdk-smoke-disabled", &base_url).await;
        let memory_state = create_test_memory_state("sdk-smoke-disabled", 3).await;
        let store = create_test_store("sdk-smoke-disabled").await;

        store
            .upsert_local_skill_install_state(
                "skill.stocks",
                Some("1.0.0"),
                false,
                Some("python"),
                "{\"id\":\"skill.stocks\"}",
                "/tmp/skill.stocks",
                None,
            )
            .await
            .expect("insert disabled local skill");
        memory_state
            .store
            .upsert_asset(
                "tool.stock_quotes".to_string(),
                "stock_quotes".to_string(),
                "查询股票实时行情".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.stocks".to_string()),
                vec![0.0, 0.0, 1.0],
                None,
            )
            .await
            .expect("insert disabled tool asset");

        let result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            8,
        )
        .await;

        let recipes = result["recipes"].as_array().expect("recipes array");
        let disabled = recipes
            .iter()
            .find(|item| item["name"] == serde_json::json!("stock_quotes"))
            .expect("disabled stock skill surfaced as recipe");
        assert_eq!(disabled["status"]["callable"], serde_json::json!(false));
        assert_eq!(disabled["status"]["activation_required"], serde_json::json!(true));
        assert_eq!(
            disabled["status"]["recommended_action"],
            serde_json::json!("enable_skill")
        );
        assert_eq!(disabled["semantic_kind"], serde_json::json!("recipe"));

        server_handle.abort();
    }

    #[tokio::test]
    async fn search_sdk_uses_db_tool_status_for_mcp_assets() {
        let query = "帮我执行本地 demo 工具";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            query.to_lowercase(),
            vec![0.5, 0.5, 0.5],
        )]))
        .await;
        let provider_state = create_test_provider_state("sdk-db-status", &base_url).await;
        let memory_state = create_test_memory_state("sdk-db-status", 3).await;
        let store = create_test_store("sdk-db-status").await;

        let tool = upsert_test_tool(&store, "demo_tool", "cat").await;
        store
            .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
            .await
            .expect("set tool stopped");
        memory_state
            .store
            .upsert_asset(
                tool.id.clone(),
                tool.name.clone(),
                tool.description.clone(),
                "tool".to_string(),
                "mcp".to_string(),
                tool.identifier.clone(),
                vec![0.5, 0.5, 0.5],
                None,
            )
            .await
            .expect("insert db-backed tool asset");

        let result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            8,
        )
        .await;

        let capabilities = result["capabilities"]
            .as_array()
            .expect("capabilities array");
        assert!(capabilities
            .iter()
            .filter(|item| item["status"]["callable"] == serde_json::json!(true))
            .all(|item| item["name"] != serde_json::json!("demo_tool")));
        let stopped = capabilities
            .iter()
            .find(|item| item["name"] == serde_json::json!("demo_tool"))
            .expect("stopped tool surfaced as non-callable capability");
        assert_eq!(stopped["status"]["callable"], serde_json::json!(false));
        assert_eq!(stopped["status"]["activation_required"], serde_json::json!(true));
        assert_eq!(
            stopped["status"]["recommended_action"],
            serde_json::json!("start_tool")
        );
        assert_eq!(
            stopped["status"]["reason"],
            serde_json::json!("tool_installed_but_stopped")
        );

        server_handle.abort();
    }

    #[tokio::test]
    async fn desktop_tool_view_marks_healthy_tool_as_desired_runtime_ready_and_indexed() {
        let store = create_test_store("desktop-tool-view-healthy").await;
        let tool = upsert_test_tool(&store, "healthy_demo", "cat").await;
        let indexed_tool_ids = HashSet::from([tool.id.clone()]);

        let view = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_view(
            tool,
            Some(&indexed_tool_ids),
        );

        assert!(view.desired_enabled);
        assert!(view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "ready_in_local_runtime");
        assert_eq!(
            view.availability_class,
            crate::modules::mcp::commands::runtime::ToolAvailabilityClass::CallableDirect
        );
        assert_eq!(view.recommended_action, "execute");
        assert_eq!(
            view.index_status,
            crate::modules::mcp::commands::runtime::DesktopMcpToolIndexStatus::Indexed
        );
        assert_eq!(view.index_status_reason, "indexed_in_local_memory");
    }

    #[tokio::test]
    async fn desktop_tool_view_marks_stopped_tool_as_not_runtime_ready() {
        let store = create_test_store("desktop-tool-view-stopped").await;
        let tool = upsert_test_tool(&store, "stopped_demo_view", "cat").await;
        store
            .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
            .await
            .expect("set tool stopped");
        let stopped_tool = store
            .get_tool(&tool.id)
            .await
            .expect("load stopped tool")
            .expect("stopped tool exists");

        let view = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_view(
            stopped_tool,
            Some(&HashSet::new()),
        );

        assert!(view.desired_enabled);
        assert!(!view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "tool_installed_but_stopped");
        assert_eq!(
            view.availability_class,
            crate::modules::mcp::commands::runtime::ToolAvailabilityClass::NeedsSetup
        );
        assert_eq!(view.recommended_action, "start_tool");
        assert!(view.activation_required);
        assert_eq!(
            view.index_status,
            crate::modules::mcp::commands::runtime::DesktopMcpToolIndexStatus::Missing
        );
    }

    #[tokio::test]
    async fn desktop_tool_views_do_not_infer_state_from_legacy_skill_identifier() {
        let store = create_test_store("desktop-tool-view-disabled-skill").await;
        store
            .upsert_local_skill_install_state(
                "skill.stocks",
                Some("1.0.0"),
                false,
                Some("python"),
                "{\"id\":\"skill.stocks\"}",
                "/tmp/skill.stocks",
                None,
            )
            .await
            .expect("insert disabled local stock skill");
        let tool = upsert_test_tool_with_identifier(
            &store,
            "stock_quotes_view",
            "cat",
            Some("skill.stocks/stock_quotes".to_string()),
        )
        .await;

        let views = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_views(
            &store,
            Some(&HashSet::from([tool.id.clone()])),
        )
        .await
        .expect("build tool views");
        let view = views
            .into_iter()
            .find(|item| item.tool.id == tool.id)
            .expect("find legacy skill tool view");

        assert!(view.desired_enabled);
        assert!(view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "ready_in_local_runtime");
        assert_eq!(
            view.availability_class,
            crate::modules::mcp::commands::runtime::ToolAvailabilityClass::CallableDirect
        );
        assert_eq!(view.recommended_action, "execute");
        assert!(!view.activation_required);
        assert_eq!(
            view.index_status,
            crate::modules::mcp::commands::runtime::DesktopMcpToolIndexStatus::Indexed
        );
    }

    #[tokio::test]
    async fn desktop_tool_views_surface_legacy_skill_backed_rows_without_special_hiding() {
        let store = create_test_store("desktop-tool-view-hide-skill-tools").await;

        let visible_tool = upsert_test_tool(&store, "plain_local_tool", "cat").await;

        let skill_source = store
            .insert_source(NewSource {
                name: "skill:skill.stocks".to_string(),
                source_type: McpSourceType::Skill,
                path_or_url: "/tmp/skills/stocks".to_string(),
                trust_level: McpTrustLevel::Community,
                status: McpSourceStatus::Active,
                last_synced_at: None,
                is_read_only: false,
            })
            .await
            .expect("insert skill source");
        let skill_config_json = serde_json::json!({
            "command": "python3",
            "args": ["main.py"],
            "description": "Stock quotes",
        })
        .to_string();
        let hidden_skill_tool = store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: skill_source.id.clone(),
                identifier: Some("skill.stocks/stock_quotes".to_string()),
                name: "stock_quotes".to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec!["finance".to_string()],
                description: "Stock quotes".to_string(),
                error: None,
                command: Some("python3".to_string()),
                args: Some(vec!["main.py".to_string()]),
                env: None,
                config_json: skill_config_json.clone(),
                config_hash: hash_config(&skill_config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("upsert skill-backed tool");

        let views = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_views(
            &store,
            Some(&HashSet::from([
                visible_tool.id.clone(),
                hidden_skill_tool.id.clone(),
            ])),
        )
        .await
        .expect("build tool views");

        assert!(views.iter().any(|item| item.tool.id == visible_tool.id));
        assert!(views.iter().any(|item| item.tool.id == hidden_skill_tool.id));
    }

    #[tokio::test]
    async fn desktop_tool_view_marks_remote_sse_tool_as_callable_without_command() {
        let store = create_test_store("desktop-tool-view-remote-sse").await;
        let tool = upsert_test_remote_sse_tool(&store, "tavily-mcp", "search_web").await;

        let view = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_view(
            tool.clone(),
            Some(&HashSet::from([tool.id.clone()])),
        );

        assert!(view.desired_enabled);
        assert!(view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "ready_via_remote_mcp");
        assert_eq!(
            view.availability_class,
            crate::modules::mcp::commands::runtime::ToolAvailabilityClass::CallableDirect
        );
        assert_eq!(view.recommended_action, "execute");
        assert_eq!(tool.remote_tool_name().as_deref(), Some("search_web"));
        assert_eq!(tool.remote_server_name().as_deref(), Some("tavily-mcp"));
        assert_eq!(
            tool.remote_sse_url().as_deref(),
            Some("https://example.com/sse")
        );
    }

    #[tokio::test]
    async fn desktop_tool_view_marks_remote_sse_tool_as_requiring_start_when_stopped() {
        let store = create_test_store("desktop-tool-view-remote-sse-stopped").await;
        let tool = upsert_test_remote_sse_tool(&store, "tavily-mcp", "search_web").await;
        store
            .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
            .await
            .expect("set remote tool stopped");
        let stopped_tool = store
            .get_tool(&tool.id)
            .await
            .expect("load stopped remote tool")
            .expect("stopped remote tool exists");

        let view = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_view(
            stopped_tool,
            Some(&HashSet::new()),
        );

        assert!(!view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "remote_server_sync_required");
        assert_eq!(view.recommended_action, "start_tool");
        assert!(view.activation_required);
    }

    #[tokio::test]
    async fn remote_transport_helpers_update_sse_tool_status_without_process_runtime() {
        let store = create_test_store("remote-sse-lifecycle-inner").await;
        let tool = upsert_test_remote_sse_tool(&store, "tavily-mcp", "search_web").await;
        store
            .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
            .await
            .expect("seed stopped remote tool");

        let started = start_remote_transport_tool(&store, &tool)
            .await
            .expect("start remote sse tool");
        assert_eq!(started["status"], serde_json::json!("REMOTE_READY"));
        assert_eq!(started["transport"], serde_json::json!("sse"));
        let healthy_tool = store
            .get_tool(&tool.id)
            .await
            .expect("reload healthy remote tool")
            .expect("healthy remote tool exists");
        assert_eq!(healthy_tool.status, McpToolStatus::Healthy);

        stop_remote_transport_tool(&store, &healthy_tool)
            .await
            .expect("stop remote sse tool");
        let stopped_tool = store
            .get_tool(&tool.id)
            .await
            .expect("reload stopped remote tool")
            .expect("stopped remote tool exists");
        assert_eq!(stopped_tool.status, McpToolStatus::Stopped);
    }

    #[tokio::test]
    async fn remote_transport_logs_explain_that_sse_has_no_local_process_stream() {
        let store = create_test_store("remote-sse-logs-inner").await;
        let tool = upsert_test_remote_sse_tool(&store, "tavily-mcp", "search_web").await;

        let logs = build_remote_transport_log_entries(&tool)
            .into_iter()
            .map(|entry| serde_json::json!(entry))
            .collect::<Vec<_>>();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["stream"], serde_json::json!("event"));
        assert!(logs[0]["message"]
            .as_str()
            .expect("log message")
            .contains("does not expose a local process log stream"));
    }

    #[test]
    fn tool_without_transport_or_command_stays_review_only() {
        let tool = McpTool {
            id: Uuid::new_v4().to_string(),
            identifier: None,
            name: "orphan_tool".to_string(),
            source_type: McpSourceType::Local,
            source_id: None,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: vec![],
            description: "unknown transport tool".to_string(),
            error: None,
            command: None,
            args: None,
            env: None,
            config_json: "{}".to_string(),
            pending_config_json: None,
            config_hash: "hash".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        };

        let view = crate::modules::mcp::commands::runtime::build_desktop_mcp_tool_view(
            tool,
            Some(&HashSet::new()),
        );

        assert!(!view.runtime_ready);
        assert_eq!(view.runtime_status_reason, "tool_transport_unresolved");
        assert_eq!(view.recommended_action, "review");
        assert_eq!(
            view.availability_class,
            crate::modules::mcp::commands::runtime::ToolAvailabilityClass::Unavailable
        );
    }

    #[test]
    fn mcp_tool_config_payload_recognizes_sse_transport_from_url() {
        let payload: McpToolConfigPayload = serde_json::from_value(serde_json::json!({
            "type": "sse",
            "url": "https://example.com/sse"
        }))
        .expect("deserialize remote config payload");

        assert_eq!(payload.transport_kind(), McpTransportKind::Sse);
        assert_eq!(payload.remote_sse_url(), Some("https://example.com/sse"));
    }

    #[tokio::test]
    async fn enable_local_skills_by_ids_reenables_disabled_skill_rows() {
        let store = create_test_store("enable-local-skill-row").await;
        store
            .upsert_local_skill_install_state(
                "skill.stocks",
                Some("1.0.0"),
                false,
                Some("python"),
                "{\"id\":\"skill.stocks\"}",
                "/tmp/skill.stocks",
                None,
            )
            .await
            .expect("insert disabled local stock skill");

        let updated = store
            .enable_local_skills_by_ids(&["skill.stocks".to_string()])
            .await
            .expect("enable local skill");

        assert_eq!(updated, 1);
        let enabled_skill_ids = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled local skill ids");
        assert!(enabled_skill_ids.contains("skill.stocks"));
    }

    #[tokio::test]
    async fn search_sdk_regression_matrix_preserves_result_groups_and_intents() {
        let web_query = "帮我抓取网页并提取标题";
        let weather_skill_query = "帮我找个天气 skill";
        let stock_query = "帮我查股票行情";
        let realtime_weather_query = "天津今日天气";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([
            (web_query.to_lowercase(), vec![1.0, 0.0, 0.0, 0.0]),
            (weather_skill_query.to_lowercase(), vec![0.0, 1.0, 0.0, 0.0]),
            (stock_query.to_lowercase(), vec![0.0, 0.0, 1.0, 0.0]),
            (
                realtime_weather_query.to_lowercase(),
                vec![0.0, 1.0, 0.0, 0.0],
            ),
        ]))
        .await;
        let provider_state = create_test_provider_state("sdk-regression-matrix", &base_url).await;
        let memory_state = create_test_memory_state("sdk-regression-matrix", 4).await;
        let store = create_test_store("sdk-regression-matrix").await;

        store
            .upsert_local_skill_install_state(
                "skill.web-tools",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.web-tools\"}",
                "/tmp/skill.web-tools",
                None,
            )
            .await
            .expect("enable local web skill");
        store
            .upsert_local_skill_install_state(
                "skill.stocks",
                Some("1.0.0"),
                false,
                Some("python"),
                "{\"id\":\"skill.stocks\"}",
                "/tmp/skill.stocks",
                None,
            )
            .await
            .expect("insert disabled local stock skill");
        memory_state
            .store
            .upsert_asset(
                "tool.search_web".to_string(),
                "search_web".to_string(),
                "抓取网页内容并提取标题".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.web-tools".to_string()),
                vec![1.0, 0.0, 0.0, 0.0],
                None,
            )
            .await
            .expect("insert web tool asset");
        memory_state
            .store
            .upsert_asset(
                "skill.weather".to_string(),
                "Weather Skill".to_string(),
                "查询天气预报与降雨提醒".to_string(),
                "skill".to_string(),
                "cloud_mirror".to_string(),
                None,
                vec![0.0, 1.0, 0.0, 0.0],
                Some(serde_json::json!({"id": "skill.weather"})),
            )
            .await
            .expect("insert weather cloud skill asset");
        memory_state
            .store
            .upsert_asset(
                "tool.stock_quotes".to_string(),
                "stock_quotes".to_string(),
                "查询股票实时行情".to_string(),
                "tool".to_string(),
                "mcp".to_string(),
                Some("skill.stocks".to_string()),
                vec![0.0, 0.0, 1.0, 0.0],
                None,
            )
            .await
            .expect("insert disabled stock tool asset");

        let web_result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            web_query,
            8,
        )
        .await;
        assert_eq!(
            web_result["normalized_query"]["intent"],
            serde_json::json!("web_fetch")
        );
        assert!(web_result["recipes"]
            .as_array()
            .expect("web recipe array")
            .iter()
            .any(|item| item["name"] == serde_json::json!("search_web")));

        let weather_skill_result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            weather_skill_query,
            8,
        )
        .await;
        assert_eq!(
            weather_skill_result["normalized_query"]["intent"],
            serde_json::json!("install_or_enable")
        );
        assert!(weather_skill_result["recipes"]
            .as_array()
            .expect("weather recipe array")
            .iter()
            .any(|item| {
                item["name"] == serde_json::json!("Weather Skill")
                    && item["status"]["recommended_action"] == serde_json::json!("install_skill")
            }));

        let stock_result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            stock_query,
            8,
        )
        .await;
        assert_eq!(
            stock_result["normalized_query"]["domain"],
            serde_json::json!("finance")
        );
        assert!(stock_result["recipes"]
            .as_array()
            .expect("stock recipe array")
            .iter()
            .any(|item| {
                item["name"] == serde_json::json!("stock_quotes")
                    && item["status"]["recommended_action"] == serde_json::json!("enable_skill")
            }));

        let realtime_weather_result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            realtime_weather_query,
            8,
        )
        .await;
        assert_eq!(
            realtime_weather_result["normalized_query"]["domain"],
            serde_json::json!("weather")
        );
        assert_eq!(
            realtime_weather_result["normalized_query"]["intent"],
            serde_json::json!("realtime_lookup")
        );
        assert!(realtime_weather_result["recipes"]
            .as_array()
            .expect("realtime weather recipe array")
            .iter()
            .any(|item| item["name"] == serde_json::json!("Weather Skill")));

        server_handle.abort();
    }

    #[tokio::test]
    async fn search_sdk_benchmark_replay_suite_meets_quality_thresholds() {
        let cases = default_search_sdk_benchmark_cases();
        let summary = run_search_sdk_benchmark_suite("sdk-benchmark-suite", &cases).await;
        let _ = maybe_export_search_sdk_benchmark_summary_from_env(&summary);
        let debug_payload = serde_json::to_string_pretty(&summary.as_debug_json())
            .expect("serialize benchmark summary");

        assert_eq!(summary.total_cases, cases.len(), "{debug_payload}");
        assert!(summary.top1_accuracy() >= 0.20, "{debug_payload}");
        assert_eq!(summary.top3_hits, summary.total_cases, "{debug_payload}");
        assert_eq!(summary.group_hits, summary.total_cases, "{debug_payload}");
        assert_eq!(summary.intent_hits, summary.total_cases, "{debug_payload}");
        assert_eq!(
            summary.domain_hits, summary.domain_case_count,
            "{debug_payload}"
        );
        assert_eq!(summary.false_positive_cases, 0, "{debug_payload}");
    }

    #[test]
    fn search_sdk_benchmark_fixture_file_parses() {
        let cases = default_search_sdk_benchmark_cases();
        assert!(!cases.is_empty());
        assert_eq!(cases[0].expected_name, "search_web");
    }

    #[test]
    fn write_search_sdk_benchmark_summary_emits_machine_readable_json() {
        let summary = SearchSdkBenchmarkSummary {
            total_cases: 2,
            top1_hits: 1,
            top3_hits: 2,
            group_hits: 2,
            intent_hits: 2,
            domain_hits: 1,
            domain_case_count: 1,
            false_positive_cases: 0,
            case_results: vec![SearchSdkBenchmarkCaseResult {
                query: "demo query".to_string(),
                expected_name: "search_web".to_string(),
                expected_group: "capabilities".to_string(),
                top1_name: Some("search_web".to_string()),
                found_rank: Some(1),
                found_in_top3: true,
                group_match: true,
                actual_intent: Some("web_fetch".to_string()),
                actual_domain: Some("web".to_string()),
                false_positive: false,
            }],
        };
        let mut path = std::env::temp_dir();
        path.push(format!(
            "deeting-search-sdk-benchmark-summary-{}.json",
            Uuid::new_v4()
        ));

        write_search_sdk_benchmark_summary(&path, &summary).expect("write summary file");

        let written = std::fs::read_to_string(&path).expect("read summary file");
        let parsed: serde_json::Value = serde_json::from_str(&written).expect("parse summary json");
        assert_eq!(parsed["top1_accuracy"], serde_json::json!(0.5));
        assert_eq!(parsed["top3_coverage"], serde_json::json!(1.0));
        assert_eq!(
            parsed["cases"][0]["expected_name"],
            serde_json::json!("search_web")
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn search_sdk_surfaces_core_onboarding_and_execution_tools() {
        let query = "帮我安装一个本地 skill 并执行代码计划";
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            query.to_lowercase(),
            vec![0.0, 0.0, 0.0],
        )]))
        .await;
        let provider_state = create_test_provider_state("sdk-core-tools", &base_url).await;
        let memory_state = create_test_memory_state("sdk-core-tools", 3).await;
        let store = create_test_store("sdk-core-tools").await;

        let result = build_local_sdk_search_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            8,
        )
        .await;

        let callable = result["capabilities"].as_array().expect("capabilities array");
        let onboarding = callable
            .iter()
            .find(|item| item["name"] == serde_json::json!("sys_submit_onboarding_request"))
            .expect("onboarding core tool");
        let execute = result["orchestration_primitives"]
            .as_array()
            .expect("orchestration primitives array")
            .iter()
            .find(|item| item["name"] == serde_json::json!("execute_code_plan"))
            .expect("execute core tool");
        assert_eq!(onboarding["risk_level"], serde_json::json!("HIGH"));
        assert_eq!(onboarding["mutating"], serde_json::json!(true));
        assert_eq!(execute["risk_level"], serde_json::json!("HIGH"));
        assert!(execute["permission_scope"]
            .as_array()
            .expect("execute permission scope")
            .iter()
            .any(|item| item == "sandbox_execution"));

        server_handle.abort();
    }

    #[tokio::test]
    async fn consult_expert_network_skips_embedding_when_no_local_assistants_are_enabled() {
        let query = "天气查询";
        let (base_url, server_handle) = start_failing_embedding_server().await;
        let provider_state = create_test_provider_state("consult-empty", &base_url).await;
        let memory_state = create_test_memory_state("consult-empty", 3).await;
        let store = create_test_store("consult-empty").await;

        let result = build_local_consult_expert_network_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            3,
            None,
        )
        .await;

        assert_eq!(result["action"], serde_json::json!("consulted"));
        assert_eq!(result["search_mode"], serde_json::json!("catalog_empty"));
        assert_eq!(result["candidates"], serde_json::json!([]));
        assert_eq!(result["recommended_capability_id"], serde_json::Value::Null);

        server_handle.abort();
    }

    #[tokio::test]
    async fn consult_expert_network_falls_back_to_lexical_catalog_when_embedding_is_unavailable() {
        let query = "天气查询";
        let (base_url, server_handle) = start_failing_embedding_server().await;
        let provider_state = create_test_provider_state("consult-lexical", &base_url).await;
        let memory_state = create_test_memory_state("consult-lexical", 3).await;
        let store = create_test_store("consult-lexical").await;

        seed_cloud_assistant_for_consult(
            &store,
            "assistant.weather",
            "Weather Expert",
            "查询天气预报与天气趋势",
        )
        .await;

        let result = build_local_consult_expert_network_result_with_runtime(
            &store,
            &provider_state.embedding,
            memory_state.service.as_ref(),
            query,
            3,
            None,
        )
        .await;

        let candidates = result["candidates"].as_array().expect("candidates array");
        assert_eq!(result["action"], serde_json::json!("consulted"));
        assert_eq!(result["search_mode"], serde_json::json!("lexical"));
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0]["capability_id"],
            serde_json::json!("assistant.weather")
        );
        assert_eq!(candidates[0]["name"], serde_json::json!("Weather Expert"));
        assert_eq!(
            result["recommended_capability_id"],
            serde_json::json!("assistant.weather")
        );

        server_handle.abort();
    }

    #[test]
    fn normalize_skill_dir_name_replaces_unsafe_chars() {
        assert_eq!(normalize_skill_dir_name("demo.skill"), "demo.skill");
        assert_eq!(
            normalize_skill_dir_name("demo/skill:alpha"),
            "demo_skill_alpha"
        );
        assert_eq!(normalize_skill_dir_name("   "), "skill");
    }

    #[test]
    fn derive_skill_name_from_repo_url_uses_repo_basename() {
        assert_eq!(
            derive_skill_name_from_repo_url("https://github.com/org/weather-tool.git"),
            "weather-tool"
        );
        assert_eq!(
            derive_skill_name_from_repo_url("git@github.com:org/weather_tool"),
            "weather_tool"
        );
    }

    #[test]
    fn deeting_manifest_deserialization_applies_runtime_and_timeout_defaults() {
        let manifest: skill_registry_impl::DeetingManifest = serde_json::from_str(
            r#"{
                "id": "skill.demo",
                "name": "Demo Skill"
            }"#,
        )
        .expect("deserialize deeting manifest");

        assert_eq!(manifest.id, "skill.demo");
        assert_eq!(manifest.name, "Demo Skill");
        assert_eq!(
            manifest.runtime,
            vec!["cloud".to_string(), "local".to_string()]
        );
        assert_eq!(manifest.execution.timeout_seconds, 60);
        assert!(manifest.permissions.is_empty());
        assert!(manifest.allowed_roles.is_empty());
        assert!(!manifest.restricted);
    }

    #[test]
    fn parse_skill_onboarding_payload_supports_fallback_skill_name() {
        let payload = serde_json::json!({
            "repo_url": "https://github.com/org/stock-tracker.git"
        });
        let parsed = parse_skill_onboarding_payload(&payload).expect("parse onboarding payload");
        assert_eq!(parsed.0, "https://github.com/org/stock-tracker.git");
        assert_eq!(parsed.1, "stock-tracker");
    }

    #[test]
    fn build_local_tool_trace_blocks_contains_tool_call_and_result() {
        let meta = vec![serde_json::json!({
            "id": "call_1",
            "name": "install_skill_from_git",
            "status": "success",
            "result": {
                "action": "skill_installed"
            }
        })];

        let blocks = build_local_tool_trace_blocks(&meta);
        assert!(!blocks.is_empty());
        assert_eq!(
            blocks[0].get("type").and_then(|v| v.as_str()),
            Some("execution_section")
        );
        assert!(blocks.iter().any(|block| {
            block.get("type").and_then(|v| v.as_str()) == Some("tool_call")
                && block.get("toolName").and_then(|v| v.as_str()) == Some("install_skill_from_git")
        }));
        assert!(blocks.iter().any(|block| {
            block.get("type").and_then(|v| v.as_str()) == Some("tool_result")
                && block.get("status").and_then(|v| v.as_str()) == Some("success")
        }));
    }

    #[test]
    fn build_local_tool_trace_blocks_emits_ui_blocks_from_render_blocks() {
        let meta = vec![serde_json::json!({
            "id": "call_exec_1",
            "name": "execute_code_plan",
            "status": "success",
            "result": {
                "render_blocks": [
                    {
                        "view_type": "table.simple",
                        "payload": { "rows": [{"name": "Alice"}] },
                        "title": "Execution Table",
                        "metadata": { "source": "runtime" }
                    }
                ]
            }
        })];

        let blocks = build_local_tool_trace_blocks(&meta);
        let ui_block = blocks
            .iter()
            .find(|block| block.get("type").and_then(|v| v.as_str()) == Some("ui"))
            .expect("ui block should be emitted from render_blocks");

        assert_eq!(
            ui_block.get("viewType").and_then(|v| v.as_str()),
            Some("table.simple")
        );
        assert_eq!(
            ui_block
                .get("payload")
                .and_then(|v| v.get("rows"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.len()),
            Some(1)
        );
    }

    #[test]
    fn build_local_tool_trace_blocks_emits_capability_transition_block() {
        let meta = vec![serde_json::json!({
            "id": "call_activate",
            "name": "attach_capability",
            "status": "success",
            "result": {
                "capability_transition": {
                    "action": "activated",
                    "capability_id": "capability-1",
                    "capability_name": "Expert",
                    "reason": "best match"
                }
            }
        })];

        let blocks = build_local_tool_trace_blocks(&meta);
        assert!(blocks.iter().any(|block| {
            block.get("type").and_then(|v| v.as_str()) == Some("capability_transition")
                && block.get("capabilityName").and_then(|v| v.as_str()) == Some("Expert")
        }));
    }

    #[test]
    fn unknown_tool_call_builds_structured_install_gate_error_meta() {
        let call = LocalChatToolCall {
            id: Some("call_unknown".to_string()),
            name: "do_magic".to_string(),
            arguments: serde_json::json!({}),
        };
        let error = "tool 'do_magic' is not installed or enabled in local desktop runtime";
        let meta =
            build_local_tool_call_install_gate_error_meta(call.id.as_deref(), "do_magic", error);

        assert_eq!(meta.get("status").and_then(|v| v.as_str()), Some("error"));
        assert_eq!(
            meta.get("error_code").and_then(|v| v.as_str()),
            Some(LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE)
        );
        assert!(meta
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .contains("not installed"));
    }

    #[test]
    fn normalize_chat_completion_response_supports_openai_shape() {
        let raw = serde_json::json!({
            "id": "chatcmpl_xxx",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "hello",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "search_sdk",
                                    "arguments": "{\"query\":\"sdk\"}"
                                }
                            }
                        ]
                    }
                }
            ]
        });
        let normalized = normalize_chat_completion_response(raw);
        assert_eq!(
            normalized.get("content").and_then(|v| v.as_str()),
            Some("hello")
        );
        let calls = normalized
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].get("name").and_then(|v| v.as_str()),
            Some("search_sdk")
        );
        assert_eq!(
            calls[0]
                .get("arguments")
                .and_then(|v| v.get("query"))
                .and_then(|v| v.as_str()),
            Some("sdk")
        );
    }

    #[test]
    fn build_upstream_endpoint_uses_v1_default() {
        let helper = crate::modules::providers::request_runtime::build_upstream_url_with_params;
        assert_eq!(
            helper("https://api.example.com", "", Some("openai"), None, None),
            (
                "https://api.example.com/v1".to_string(),
                serde_json::json!({}),
            )
        );
        assert_eq!(
            helper("https://api.example.com/v1", "", Some("openai"), None, None),
            (
                "https://api.example.com/v1".to_string(),
                serde_json::json!({}),
            )
        );
        assert_eq!(
            helper(
                "https://api.example.com/",
                "/custom/path",
                Some("openai"),
                None,
                None,
            ),
            (
                "https://api.example.com/v1/custom/path".to_string(),
                serde_json::json!({}),
            )
        );
        assert_eq!(
            helper(
                "https://api.example.com/",
                "/custom/path",
                Some("openai"),
                Some(false),
                None,
            ),
            (
                "https://api.example.com/custom/path".to_string(),
                serde_json::json!({}),
            )
        );
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
                "/v1/chat/completions",
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

    #[tokio::test]
    async fn process_summary_job_persists_summary_and_marks_completed() {
        let store = create_test_store("summary-ok").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("smoke-summary".to_string()),
            })
            .await
            .expect("create conversation");
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "请帮我总结一下这次对话".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user message");
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "已记录你的需求，准备生成摘要".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append assistant message");
        store
            .enqueue_local_conversation_summary_job(&session.session_id, "test")
            .await
            .expect("enqueue summary job");

        process_next_local_conversation_summary_job_with_store(&store)
            .await
            .expect("process summary job");

        let window = store
            .get_local_conversation_window(&session.session_id)
            .await
            .expect("get conversation window");
        let summary_text = window
            .summary
            .as_ref()
            .and_then(|value| value.get("summary_text"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(summary_text.contains("user:"));
        assert!(summary_text.contains("assistant:"));

        let jobs = store
            .list_local_conversation_summary_jobs(LocalConversationSummaryJobQuery {
                skip: None,
                limit: None,
                status: None,
                session_id: Some(session.session_id.clone()),
                error_contains: None,
            })
            .await
            .expect("list summary jobs");
        assert_eq!(jobs.total, 1);
        assert_eq!(jobs.items[0].status, "completed");
    }

    #[tokio::test]
    async fn process_summary_job_requeues_when_conversation_is_empty() {
        let store = create_test_store("summary-empty").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("empty-summary".to_string()),
            })
            .await
            .expect("create conversation");
        store
            .enqueue_local_conversation_summary_job(&session.session_id, "test")
            .await
            .expect("enqueue summary job");

        let err = process_next_local_conversation_summary_job_with_store(&store)
            .await
            .expect_err("empty conversation should fail");
        let error_text = err.to_string();
        assert!(error_text.contains("content is empty") || error_text.contains("has no messages"));

        let jobs = store
            .list_local_conversation_summary_jobs(LocalConversationSummaryJobQuery {
                skip: None,
                limit: None,
                status: Some("pending".to_string()),
                session_id: Some(session.session_id.clone()),
                error_contains: None,
            })
            .await
            .expect("list summary jobs");
        assert_eq!(jobs.total, 1);
        assert_eq!(jobs.items[0].status, "pending");
        let last_error = jobs.items[0].last_error.as_deref().unwrap_or("");
        assert!(last_error.contains("content is empty") || last_error.contains("has no messages"));
    }

    #[tokio::test]
    async fn conversation_model_context_roundtrips_in_runtime_window_meta() {
        let store = create_test_store("conversation-model-context").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: None,
            })
            .await
            .expect("create conversation");

        store
            .update_local_conversation_model_context(
                &session.session_id,
                Some("gpt-4o-mini"),
                Some("11111111-1111-1111-1111-111111111111"),
            )
            .await
            .expect("update conversation model context");

        let window = store
            .load_local_conversation_runtime_window(&session.session_id)
            .await
            .err();
        assert!(window.is_some(), "window should still require messages");

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "你好，帮我整理一个旅行计划".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user message");

        let window = store
            .load_local_conversation_runtime_window(&session.session_id)
            .await
            .expect("load runtime window");
        let meta = window.meta.expect("meta exists");

        assert_eq!(
            meta.get("last_model_id").and_then(|value| value.as_str()),
            Some("gpt-4o-mini")
        );
        assert_eq!(
            meta.get("last_provider_model_id")
                .and_then(|value| value.as_str()),
            Some("11111111-1111-1111-1111-111111111111")
        );
    }

    #[tokio::test]
    async fn finalize_local_compare_winner_replaces_latest_assistant_message() {
        let store = create_test_store("compare-finalize-replace").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("compare-finalize".to_string()),
            })
            .await
            .expect("create conversation");

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "帮我写一个旅行建议".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user");

        let baseline = store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "assistant".to_string(),
                content: "先去上海再去杭州。".to_string(),
                name: None,
                meta_info: Some(serde_json::json!({
                    "model_id": "baseline-model",
                    "provider_model_id": "provider-baseline"
                })),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append baseline assistant");

        let response = store
            .finalize_local_compare_winner(
                crate::modules::mcp::types::LocalConversationCompareFinalizeRequest {
                    session_id: session.session_id.clone(),
                    model_id: "compare-model".to_string(),
                    provider_model_id: Some("provider-compare".to_string()),
                    content: "建议先杭州后上海，节奏更轻松。".to_string(),
                    blocks: Some(vec![serde_json::json!({
                        "type": "text",
                        "content": "建议先杭州后上海，节奏更轻松。"
                    })]),
                },
            )
            .await
            .expect("finalize compare winner");

        assert_eq!(Some(response.replaced_turn_index), baseline.turn_index);
        assert_eq!(
            response.message.content,
            Some(serde_json::json!("建议先杭州后上海，节奏更轻松。"))
        );
        assert_eq!(response.message.role, "assistant");
        let meta = response.message.meta_info.expect("winner meta info");
        assert_eq!(meta["model_id"], serde_json::json!("compare-model"));
        assert_eq!(
            meta["provider_model_id"],
            serde_json::json!("provider-compare")
        );
        assert_eq!(meta["compare_winner"], serde_json::json!(true));

        let history = store
            .get_local_conversation_history(
                &session.session_id,
                LocalConversationHistoryQuery {
                    session_id: Some(session.session_id.clone()),
                    cursor: None,
                    limit: Some(50),
                },
            )
            .await
            .expect("load history");
        let assistant_messages: Vec<_> = history
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .collect();
        assert_eq!(assistant_messages.len(), 1);
        assert_eq!(assistant_messages[0].content, response.message.content);

        let runtime_window = store
            .load_local_conversation_runtime_window(&session.session_id)
            .await
            .expect("load runtime window");
        assert_eq!(runtime_window.messages.len(), 2);
        assert_eq!(
            runtime_window.messages[1].content,
            response.message.content.clone()
        );
        let meta = runtime_window.meta.expect("runtime window meta");
        assert_eq!(meta["last_model_id"], serde_json::json!("compare-model"));
        assert_eq!(
            meta["last_provider_model_id"],
            serde_json::json!("provider-compare")
        );
    }

    #[tokio::test]
    async fn finalize_local_compare_winner_requires_existing_assistant_message() {
        let store = create_test_store("compare-finalize-missing-assistant").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("compare-finalize-missing".to_string()),
            })
            .await
            .expect("create conversation");

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session.session_id.clone(),
                role: "user".to_string(),
                content: "只有问题，没有正式答案".to_string(),
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .expect("append user");

        let error = store
            .finalize_local_compare_winner(
                crate::modules::mcp::types::LocalConversationCompareFinalizeRequest {
                    session_id: session.session_id.clone(),
                    model_id: "compare-model".to_string(),
                    provider_model_id: None,
                    content: "候选答案".to_string(),
                    blocks: None,
                },
            )
            .await
            .expect_err("should require latest assistant");

        assert!(error
            .to_string()
            .contains("latest assistant message not found"));
    }

    #[tokio::test]
    async fn update_local_conversation_title_if_empty_does_not_override_existing_title() {
        let store = create_test_store("conversation-title-if-empty").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: None,
            })
            .await
            .expect("create conversation");

        let first = store
            .update_local_conversation_title_if_empty(&session.session_id, "旅行计划")
            .await
            .expect("set title the first time");
        assert_eq!(first.as_deref(), Some("旅行计划"));

        let second = store
            .update_local_conversation_title_if_empty(&session.session_id, "不会覆盖")
            .await
            .expect("second update should be ignored");
        assert!(second.is_none());

        let session_page = store
            .list_local_conversations(LocalConversationSessionsQuery {
                cursor: None,
                size: Some(10),
                assistant_id: None,
                status: Some(LocalConversationStatus::Active),
            })
            .await
            .expect("list conversations");
        assert_eq!(session_page.items[0].title.as_deref(), Some("旅行计划"));
    }

    #[tokio::test]
    async fn runtime_window_loads_latest_messages_and_latest_summary() {
        let store = create_test_store("runtime-window").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("runtime-window".to_string()),
            })
            .await
            .expect("create conversation");

        for turn in 1..=14 {
            store
                .append_local_conversation_message(CreateConversationMessageRequest {
                    session_id: session.session_id.clone(),
                    role: if turn % 2 == 0 {
                        "assistant".to_string()
                    } else {
                        "user".to_string()
                    },
                    content: format!("turn-{turn}"),
                    name: None,
                    meta_info: None,
                    is_truncated: Some(false),
                    parent_message_id: None,
                })
                .await
                .expect("append message");
        }

        store
            .persist_local_conversation_summary(
                &session.session_id,
                "summary snapshot",
                Some("test-worker"),
            )
            .await
            .expect("persist summary");

        let window = store
            .load_local_conversation_runtime_window(&session.session_id)
            .await
            .expect("load runtime window");

        assert_eq!(window.messages.len(), 12);
        assert_eq!(
            window
                .messages
                .first()
                .and_then(|item| item.content.as_ref())
                .and_then(|value| value.as_str()),
            Some("turn-3")
        );
        assert_eq!(
            window
                .messages
                .last()
                .and_then(|item| item.content.as_ref())
                .and_then(|value| value.as_str()),
            Some("turn-14")
        );
        assert_eq!(
            window
                .summary
                .as_ref()
                .and_then(|value| value.get("summary_text"))
                .and_then(|value| value.as_str()),
            Some("summary snapshot")
        );
    }

    #[tokio::test]
    async fn process_summary_job_uses_runtime_window_range() {
        let store = create_test_store("summary-runtime-window").await;
        let session = store
            .create_local_conversation(LocalConversationCreateRequest {
                assistant_id: None,
                title: Some("summary-runtime-window".to_string()),
            })
            .await
            .expect("create conversation");

        for turn in 1..=14 {
            store
                .append_local_conversation_message(CreateConversationMessageRequest {
                    session_id: session.session_id.clone(),
                    role: if turn % 2 == 0 {
                        "assistant".to_string()
                    } else {
                        "user".to_string()
                    },
                    content: format!("marker-{turn}"),
                    name: None,
                    meta_info: None,
                    is_truncated: Some(false),
                    parent_message_id: None,
                })
                .await
                .expect("append message");
        }

        store
            .enqueue_local_conversation_summary_job(&session.session_id, "test")
            .await
            .expect("enqueue summary job");

        process_next_local_conversation_summary_job_with_store(&store)
            .await
            .expect("process summary job");

        let window = store
            .load_local_conversation_runtime_window(&session.session_id)
            .await
            .expect("load runtime window");
        let summary = window.summary.expect("summary exists");

        assert_eq!(
            summary
                .get("covered_from_turn")
                .and_then(|value| value.as_i64()),
            Some(3)
        );
        assert_eq!(
            summary
                .get("covered_to_turn")
                .and_then(|value| value.as_i64()),
            Some(14)
        );
        let summary_text = summary
            .get("summary_text")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(!summary_text.lines().any(|line| line.ends_with("marker-1")));
        assert!(!summary_text.lines().any(|line| line.ends_with("marker-2")));
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn approval_flow_reject_and_approve_execute_paths_work() {
        let store = create_test_store("approval-flow").await;
        let tool = upsert_test_tool(&store, "execute_demo", "cat").await;
        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());

        let queued = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "execute_demo".to_string(),
            serde_json::json!({"x": 1}),
            true,
        )
        .await
        .expect("queue pending approval");
        let token = queued
            .get("approval_token")
            .and_then(|value| value.as_str())
            .expect("approval token")
            .to_string();
        assert_eq!(
            queued.get("status").and_then(|value| value.as_str()),
            Some("REQUIRES_APPROVAL")
        );
        assert_eq!(
            queued.get("tool_id").and_then(|value| value.as_str()),
            Some(tool.id.as_str())
        );

        let queued_pending = pending_tool_calls
            .read()
            .await
            .get(&token)
            .cloned()
            .expect("queued pending tool call");
        assert_eq!(queued_pending.tool_id.as_deref(), Some(tool.id.as_str()));

        let removed = reject_mcp_tool_inner(&pending_tool_calls, &token).await;
        assert!(removed);
        assert!(pending_tool_calls.read().await.is_empty());

        let queued_again = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "execute_demo".to_string(),
            serde_json::json!({"x": 2}),
            true,
        )
        .await
        .expect("queue second pending approval");
        let token_again = queued_again
            .get("approval_token")
            .and_then(|value| value.as_str())
            .expect("approval token")
            .to_string();

        let approved = approve_mcp_tool_inner(&store, &pending_tool_calls, &token_again)
            .await
            .expect("approve and execute");
        assert_eq!(
            approved.get("method").and_then(|value| value.as_str()),
            Some("execute_demo")
        );
        assert_eq!(
            approved
                .get("arguments")
                .and_then(|value| value.get("x"))
                .and_then(|value| value.as_i64()),
            Some(2)
        );
        assert!(pending_tool_calls.read().await.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn approval_flow_replays_by_tool_id_before_stale_tool_name() {
        let store = create_test_store("approval-flow-tool-id").await;
        let tool = upsert_test_tool(&store, "execute_demo_by_id", "cat").await;
        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());

        let queued = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "execute_demo_by_id".to_string(),
            serde_json::json!({"x": 3}),
            true,
        )
        .await
        .expect("queue pending approval");
        let token = queued
            .get("approval_token")
            .and_then(|value| value.as_str())
            .expect("approval token")
            .to_string();

        {
            let mut guard = pending_tool_calls.write().await;
            let pending = guard
                .get_mut(&token)
                .expect("pending tool call should exist");
            assert_eq!(pending.tool_id.as_deref(), Some(tool.id.as_str()));
            pending.tool_name = "stale_execute_demo_name".to_string();
        }

        let approved = approve_mcp_tool_inner(&store, &pending_tool_calls, &token)
            .await
            .expect("approve and execute with tool id");
        assert_eq!(
            approved.get("method").and_then(|value| value.as_str()),
            Some("execute_demo_by_id")
        );
        assert_eq!(
            approved
                .get("arguments")
                .and_then(|value| value.get("x"))
                .and_then(|value| value.as_i64()),
            Some(3)
        );
        assert!(pending_tool_calls.read().await.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn execute_or_queue_rejects_stopped_tool_before_execution() {
        let store = create_test_store("execute-stopped-tool").await;
        let tool = upsert_test_tool(&store, "stopped_demo", "cat").await;
        store
            .set_tool_status(&tool.id, McpToolStatus::Stopped, None, None)
            .await
            .expect("set stopped status");
        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());

        let err = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "stopped_demo".to_string(),
            serde_json::json!({"x": 1}),
            false,
        )
        .await
        .expect_err("stopped tool should be blocked before execution");

        assert!(err.contains("tool_installed_but_stopped"), "{err}");
        assert!(pending_tool_calls.read().await.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn list_local_stdio_tools_discovers_tools_via_rmcp() {
        let script_path = write_mock_stdio_mcp_server_script("list-local-stdio-tools");
        let args = vec![script_path.to_string_lossy().to_string()];

        let discovered = list_local_stdio_tools("python3", &args, None)
            .await
            .expect("discover local stdio mcp tools");

        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].name, "echo");
        assert_eq!(
            discovered[0].input_schema.get("type"),
            Some(&serde_json::json!("object"))
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn execute_or_queue_routes_stdio_mcp_tools_through_rmcp() {
        let store = create_test_store("execute-stdio-mcp-tool").await;
        let script_path = write_mock_stdio_mcp_server_script("execute-stdio-mcp-tool");
        let _tool = upsert_test_stdio_mcp_tool(&store, "mock_stdio", "echo", &script_path).await;
        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());

        let result = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "echo".to_string(),
            serde_json::json!({"message": "hello from rmcp"}),
            false,
        )
        .await
        .expect("execute stdio mcp tool through rmcp");

        assert_eq!(
            result
                .get("structuredContent")
                .and_then(|value| value.get("echo"))
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str()),
            Some("hello from rmcp")
        );
        assert_eq!(
            result.get("isError").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert!(pending_tool_calls.read().await.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn apply_config_payload_imports_stdio_mcp_server_as_discovered_tool_and_executes() {
        let store = create_test_store("apply-config-stdio-mcp").await;
        let source = store
            .ensure_local_source()
            .await
            .expect("ensure local source");
        let script_path = write_mock_stdio_mcp_server_script("apply-config-stdio-mcp");
        let legacy_identifier = format!("{}/{}", source.id, "mock_stdio");
        let _legacy = upsert_test_tool_with_identifier(
            &store,
            "mock_stdio",
            "python3",
            Some(legacy_identifier),
        )
        .await;

        let payload: McpConfigPayload = serde_json::from_value(serde_json::json!({
            "mcpServers": {
                "mock_stdio": {
                    "type": "stdio",
                    "command": "python3",
                    "args": [script_path.to_string_lossy().to_string()],
                    "description": "Mock stdio MCP server",
                    "capabilities": ["test"]
                }
            }
        }))
        .expect("deserialize stdio mcp payload");

        let imported = apply_config_payload_to_store(&store, &source, payload)
            .await
            .expect("apply stdio mcp config payload");

        assert_eq!(imported.len(), 1);
        let tool = &imported[0];
        assert_eq!(tool.name, "echo");
        assert_eq!(tool.command.as_deref(), Some("python3"));
        assert_eq!(tool.transport_kind(), McpTransportKind::Stdio);
        assert!(tool.is_stdio_mcp_tool());
        assert_eq!(tool.stdio_mcp_tool_name().as_deref(), Some("echo"));
        assert_eq!(tool.remote_server_name().as_deref(), Some("mock_stdio"));
        let expected_identifier = format!("{}/stdio/{}/{}", source.id, "mock_stdio", "echo");
        assert_eq!(
            tool.identifier.as_deref(),
            Some(expected_identifier.as_str())
        );

        assert!(store
            .get_tool_by_name("mock_stdio")
            .await
            .expect("read legacy tool by name")
            .is_none());
        let stored_tools = store.list_tools().await.expect("list stored tools");
        assert_eq!(stored_tools.len(), 1);
        assert_eq!(stored_tools[0].name, "echo");

        let pending_tool_calls =
            RwLock::new(HashMap::<String, crate::modules::mcp::PendingToolCall>::new());
        let result = execute_or_queue_mcp_tool_call(
            &store,
            &pending_tool_calls,
            "echo".to_string(),
            serde_json::json!({"message": "hello from imported config"}),
            false,
        )
        .await
        .expect("execute imported stdio mcp tool through rmcp");

        assert_eq!(
            result
                .get("structuredContent")
                .and_then(|value| value.get("echo"))
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str()),
            Some("hello from imported config")
        );
        assert_eq!(
            result.get("isError").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert!(pending_tool_calls.read().await.is_empty());
    }

    #[tokio::test]
    async fn plain_local_command_tool_is_not_classified_as_stdio_mcp_tool() {
        let store = create_test_store("plain-local-command-tool").await;
        let tool = upsert_test_tool(&store, "plain_command_demo", "cat").await;

        assert_eq!(tool.transport_kind(), McpTransportKind::Stdio);
        assert!(!tool.is_stdio_mcp_tool());
        assert_eq!(tool.stdio_mcp_tool_name(), None);
    }

    #[tokio::test]
    async fn abort_local_chat_task_by_request_id_cancels_task() {
        let local_chat_tasks = RwLock::new(HashMap::<String, tokio::task::AbortHandle>::new());
        let task = tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            1usize
        });

        {
            let mut tasks = local_chat_tasks.write().await;
            tasks.insert("req-cancel-1".to_string(), task.abort_handle());
        }

        let removed = local_chat_tasks.write().await.remove("req-cancel-1");
        let canceled = removed.is_some();
        if let Some(abort_handle) = removed {
            abort_handle.abort();
        }
        assert!(canceled);
        assert!(local_chat_tasks.read().await.is_empty());

        match task.await {
            Err(err) => assert!(err.is_cancelled()),
            Ok(_) => panic!("task should be canceled"),
        }
    }

    #[tokio::test]
    async fn abort_local_chat_task_by_request_id_returns_false_when_missing() {
        let local_chat_tasks = RwLock::new(HashMap::<String, tokio::task::AbortHandle>::new());
        let canceled = local_chat_tasks
            .write()
            .await
            .remove("req-missing")
            .is_some();
        assert!(!canceled);
    }

    #[tokio::test]
    async fn disable_missing_cloud_managed_local_skills_only_disables_missing_cloud_items() {
        let store = create_test_store("cloud-install-disable-missing").await;

        let cloud_settings_keep = serde_json::json!({
            "sync_source": "cloud_plugin_market",
            "alias": "keep",
        });
        let cloud_settings_remove = serde_json::json!({
            "sync_source": "cloud_plugin_market",
            "alias": "remove",
        });
        let local_settings = serde_json::json!({
            "sync_source": "manual_local",
            "alias": "local",
        });

        store
            .upsert_local_skill_install_state(
                "skill.keep",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.keep\"}",
                "/tmp/skill.keep",
                Some(&cloud_settings_keep),
            )
            .await
            .expect("insert cloud keep");
        store
            .upsert_local_skill_install_state(
                "skill.remove",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.remove\"}",
                "/tmp/skill.remove",
                Some(&cloud_settings_remove),
            )
            .await
            .expect("insert cloud remove");
        store
            .upsert_local_skill_install_state(
                "skill.local",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.local\"}",
                "/tmp/skill.local",
                Some(&local_settings),
            )
            .await
            .expect("insert local");

        let disabled = store
            .disable_missing_cloud_managed_local_skills(&["skill.keep".to_string()])
            .await
            .expect("disable missing cloud installs");
        assert_eq!(disabled, 1);

        let enabled = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled ids");
        assert!(enabled.contains("skill.keep"));
        assert!(enabled.contains("skill.local"));
        assert!(!enabled.contains("skill.remove"));
    }

    #[tokio::test]
    async fn local_assistant_roundtrips_updates_tags_entities_and_messages() {
        let store = create_test_store("assistant-roundtrip").await;

        let assistant_id = store
            .create_local_assistant(CreateLocalAssistantRequest {
                name: "Trip Planner".to_string(),
                description: Some("helps organize travel".to_string()),
                avatar: None,
                system_prompt: "Plan efficient trips.".to_string(),
                model_config: None,
                tags: Some(vec!["travel".to_string(), "planner".to_string()]),
                visibility: Some("private".to_string()),
                source: Some("local".to_string()),
                cloud_id: None,
            })
            .await
            .expect("create local assistant");

        let updated = store
            .update_local_assistant(
                &assistant_id,
                UpdateLocalAssistantRequest {
                    name: Some("Trip Concierge".to_string()),
                    description: Some("curates premium itineraries".to_string()),
                    avatar: None,
                    system_prompt: Some("Curate and refine travel itineraries.".to_string()),
                    model_config: None,
                    tags: Some(vec!["travel".to_string(), "concierge".to_string()]),
                    visibility: Some("public".to_string()),
                    source: None,
                    cloud_id: None,
                },
            )
            .await
            .expect("update local assistant");

        assert_eq!(updated.id, assistant_id);
        assert_eq!(updated.name, "Trip Concierge");
        assert_eq!(
            updated.description.as_deref(),
            Some("curates premium itineraries")
        );
        assert_eq!(updated.visibility, "public");
        assert_eq!(updated.tags, vec!["travel", "concierge"]);

        let assistants = store
            .list_local_assistants()
            .await
            .expect("list local assistants");
        assert_eq!(assistants.len(), 1);
        assert_eq!(assistants[0].id, assistant_id);
        assert_eq!(assistants[0].name, "Trip Concierge");

        let entities = store
            .list_local_assistant_entities()
            .await
            .expect("list local assistant entities");
        let entity = entities
            .iter()
            .find(|item| item.id == assistant_id)
            .expect("assistant entity exists");
        assert_eq!(entity.visibility, "public");
        assert_eq!(
            entity.summary.as_deref(),
            Some("curates premium itineraries")
        );

        let versions = store
            .list_local_assistant_versions(Some(&assistant_id))
            .await
            .expect("list local assistant versions");
        assert!(!versions.is_empty());
        assert_eq!(versions[0].assistant_id, assistant_id);
        assert_eq!(versions[0].tags, vec!["travel", "concierge"]);

        let message = store
            .append_assistant_message(CreateAssistantMessageRequest {
                assistant_id: assistant_id.clone(),
                role: "assistant".to_string(),
                content: "Here is a curated Paris itinerary.".to_string(),
            })
            .await
            .expect("append assistant message");
        assert_eq!(message.assistant_id, assistant_id);
        assert_eq!(message.role, "assistant");

        let messages = store
            .list_assistant_messages(&message.assistant_id)
            .await
            .expect("list assistant messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Here is a curated Paris itinerary.");
    }

    #[tokio::test]
    async fn source_insert_and_status_update_roundtrip() {
        let store = create_test_store("source-roundtrip").await;

        let source = store
            .insert_source(NewSource {
                name: "demo-cloud".to_string(),
                source_type: McpSourceType::Cloud,
                path_or_url: "https://example.com/mcp.json".to_string(),
                trust_level: McpTrustLevel::Community,
                status: McpSourceStatus::Active,
                last_synced_at: None,
                is_read_only: false,
            })
            .await
            .expect("insert source");

        let listed = store.list_sources().await.expect("list sources");
        let listed_source = listed
            .iter()
            .find(|item| item.id == source.id)
            .expect("inserted source is listed");
        assert_eq!(listed_source.name, "demo-cloud");
        assert_eq!(listed_source.source_type.as_str(), "cloud");
        assert_eq!(listed_source.trust_level.as_str(), "community");
        assert_eq!(listed_source.status.as_str(), "active");

        store
            .update_source_status(
                &source.id,
                McpSourceStatus::Syncing,
                Some("2026-03-08T00:00:00Z".to_string()),
            )
            .await
            .expect("update source status");

        let refreshed = store
            .get_source(&source.id)
            .await
            .expect("get source")
            .expect("source exists after status update");
        assert_eq!(refreshed.status.as_str(), "syncing");
        assert_eq!(
            refreshed.last_synced_at.as_deref(),
            Some("2026-03-08T00:00:00Z")
        );
    }

    #[tokio::test]
    async fn skill_sources_are_hidden_from_sync_source_listing() {
        let store = create_test_store("skill-source-hidden").await;

        let visible_source = store
            .insert_source(NewSource {
                name: "demo-local".to_string(),
                source_type: McpSourceType::Local,
                path_or_url: "/tmp/demo-local.json".to_string(),
                trust_level: McpTrustLevel::Private,
                status: McpSourceStatus::Active,
                last_synced_at: None,
                is_read_only: false,
            })
            .await
            .expect("insert visible source");

        let skill_source = store
            .insert_source(NewSource {
                name: "skill:official.skills.echo".to_string(),
                source_type: McpSourceType::Skill,
                path_or_url: "/tmp/skills/echo".to_string(),
                trust_level: McpTrustLevel::Official,
                status: McpSourceStatus::Active,
                last_synced_at: None,
                is_read_only: true,
            })
            .await
            .expect("insert skill source");

        assert_eq!(skill_source.source_type, McpSourceType::Skill);
        assert!(store.is_internal_skill_source(&skill_source));

        let listed = store.list_sources().await.expect("list visible sources");
        assert!(listed.iter().any(|item| item.id == visible_source.id));
        assert!(listed.iter().all(|item| item.id != skill_source.id));

        let stored_skill = store
            .find_source_by_name("skill:official.skills.echo")
            .await
            .expect("find stored skill source")
            .expect("skill source exists");
        assert_eq!(stored_skill.source_type, McpSourceType::Skill);
    }

    #[tokio::test]
    async fn purge_legacy_skill_mcp_rows_removes_old_skill_sources_and_tools() {
        let store = create_test_store("skill-source-migrate").await;

        let legacy_skill_source = store
            .insert_source(NewSource {
                name: "skill:legacy.example".to_string(),
                source_type: McpSourceType::Local,
                path_or_url: "/tmp/skills/legacy.example".to_string(),
                trust_level: McpTrustLevel::Community,
                status: McpSourceStatus::Active,
                last_synced_at: None,
                is_read_only: false,
            })
            .await
            .expect("insert legacy skill source");

        let config_json = serde_json::json!({
            "command": "python3",
            "args": ["main.py"]
        })
        .to_string();
        let legacy_tool = store
            .upsert_tool(ToolUpsert {
                id: None,
                source_id: legacy_skill_source.id.clone(),
                identifier: Some("skill.legacy.example/repair".to_string()),
                name: "legacy_skill_tool".to_string(),
                source_type: McpSourceType::Local,
                status: McpToolStatus::Healthy,
                ping_ms: None,
                capabilities: vec![],
                description: "legacy skill tool".to_string(),
                error: None,
                command: Some("python3".to_string()),
                args: Some(vec!["main.py".to_string()]),
                env: None,
                config_json: config_json.clone(),
                config_hash: hash_config(&config_json),
                pending_config_json: None,
                pending_config_hash: None,
                conflict_status: McpConflictStatus::None,
                is_read_only: false,
                is_new: false,
            })
            .await
            .expect("insert legacy skill tool");

        let migrated = store
            .purge_legacy_skill_mcp_rows()
            .await
            .expect("purge legacy skill rows");
        assert!(migrated >= 2);

        let stored = store
            .get_source(&legacy_skill_source.id)
            .await
            .expect("get purged source");
        assert!(stored.is_none());

        let stored_tool = store
            .get_tool(&legacy_tool.id)
            .await
            .expect("get purged tool");
        assert!(stored_tool.is_none());

        let listed = store.list_sources().await.expect("list visible sources");
        assert!(listed.iter().all(|item| item.id != legacy_skill_source.id));
    }

    #[tokio::test]
    async fn sync_local_system_assets_inner_persists_registry_and_disables_non_executable_assets() {
        let store = create_test_store("system-assets-sync-inner").await;

        let cloud_settings = serde_json::json!({"sync_source": "cloud_plugin_market"});
        store
            .upsert_local_skill_install_state(
                "skill.hidden",
                Some("1.0.0"),
                true,
                Some("python"),
                r#"{"id":"skill.hidden"}"#,
                "/tmp/skill.hidden",
                Some(&cloud_settings),
            )
            .await
            .expect("seed hidden skill install");
        store
            .upsert_local_skill_install_state(
                "skill.meta",
                Some("1.0.0"),
                true,
                Some("python"),
                r#"{"id":"skill.meta"}"#,
                "/tmp/skill.meta",
                Some(&cloud_settings),
            )
            .await
            .expect("seed metadata skill install");

        let assistant = CloudSystemAssistantSnapshot {
            assistant_id: "assistant.hidden".to_string(),
            icon_id: None,
            share_slug: None,
            summary: Some("hidden assistant".to_string()),
            published_at: None,
            install_count: 0,
            rating_avg: 0.0,
            rating_count: 0,
            version: CloudSystemAssistantVersionSnapshot {
                id: "assistant.hidden.v1".to_string(),
                version: "1.0.0".to_string(),
                name: "Hidden Assistant".to_string(),
                description: Some("desc".to_string()),
                system_prompt: Some("prompt".to_string()),
                tags: vec![],
                published_at: None,
            },
        };
        store
            .sync_cloud_system_assistants(&[assistant])
            .await
            .expect("seed cloud assistant");
        store
            .install_local_assistant(
                "assistant.hidden",
                LocalAssistantInstallCreateRequest {
                    follow_latest: Some(true),
                    pinned_version_id: None,
                },
            )
            .await
            .expect("install assistant.hidden");

        let payload = serde_json::json!({
            "items": [
                {
                    "asset_id": "skill:skill.hidden",
                    "title": "Hidden Skill",
                    "description": "no local exec",
                    "asset_kind": "skill_bundle",
                    "owner_scope": "system",
                    "source_kind": "official",
                    "version": "1.0.0",
                    "artifact_ref": null,
                    "checksum": null,
                    "metadata_json": {"registry_entity": "skill", "manifest": {"id": "skill.hidden"}},
                    "policy_snapshot": {
                        "visibility_scope": "authenticated",
                        "local_sync_policy": "hidden",
                        "execution_policy": "allowed",
                        "permission_grants": [],
                        "allowed_role_names": [],
                        "materialization_state": "hidden"
                    }
                },
                {
                    "asset_id": "skill:skill.meta",
                    "title": "Meta Skill",
                    "description": "metadata only",
                    "asset_kind": "skill_bundle",
                    "owner_scope": "system",
                    "source_kind": "official",
                    "version": "1.0.0",
                    "artifact_ref": null,
                    "checksum": null,
                    "metadata_json": {"registry_entity": "skill", "manifest": {"id": "skill.meta"}},
                    "policy_snapshot": {
                        "visibility_scope": "authenticated",
                        "local_sync_policy": "metadata_only",
                        "execution_policy": "approval_required",
                        "permission_grants": [],
                        "allowed_role_names": [],
                        "materialization_state": "metadata_only"
                    }
                },
                {
                    "asset_id": "assistant:assistant.hidden",
                    "title": "Hidden Assistant",
                    "description": "no local exec",
                    "asset_kind": "assistant_template",
                    "owner_scope": "system",
                    "source_kind": "official",
                    "version": "1.0.0",
                    "artifact_ref": null,
                    "checksum": null,
                    "metadata_json": {
                        "registry_entity": "assistant",
                        "assistant_id": "assistant.hidden",
                        "current_version_id": "assistant.hidden.v1",
                        "summary": "hidden assistant",
                        "icon_id": null,
                        "share_slug": null,
                        "published_at": null,
                        "install_count": 0,
                        "rating_avg": 0.0,
                        "rating_count": 0,
                        "version": {
                            "id": "assistant.hidden.v1",
                            "version": "1.0.0",
                            "name": "Hidden Assistant",
                            "description": "desc",
                            "system_prompt": "prompt",
                            "tags": [],
                            "published_at": null
                        }
                    },
                    "policy_snapshot": {
                        "visibility_scope": "superuser",
                        "local_sync_policy": "hidden",
                        "execution_policy": "allowed",
                        "permission_grants": [],
                        "allowed_role_names": [],
                        "materialization_state": "hidden"
                    }
                },
                {
                    "asset_id": "assistant:assistant.exec",
                    "title": "Executable Assistant",
                    "description": "ok",
                    "asset_kind": "assistant_template",
                    "owner_scope": "system",
                    "source_kind": "official",
                    "version": "1.0.0",
                    "artifact_ref": null,
                    "checksum": null,
                    "metadata_json": {
                        "registry_entity": "assistant",
                        "assistant_id": "assistant.exec",
                        "current_version_id": "assistant.exec.v1",
                        "summary": "Executable assistant summary",
                        "icon_id": "lucide:bot",
                        "share_slug": "assistant-exec",
                        "published_at": "2024-01-02T00:00:00Z",
                        "install_count": 12,
                        "rating_avg": 4.5,
                        "rating_count": 3,
                        "version": {
                            "id": "assistant.exec.v1",
                            "version": "1.0.0",
                            "name": "Executable Assistant",
                            "description": "ok",
                            "system_prompt": "be helpful",
                            "tags": ["utility", "system"],
                            "published_at": "2024-01-02T00:00:00Z"
                        }
                    },
                    "policy_snapshot": {
                        "visibility_scope": "authenticated",
                        "local_sync_policy": "full",
                        "execution_policy": "allowed",
                        "permission_grants": [],
                        "allowed_role_names": [],
                        "materialization_state": "executable"
                    }
                }
            ]
        });
        let (mock_base_url, server_handle) = start_mock_system_assets_server(payload).await;

        let response = sync_local_system_assets_inner(
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            200,
            None,
            false,
        )
        .await
        .expect("sync local system assets");

        assert_eq!(response.fetched_count, 4);
        assert_eq!(response.assistant_fetched_count, 2);
        assert_eq!(response.skill_fetched_count, 2);
        assert_eq!(response.upserted_count, 4);
        assert_eq!(response.hidden_count, 2);
        assert_eq!(response.metadata_only_count, 1);
        assert_eq!(response.executable_count, 1);
        assert_eq!(response.disabled_skill_count, 2);
        assert_eq!(response.archived_assistant_count, 1);

        let enabled_skills = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled skills");
        assert!(!enabled_skills.contains("skill.hidden"));
        assert!(!enabled_skills.contains("skill.meta"));

        let archived_status: String = sqlx::query_scalar(
            "SELECT status FROM assistant WHERE id = 'assistant.hidden' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read assistant status");
        assert_eq!(archived_status, "archived");

        let materialization_state: String = sqlx::query_scalar(
            "SELECT materialization_state FROM system_asset WHERE asset_id = 'assistant:assistant.exec' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read system asset state");
        assert_eq!(materialization_state, "executable");

        let current_version_id: String = sqlx::query_scalar(
            "SELECT current_version_id FROM assistant WHERE id = 'assistant.exec' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read assistant current version");
        assert_eq!(current_version_id, "assistant.exec.v1");

        let version_name: String = sqlx::query_scalar(
            "SELECT name FROM assistant_version WHERE id = 'assistant.exec.v1' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read assistant version name");
        assert_eq!(version_name, "Executable Assistant");

        server_handle.abort();
    }

    #[tokio::test]
    async fn sync_local_system_assets_inner_archives_missing_registry_rows() {
        let store = create_test_store("system-assets-sync-archive-missing").await;
        store
            .sync_cloud_system_assistants(&[CloudSystemAssistantSnapshot {
                assistant_id: "assistant.stale".to_string(),
                icon_id: None,
                share_slug: None,
                summary: Some("stale assistant".to_string()),
                published_at: Some("2024-01-01T00:00:00Z".to_string()),
                install_count: 0,
                rating_avg: 0.0,
                rating_count: 0,
                version: CloudSystemAssistantVersionSnapshot {
                    id: "assistant.stale.v1".to_string(),
                    version: "1.0.0".to_string(),
                    name: "Stale Assistant".to_string(),
                    description: Some("desc".to_string()),
                    system_prompt: Some("prompt".to_string()),
                    tags: vec![],
                    published_at: Some("2024-01-01T00:00:00Z".to_string()),
                },
            }])
            .await
            .expect("seed stale cloud assistant");
        sqlx::query(
            r#"
            INSERT INTO system_asset (
              asset_id, title, description, asset_kind, owner_scope, source_kind, version,
              artifact_ref, checksum, metadata_json, visibility_scope, local_sync_policy,
              execution_policy, permission_grants_json, allowed_role_names_json,
              materialization_state, sync_source, status, created_at, updated_at
            ) VALUES (
              'skill.stale', 'Stale Skill', NULL, 'capability', 'system', 'official', '1.0.0',
              NULL, NULL, '{}', 'authenticated', 'full', 'allowed', '[]', '[]',
              'executable', 'cloud_system_assets', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'
            );
            "#,
        )
        .execute(&store.pool)
        .await
        .expect("seed stale system asset");

        let payload = serde_json::json!({
            "items": [{
                "asset_id": "skill:skill.keep",
                "title": "Keep Skill",
                "description": null,
                "asset_kind": "skill_bundle",
                "owner_scope": "system",
                "source_kind": "official",
                "version": "1.0.0",
                "artifact_ref": null,
                "checksum": null,
                "metadata_json": {"registry_entity": "skill", "manifest": {"id": "skill.keep"}},
                "policy_snapshot": {
                    "visibility_scope": "authenticated",
                    "local_sync_policy": "full",
                    "execution_policy": "allowed",
                    "permission_grants": [],
                    "allowed_role_names": [],
                    "materialization_state": "executable"
                }
            }]
        });
        let (mock_base_url, server_handle) = start_mock_system_assets_server(payload).await;

        let response = sync_local_system_assets_inner(
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            100,
            None,
            false,
        )
        .await
        .expect("sync local system assets");

        assert_eq!(response.archived_count, 1);
        assert_eq!(response.archived_assistant_count, 1);
        let stale_status: String = sqlx::query_scalar(
            "SELECT status FROM system_asset WHERE asset_id = 'skill.stale' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read stale status");
        assert_eq!(stale_status, "archived");

        let stale_assistant_status: String = sqlx::query_scalar(
            "SELECT status FROM assistant WHERE id = 'assistant.stale' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read stale assistant status");
        assert_eq!(stale_assistant_status, "archived");

        server_handle.abort();
    }

    #[tokio::test]
    async fn reset_local_asset_catalog_then_sync_inner_clears_existing_asset_rows() {
        let store = create_test_store("system-assets-reset-local-assets").await;
        let memory = create_test_memory_state("system-assets-reset-local-assets", 4).await;

        memory
            .service
            .upsert_asset(
                "tool.find_skills".into(),
                "find_skills".into(),
                "stale duplicated asset".into(),
                "tool".into(),
                "system_plugin".into(),
                Some("skill.find_skills".into()),
                vec![0.9, 0.1, 0.0, 0.0],
                Some(serde_json::json!({"version": 1})),
            )
            .await
            .expect("seed asset catalog row");
        assert_eq!(
            memory
                .service
                .list_assets_catalog()
                .await
                .expect("list seeded assets")
                .len(),
            1
        );

        let payload = serde_json::json!({"items": []});
        let (mock_base_url, server_handle) = start_mock_system_assets_server(payload).await;

        let response = reset_local_asset_catalog_then_sync_inner(
            &memory.service,
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            50,
            4,
            None,
            false,
        )
        .await
        .expect("reset local asset catalog and sync");

        assert_eq!(response.fetched_count, 0);
        assert!(memory
            .service
            .list_assets_catalog()
            .await
            .expect("list assets after reset")
            .is_empty());

        server_handle.abort();
    }

    #[tokio::test]
    async fn sync_local_system_assets_inner_syncs_skill_install_state_from_unified_feed() {
        let store = create_test_store("system-assets-sync-skill-installs").await;
        let stale_cloud_settings = serde_json::json!({
            "sync_source": "cloud_plugin_market",
            "alias": "stale"
        });
        store
            .upsert_local_skill_install_state(
                "skill.stale",
                Some("0.9.0"),
                true,
                Some("python"),
                r#"{"id":"skill.stale"}"#,
                "/tmp/skill.stale",
                Some(&stale_cloud_settings),
            )
            .await
            .expect("seed stale cloud skill install");

        let payload = serde_json::json!({
            "items": [{
                "asset_id": "skill:skill.installed",
                "title": "Installed Skill",
                "description": "projected via system assets",
                "asset_kind": "skill_bundle",
                "owner_scope": "system",
                "source_kind": "official",
                "version": "1.2.3",
                "artifact_ref": "https://github.com/example/installed-skill",
                "checksum": "rev-123",
                "metadata_json": {
                    "registry_entity": "skill",
                    "skill_id": "skill.installed",
                    "runtime": "python",
                    "manifest": {
                        "id": "skill.installed",
                        "name": "Installed Skill",
                        "version": "1.2.3",
                        "permissions": ["network_read"]
                    },
                    "user_install": {
                        "alias": "desktop-installed",
                        "config_json": {"region": "global"},
                        "granted_permissions": ["network_read"],
                        "installed_revision": "rev-123",
                        "is_enabled": true
                    }
                },
                "policy_snapshot": {
                    "visibility_scope": "authenticated",
                    "local_sync_policy": "full",
                    "execution_policy": "allowed",
                    "permission_grants": ["network_read"],
                    "allowed_role_names": [],
                    "materialization_state": "executable"
                }
            }]
        });
        let (mock_base_url, server_handle) = start_mock_system_assets_server(payload).await;

        let mut skills_dir = std::env::temp_dir();
        skills_dir.push(format!(
            "deeting-system-assets-skill-installs-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&skills_dir).expect("create system-assets skills dir");

        let response = sync_local_system_assets_inner(
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            100,
            Some(&skills_dir),
            false,
        )
        .await
        .expect("sync unified skill installs");

        assert_eq!(response.skill_install_fetched_count, 1);
        assert_eq!(response.assistant_fetched_count, 0);
        assert_eq!(response.skill_fetched_count, 1);
        assert_eq!(response.skill_install_upserted_count, 1);
        assert_eq!(response.skill_reinstalled_count, 0);
        assert_eq!(response.skill_failed_count, 0);
        assert_eq!(response.disabled_skill_count, 1);

        let enabled = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled local skills");
        assert!(enabled.contains("skill.installed"));
        assert!(!enabled.contains("skill.stale"));

        let installed_version: String = sqlx::query_scalar(
            "SELECT installed_version FROM local_skill_install WHERE skill_id = 'skill.installed' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read installed skill version");
        assert_eq!(installed_version, "rev-123");

        let user_settings_json: String = sqlx::query_scalar(
            "SELECT user_settings_json FROM local_skill_install WHERE skill_id = 'skill.installed' LIMIT 1;",
        )
        .fetch_one(&store.pool)
        .await
        .expect("read installed skill settings");
        assert!(user_settings_json.contains("desktop-installed"));

        server_handle.abort();
        let _ = std::fs::remove_dir_all(&skills_dir);
    }

    #[tokio::test]
    async fn local_skill_registration_self_heal_needed_detects_missing_db_and_vector_index() {
        let store = create_test_store("system-assets-self-heal-scan").await;
        let memory_state = create_test_memory_state("system-assets-self-heal-scan", 3).await;

        let mut skills_dir = std::env::temp_dir();
        skills_dir.push(format!(
            "deeting-system-assets-self-heal-{}",
            Uuid::new_v4()
        ));
        let skill_dir = skills_dir.join("skill.self-heal");
        std::fs::create_dir_all(&skill_dir).expect("create self-heal skill dir");
        std::fs::write(
            skill_dir.join("deeting.json"),
            r#"{"id":"skill.self-heal","name":"Self Heal Skill","runtime":"python"}"#,
        )
        .expect("write self-heal manifest");
        std::fs::write(
            skill_dir.join("llm-tool.yaml"),
            "tools:\n  - name: diagnose\n    description: Diagnose installation gaps\n",
        )
        .expect("write self-heal tool spec");

        assert!(local_skill_registration_self_heal_needed(
            &store,
            Some(&memory_state.service),
            std::slice::from_ref(&skills_dir),
        )
        .await
        .expect("detect missing skill source"));

        store
            .upsert_local_skill_install_state(
                "skill.self-heal",
                Some("1.0.0"),
                true,
                Some("python"),
                r#"{"id":"skill.self-heal","name":"Self Heal Skill"}"#,
                skill_dir.to_string_lossy().as_ref(),
                None,
            )
            .await
            .expect("upsert self-heal install state");

        assert!(local_skill_registration_self_heal_needed(
            &store,
            Some(&memory_state.service),
            std::slice::from_ref(&skills_dir),
        )
        .await
        .expect("detect missing skill asset"));

        assert!(local_skill_registration_self_heal_needed(
            &store,
            Some(&memory_state.service),
            std::slice::from_ref(&skills_dir),
        )
        .await
        .expect("detect missing vector asset"));

        memory_state
            .store
            .upsert_asset(
                "skill.self-heal".to_string(),
                "Self Heal Skill".to_string(),
                "Installed skill bundle for Self Heal Skill".to_string(),
                "skill".to_string(),
                "user".to_string(),
                Some("skill.self-heal".to_string()),
                vec![1.0, 0.0, 0.0],
                Some(serde_json::json!({
                    "id": "skill.self-heal",
                    "name": "Self Heal Skill",
                    "source_metadata": {
                        "doc_paths": ["llm-tool.yaml"],
                        "doc_excerpt": "Diagnose installation gaps"
                    }
                })),
            )
            .await
            .expect("upsert self-heal skill asset");

        assert!(!local_skill_registration_self_heal_needed(
            &store,
            Some(&memory_state.service),
            std::slice::from_ref(&skills_dir),
        )
        .await
        .expect("self-heal no longer needed after db/vector repair"));

        let _ = std::fs::remove_dir_all(&skills_dir);
    }

    #[tokio::test]
    async fn local_skill_registration_self_heal_needed_scans_official_skill_roots_too() {
        let store = create_test_store("system-assets-self-heal-official-root").await;
        let memory_state =
            create_test_memory_state("system-assets-self-heal-official-root", 3).await;

        let mut official_root = std::env::temp_dir();
        official_root.push(format!(
            "deeting-system-assets-official-root-{}",
            Uuid::new_v4()
        ));
        let mut user_root = std::env::temp_dir();
        user_root.push(format!(
            "deeting-system-assets-user-root-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&official_root).expect("create official root");
        std::fs::create_dir_all(&user_root).expect("create user root");

        let skill_dir = official_root.join("skill.official-heal");
        std::fs::create_dir_all(&skill_dir).expect("create official skill dir");
        std::fs::write(
            skill_dir.join("deeting.json"),
            r#"{"id":"skill.official-heal","name":"Official Heal Skill","runtime":"python"}"#,
        )
        .expect("write official skill manifest");
        std::fs::write(
            skill_dir.join("llm-tool.yaml"),
            "tools:\n  - name: inspect\n    description: Inspect official skill coverage\n",
        )
        .expect("write official tool spec");

        let roots = vec![official_root.clone(), user_root.clone()];
        assert!(local_skill_registration_self_heal_needed(
            &store,
            Some(&memory_state.service),
            &roots
        )
        .await
        .expect("detect missing official-root skill source"));

        let _ = std::fs::remove_dir_all(&official_root);
        let _ = std::fs::remove_dir_all(&user_root);
    }

    #[tokio::test]
    async fn register_local_skills_from_scan_targets_inner_restores_deleted_skill_indices() {
        let test_name = "system-assets-self-heal-restore";
        let store = create_test_store(test_name).await;
        let (base_url, server_handle) = start_mock_embedding_server(HashMap::from([(
            "name: repair\ndescription: repair the local skill index".to_string(),
            vec![0.31, 0.32, 0.33],
        )]))
        .await;
        let provider_state =
            std::sync::Arc::new(create_test_provider_state(test_name, &base_url).await);
        let memory_state = std::sync::Arc::new(create_test_memory_state(test_name, 3).await);

        let mut skill_root = std::env::temp_dir();
        skill_root.push(format!(
            "deeting-system-assets-restore-root-{}",
            Uuid::new_v4()
        ));
        let skill_dir = skill_root.join("skill.restore");
        std::fs::create_dir_all(&skill_dir).expect("create restore skill dir");
        std::fs::write(
            skill_dir.join("deeting.json"),
            r#"{"id":"skill.restore","name":"Restore Skill","description":"Repair the local skill index","runtime":["local"]}"#,
        )
        .expect("write restore manifest");
        std::fs::write(
            skill_dir.join("llm-tool.yaml"),
            "tools:\n  - name: repair\n    description: Repair the local skill index\n",
        )
        .expect("write restore tool spec");
        std::fs::write(skill_dir.join("main.py"), "print('restore skill')\n")
            .expect("write restore main.py");

        let scan_targets = vec![(skill_root.clone(), "user_skill")];
        let indexed = register_local_skills_from_scan_targets_inner(
            &scan_targets,
            "/tmp/deeting-sdk",
            &store,
            provider_state.clone(),
            memory_state.clone(),
            true,
        )
        .await
        .expect("initial skill registration");
        assert_eq!(indexed, 1);

        let install_path = store
            .get_local_skill_install_path("skill.restore")
            .await
            .expect("get initial install path");
        assert_eq!(install_path.as_deref(), Some(skill_dir.to_string_lossy().as_ref()));
        assert!(memory_state
            .service
            .get_asset_by_id("skill.restore")
            .await
            .expect("get initial skill asset")
            .is_some());

        memory_state
            .service
            .delete_assets_by_package("skill.restore")
            .await
            .expect("delete restore vector asset");
        store
            .delete_local_skill_install("skill.restore")
            .await
            .expect("delete restore install row");

        assert!(local_skill_registration_self_heal_needed(
            &store,
            Some(memory_state.service.as_ref()),
            std::slice::from_ref(&skill_root),
        )
        .await
        .expect("detect deleted restore indices"));

        let restored = register_local_skills_from_scan_targets_inner(
            &scan_targets,
            "/tmp/deeting-sdk",
            &store,
            provider_state.clone(),
            memory_state.clone(),
            true,
        )
        .await
        .expect("restore skill registration");
        assert_eq!(restored, 1);

        let restored_path = store
            .get_local_skill_install_path("skill.restore")
            .await
            .expect("get restored install path");
        assert_eq!(restored_path.as_deref(), Some(skill_dir.to_string_lossy().as_ref()));
        assert!(memory_state
            .service
            .get_asset_by_id("skill.restore")
            .await
            .expect("get restored skill asset")
            .is_some());
        assert!(!local_skill_registration_self_heal_needed(
            &store,
            Some(memory_state.service.as_ref()),
            std::slice::from_ref(&skill_root),
        )
        .await
        .expect("self-heal cleared after restore"));

        server_handle.abort();
        let _ = std::fs::remove_dir_all(&skill_root);
    }

    #[test]
    fn read_local_mcp_config_creates_default_when_missing() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("deeting-mcp-config-{}", Uuid::new_v4()));
        let path: PathBuf = dir.join("mcp.json");

        let content = read_local_mcp_config(&path).expect("create default local mcp config");
        assert_eq!(content, r#"{"mcpServers":{}}"#);
        assert!(path.exists());

        let persisted =
            std::fs::read_to_string(&path).expect("read persisted default local mcp config");
        assert_eq!(persisted, r#"{"mcpServers":{}}"#);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn resolve_skill_env_applies_desktop_scout_override_for_crawler_tools() {
        let store = create_test_store("resolve-scout-env-crawler").await;
        store
            .set_desktop_config("scout.base_url", "https://scout.example.com/")
            .await
            .expect("set desktop scout base url");

        let tool = upsert_test_tool(&store, "fetch_web_content", "python3").await;
        let env = resolve_skill_env(&store, &tool)
            .await
            .expect("resolve skill env")
            .expect("crawler env should exist");

        assert_eq!(
            env.get("SCOUT_SERVICE_URL").map(String::as_str),
            Some("https://scout.example.com")
        );
    }

    #[tokio::test]
    async fn resolve_effective_desktop_scout_base_url_falls_back_to_runtime_env() {
        let _env_guard = env_lock().lock().expect("lock env");
        std::env::remove_var(SCOUT_SERVICE_URL_ENV_KEY);

        let store = create_test_store("effective-scout-env-fallback").await;
        std::env::set_var(SCOUT_SERVICE_URL_ENV_KEY, "https://env-scout.example.com/");

        let resolved = resolve_effective_desktop_scout_base_url(&store)
            .await
            .expect("resolve effective scout base url");

        assert_eq!(resolved.as_deref(), Some("https://env-scout.example.com"));

        std::env::remove_var(SCOUT_SERVICE_URL_ENV_KEY);
    }

    #[tokio::test]
    async fn resolve_effective_desktop_scout_base_url_prefers_persisted_override() {
        let _env_guard = env_lock().lock().expect("lock env");
        std::env::set_var(SCOUT_SERVICE_URL_ENV_KEY, "https://env-scout.example.com/");

        let store = create_test_store("effective-scout-persisted-preferred").await;
        store
            .set_desktop_config("scout.base_url", "https://persisted-scout.example.com/")
            .await
            .expect("set persisted desktop scout base url");

        let resolved = resolve_effective_desktop_scout_base_url(&store)
            .await
            .expect("resolve effective scout base url");

        assert_eq!(
            resolved.as_deref(),
            Some("https://persisted-scout.example.com")
        );

        std::env::remove_var(SCOUT_SERVICE_URL_ENV_KEY);
    }

    #[tokio::test]
    async fn resolve_skill_env_does_not_apply_scout_override_to_other_tools() {
        let store = create_test_store("resolve-scout-env-other").await;
        store
            .set_desktop_config("scout.base_url", "https://scout.example.com/")
            .await
            .expect("set desktop scout base url");

        let tool = upsert_test_tool(&store, "not_crawler_tool", "python3").await;
        let env = resolve_skill_env(&store, &tool)
            .await
            .expect("resolve skill env");

        assert!(env.is_none());
    }
}
