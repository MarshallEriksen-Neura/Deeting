#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use tokio::sync::RwLock;

    async fn create_test_store(test_name: &str) -> crate::modules::mcp::store::McpStore {
        let mut db_path = std::env::temp_dir();
        db_path.push(format!(
            "deeting-tauri-{test_name}-{}.db",
            Uuid::new_v4()
        ));
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
        assert_eq!(calls[0].get("name").and_then(|v| v.as_str()), Some("search_sdk"));
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
        assert_eq!(
            build_upstream_endpoint("https://api.example.com", ""),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_upstream_endpoint("https://api.example.com/v1", ""),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_upstream_endpoint("https://api.example.com/", "/custom/path"),
            "https://api.example.com/custom/path"
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
        assert!(
            jobs.items[0]
                .last_error
                .as_deref()
                .unwrap_or("")
                .contains("content is empty")
        );
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
        let local_chat_tasks =
            RwLock::new(HashMap::<String, tokio::task::AbortHandle>::new());
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

        let canceled =
            abort_local_chat_task_by_request_id(&local_chat_tasks, "req-cancel-1").await;
        assert!(canceled);
        assert!(local_chat_tasks.read().await.is_empty());

        match task.await {
            Err(err) => assert!(err.is_cancelled()),
            Ok(_) => panic!("task should be canceled"),
        }
    }

    #[tokio::test]
    async fn abort_local_chat_task_by_request_id_returns_false_when_missing() {
        let local_chat_tasks =
            RwLock::new(HashMap::<String, tokio::task::AbortHandle>::new());
        let canceled =
            abort_local_chat_task_by_request_id(&local_chat_tasks, "req-missing").await;
        assert!(!canceled);
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
