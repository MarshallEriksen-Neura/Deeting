#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State as AxumState, routing::get, Json, Router};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use tokio::net::TcpListener;
    use tokio::sync::RwLock;

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

    async fn upsert_test_tool(
        store: &crate::modules::mcp::store::McpStore,
        name: &str,
        command: &str,
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
                identifier: Some(format!("test/{name}")),
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

    #[derive(Clone)]
    struct MockPluginMarketServerState {
        installs_payload: serde_json::Value,
        plugins_payload: serde_json::Value,
    }

    async fn mock_plugin_installs_handler(
        AxumState(state): AxumState<MockPluginMarketServerState>,
    ) -> Json<serde_json::Value> {
        Json(state.installs_payload)
    }

    async fn mock_plugin_market_handler(
        AxumState(state): AxumState<MockPluginMarketServerState>,
    ) -> Json<serde_json::Value> {
        Json(state.plugins_payload)
    }

    async fn start_mock_plugin_market_server(
        installs_payload: serde_json::Value,
        plugins_payload: serde_json::Value,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock plugin market listener");
        let addr = listener
            .local_addr()
            .expect("read mock plugin market listener addr");
        let app = Router::new()
            .route(
                "/api/v1/plugin-market/installs",
                get(mock_plugin_installs_handler),
            )
            .route(
                "/api/v1/plugin-market/plugins",
                get(mock_plugin_market_handler),
            )
            .with_state(MockPluginMarketServerState {
                installs_payload,
                plugins_payload,
            });
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        (format!("http://{}", addr), server)
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

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["type"], serde_json::json!("function"));
        assert_eq!(tools[0]["function"]["name"], serde_json::json!("search_sdk"));
        assert_eq!(
            tools[0]["function"]["parameters"]["required"],
            serde_json::json!(["query"])
        );
        assert_eq!(tools[1]["function"]["name"], serde_json::json!("execute_code_plan"));
        assert_eq!(
            tools[1]["function"]["parameters"]["required"],
            serde_json::json!(["code"])
        );
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
                && block.get("toolName").and_then(|v| v.as_str())
                    == Some("install_skill_from_git")
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
        assert!(err.to_string().contains("content is empty"));

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
        assert!(jobs.items[0]
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("content is empty"));
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
                status: Some("active".to_string()),
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
        assert!(!summary_text.contains("marker-1"));
        assert!(!summary_text.contains("marker-2"));
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn approval_flow_reject_and_approve_execute_paths_work() {
        let store = create_test_store("approval-flow").await;
        let _ = upsert_test_tool(&store, "execute_demo", "cat").await;
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

    #[tokio::test]
    async fn abort_local_chat_task_by_request_id_cancels_task() {
        let local_chat_tasks = RwLock::new(HashMap::<String, tokio::task::AbortHandle>::new());
        let task = tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            1usize
        });

        register_local_chat_task_abort_handle(
            &local_chat_tasks,
            "req-cancel-1",
            task.abort_handle(),
        )
        .await;

        let canceled = abort_local_chat_task_by_request_id(&local_chat_tasks, "req-cancel-1").await;
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
        let canceled = abort_local_chat_task_by_request_id(&local_chat_tasks, "req-missing").await;
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
    async fn sync_local_skill_installs_from_cloud_inner_applies_light_sync_and_disable_missing() {
        let store = create_test_store("cloud-skill-sync-inner").await;
        let cloud_settings_stale = serde_json::json!({
            "sync_source": "cloud_plugin_market",
            "alias": "stale",
        });
        let local_settings = serde_json::json!({
            "sync_source": "manual_local",
            "alias": "local-only",
        });

        store
            .upsert_local_skill_install_state(
                "skill.stale",
                Some("0.9.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.stale\"}",
                "/tmp/skill.stale",
                Some(&cloud_settings_stale),
            )
            .await
            .expect("insert stale cloud-managed skill");
        store
            .upsert_local_skill_install_state(
                "skill.local_only",
                Some("1.0.0"),
                true,
                Some("python"),
                "{\"id\":\"skill.local_only\"}",
                "/tmp/skill.local_only",
                Some(&local_settings),
            )
            .await
            .expect("insert local-only skill");

        let installs_payload = serde_json::json!([
            {
                "skill_id": "skill.keep",
                "alias": "keep",
                "config_json": {"temperature": 0.2},
                "granted_permissions": ["network"],
                "installed_revision": "rev-keep",
                "is_enabled": true
            },
            {
                "skill_id": "skill.disabled",
                "alias": "disabled",
                "config_json": {},
                "granted_permissions": [],
                "installed_revision": "rev-disabled",
                "is_enabled": false
            }
        ]);
        let plugins_payload = serde_json::json!([
            {
                "id": "skill.keep",
                "name": "Keep Skill",
                "description": "keep me installed",
                "version": "1.2.0",
                "source_repo": null,
                "source_revision": "main"
            },
            {
                "id": "skill.disabled",
                "name": "Disabled Skill",
                "description": "disabled from cloud",
                "version": "2.0.0",
                "source_repo": null,
                "source_revision": "main"
            }
        ]);
        let (mock_base_url, server_handle) =
            start_mock_plugin_market_server(installs_payload, plugins_payload).await;

        let mut skills_dir = std::env::temp_dir();
        skills_dir.push(format!("deeting-cloud-sync-inner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&skills_dir).expect("create temporary skills dir");

        let response = sync_local_skill_installs_from_cloud_inner(
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            &skills_dir,
            false,
        )
        .await
        .expect("sync local skill installs from cloud");

        assert_eq!(response.fetched_count, 2);
        assert_eq!(response.upserted_count, 2);
        assert_eq!(response.reinstalled_count, 0);
        assert_eq!(response.failed_count, 0);
        assert_eq!(response.items.len(), 2);

        let mut status_by_skill_id = HashMap::new();
        for item in response.items {
            status_by_skill_id.insert(item.skill_id, item.status);
        }
        assert_eq!(
            status_by_skill_id.get("skill.keep").map(String::as_str),
            Some("metadata_synced")
        );
        assert_eq!(
            status_by_skill_id.get("skill.disabled").map(String::as_str),
            Some("disabled_synced")
        );

        let enabled = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled local skill ids");
        assert!(enabled.contains("skill.keep"));
        assert!(enabled.contains("skill.local_only"));
        assert!(!enabled.contains("skill.disabled"));
        assert!(!enabled.contains("skill.stale"));

        server_handle.abort();
        let _ = std::fs::remove_dir_all(&skills_dir);
    }

    #[tokio::test]
    async fn sync_local_skill_installs_from_cloud_inner_marks_failed_reinstall_when_source_repo_missing(
    ) {
        let store = create_test_store("cloud-skill-sync-failed-reinstall").await;

        let installs_payload = serde_json::json!([
            {
                "skill_id": "skill.needs_repo",
                "alias": "repo-missing",
                "config_json": {},
                "granted_permissions": [],
                "installed_revision": "rev-1",
                "is_enabled": true
            }
        ]);
        let plugins_payload = serde_json::json!([
            {
                "id": "skill.needs_repo",
                "name": "Needs Repo Skill",
                "description": "cannot reinstall without source repo",
                "version": "1.0.0",
                "source_repo": null,
                "source_revision": "main"
            }
        ]);
        let (mock_base_url, server_handle) =
            start_mock_plugin_market_server(installs_payload, plugins_payload).await;

        let mut skills_dir = std::env::temp_dir();
        skills_dir.push(format!(
            "deeting-cloud-sync-failed-reinstall-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&skills_dir).expect("create temporary skills dir");

        let response = sync_local_skill_installs_from_cloud_inner(
            &store,
            &reqwest::Client::new(),
            &mock_base_url,
            "test-access-token",
            &skills_dir,
            true,
        )
        .await
        .expect("sync local skill installs from cloud");

        assert_eq!(response.fetched_count, 1);
        assert_eq!(response.upserted_count, 1);
        assert_eq!(response.reinstalled_count, 0);
        assert_eq!(response.failed_count, 1);
        assert_eq!(response.items.len(), 1);

        let item = &response.items[0];
        assert_eq!(item.skill_id, "skill.needs_repo");
        assert_eq!(item.status, "failed_reinstall");
        assert!(!item.reinstalled);
        assert!(item
            .error
            .as_deref()
            .unwrap_or("")
            .contains("source_repo is missing"));

        let enabled = store
            .list_enabled_local_skill_ids()
            .await
            .expect("list enabled local skill ids");
        assert!(enabled.contains("skill.needs_repo"));

        server_handle.abort();
        let _ = std::fs::remove_dir_all(&skills_dir);
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
}
