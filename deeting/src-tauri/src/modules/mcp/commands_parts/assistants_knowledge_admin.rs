pub(crate) async fn index_mcp_tools(app_state: &AppState, tools: &[McpTool]) {
    for tool in tools {
        let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    tool.id.clone(),
                    tool.name.clone(),
                    tool.description.clone(),
                    "tool".to_string(),
                    "mcp".to_string(),
                    tool.identifier.clone(),
                    vector,
                    None,
                )
                .await;
        }
    }
}

#[tauri::command]
pub async fn sync_cloud_subscriptions_v2(
    _app: AppHandle,
    state: State<'_, AppState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    sync_cloud_subscriptions_inner(&state.mcp, access_token).await
}

async fn sync_cloud_subscriptions_inner(
    state: &McpRuntimeState,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/mcp/subscriptions",
        base_url.trim_end_matches('/')
    );
    let response = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!(
            "failed to sync subscriptions: {}",
            response.status()
        ));
    }

    let subscriptions: Vec<CloudSubscriptionItem> = response.json().await.map_err(to_string)?;
    let mut synced_tools = Vec::new();

    for sub in subscriptions {
        let source_url = sub
            .tool
            .source_url
            .clone()
            .unwrap_or_else(|| base_url.clone());
        let cloud_source = state
            .store
            .ensure_cloud_source(&source_url)
            .await
            .map_err(to_string)?;

        let tool = sub.tool;
        let upsert = ToolUpsert {
            id: None,
            source_id: cloud_source.id.clone(),
            identifier: Some(tool.identifier.clone()),
            name: tool.name.clone(),
            source_type: McpSourceType::Cloud,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: tool.capabilities.clone(),
            description: tool.description.clone(),
            error: None,
            command: None,
            args: None,
            env: None,
            config_json: tool.config_json.clone(),
            config_hash: tool.config_hash.clone(),
            pending_config_json: None,
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
        };

        if let Ok(synced) = state.store.upsert_tool(upsert).await {
            synced_tools.push(synced);
        }
    }

    Ok(synced_tools)
}

#[tauri::command]
pub async fn list_local_knowledge_files(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_user_documents(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_knowledge_folders(
    state: State<'_, AppState>,
) -> Result<Vec<LocalKnowledgeFolder>, String> {
    let state = &state.mcp;
    let tree = state
        .store
        .get_local_knowledge_tree(LocalKnowledgeTreeQuery {
            parent_id: None,
            q: None,
            sort_field: None,
            sort_direction: None,
        })
        .await
        .map_err(to_string)?;
    Ok(tree.folders)
}

#[tauri::command]
pub async fn get_local_knowledge_tree(
    state: State<'_, AppState>,
    query: LocalKnowledgeTreeQuery,
) -> Result<LocalKnowledgeTreeResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_knowledge_tree(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_knowledge_folder(
    state: State<'_, AppState>,
    payload: CreateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_knowledge_folder(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_knowledge_folder(&id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .delete_local_knowledge_folder(&id, recursive.unwrap_or(false))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_user_document(
    state: State<'_, AppState>,
    payload: CreateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    let requires_model_check = payload
        .status
        .as_ref()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized.is_empty()
                || normalized == "processing"
                || normalized == "pending"
                || normalized == "running"
        })
        .unwrap_or(true);

    if requires_model_check {
        crate::modules::providers::model_guard::ensure_required_local_models_configured(
            state.inner(),
        )
        .await?;
    }

    let state = &state.mcp;
    state
        .store
        .create_local_user_document(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_knowledge_stats(
    state: State<'_, AppState>,
) -> Result<LocalKnowledgeStatsResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_knowledge_stats()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_trace_feedback(
    state: State<'_, AppState>,
    payload: LocalTraceFeedbackRequest,
) -> Result<LocalTraceFeedback, String> {
    let state = &state.mcp;
    state
        .store
        .create_local_trace_feedback(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_assistant_routing_report(
    state: State<'_, AppState>,
    query: LocalAssistantRoutingReportQuery,
) -> Result<LocalAssistantRoutingReportResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant_routing_report(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn record_local_assistant_routing_feedback(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRoutingFeedbackRequest,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .record_local_assistant_routing_feedback(&assistant_id, payload)
        .await
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
pub async fn get_local_assistant_preview(
    state: State<'_, AppState>,
    assistant_id: String,
    _payload: LocalAssistantPreviewRequest,
) -> Result<LocalAssistant, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())
}

#[tauri::command]
pub async fn record_local_assistant_rating(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    let state = &state.mcp;
    state
        .store
        .rate_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installations(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_assistant_installs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .install_local_assistant(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    let state = &state.mcp;
    state
        .store
        .update_local_assistant_install(&assistant_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_assistant_installation(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .uninstall_local_assistant(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversations(
    state: State<'_, AppState>,
    query: LocalAdminConversationQuery,
) -> Result<LocalAdminConversationListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversations(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_messages(
    state: State<'_, AppState>,
    session_id: String,
    query: LocalAdminConversationMessageQuery,
) -> Result<LocalAdminConversationMessageListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_messages(&session_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_admin_conversation_summaries(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationSummaryListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_admin_conversation_summaries(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_conversation_summary_queue_stats(
    state: State<'_, AppState>,
) -> Result<LocalConversationSummaryQueueStats, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_conversation_summary_queue_stats()
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    query: LocalConversationSummaryJobQuery,
) -> Result<LocalConversationSummaryJobListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversation_summary_jobs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversation_summary_idle_tasks(
    state: State<'_, AppState>,
    query: LocalConversationSummaryIdleTaskQuery,
) -> Result<LocalConversationSummaryIdleTaskListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_conversation_summary_idle_tasks(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn enqueue_local_conversation_summary(
    state: State<'_, AppState>,
    session_id: String,
    _assistant_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    let state = &state.mcp;
    state
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_batch(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    let state = &state.mcp;
    state
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_gateway_logs(
    state: State<'_, AppState>,
    query: LocalGatewayLogQuery,
) -> Result<LocalGatewayLogListResponse, String> {
    let state = &state.mcp;
    state
        .store
        .list_local_gateway_logs(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_gateway_log(
    state: State<'_, AppState>,
    payload: LocalGatewayLogItem,
) -> Result<(), String> {
    let state = &state.mcp;
    state
        .store
        .create_local_gateway_log(
            payload.trace_id.as_deref(),
            &payload.model,
            payload.status_code,
            payload.duration_ms,
            payload.ttft_ms,
            None,
            0,
            payload.input_tokens,
            payload.output_tokens,
            payload.input_tokens.saturating_add(payload.output_tokens),
            payload.cost_user,
            payload.cost_user,
            payload.is_cached,
            payload.error_code.as_deref(),
            None,
        )
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_gateway_log_stats(
    state: State<'_, AppState>,
) -> Result<LocalGatewayLogStatsResponse, String> {
    let state = &state.mcp;
    state
        .store
        .get_local_gateway_log_stats(LocalGatewayLogQuery {
            skip: None,
            limit: None,
            model: None,
            status_code: None,
            is_cached: None,
        })
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn sync_official_skills_index(app_state: State<'_, AppState>) -> Result<usize, String> {
    let state = &app_state.mcp;
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!(
        "{}/api/v1/plugin-market/?limit=100",
        base_url.trim_end_matches('/')
    );

    let response = state.client.get(&url).send().await.map_err(to_string)?;
    if !response.status().is_success() {
        return Err("failed to fetch marketplace index".to_string());
    }

    let skills: Vec<serde_json::Value> = response.json().await.map_err(to_string)?;
    let count = skills.len();

    for skill in skills {
        let id = skill["id"].as_str().unwrap_or("").to_string();
        let name = skill["name"].as_str().unwrap_or("").to_string();
        let desc = skill["description"].as_str().unwrap_or("").to_string();

        let app_state_clone = app_state.inner().clone();
        tauri::async_runtime::spawn(async move {
            let text = format!("name: {}\ndescription: {}", name, desc);
            if let Ok(vector) = app_state_clone.providers.embedding.embed_text(&text).await {
                let _ = app_state_clone
                    .memory
                    .store
                    .upsert_asset(
                        id,
                        name,
                        desc,
                        "skill".to_string(),
                        "cloud_mirror".to_string(),
                        None,
                        vector,
                        Some(skill),
                    )
                    .await;
            }
        });
    }

    Ok(count)
}

#[tauri::command]
pub async fn set_cloud_base_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("cloud base url is required".to_string());
    }
    *state.mcp.cloud_base_url.write().await = normalized;
    Ok(())
}

#[tauri::command]
pub async fn get_desktop_config(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state
        .mcp
        .store
        .get_desktop_config(key.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn set_desktop_config(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("config key is required".to_string());
    }
    state
        .mcp
        .store
        .set_desktop_config(&key, value.trim())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_versions(
    state: State<'_, AppState>,
    assistant_id: Option<String>,
) -> Result<Vec<LocalAssistantVersion>, String> {
    state
        .mcp
        .store
        .list_local_assistant_versions(assistant_id.as_deref())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_assistant_installs(
    state: State<'_, AppState>,
    query: LocalAssistantInstallQuery,
) -> Result<LocalAssistantInstallPage, String> {
    list_local_assistant_installations(state, query).await
}

#[tauri::command]
pub async fn install_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallCreateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    create_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn update_local_assistant_install(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantInstallUpdateRequest,
) -> Result<LocalAssistantInstallItem, String> {
    update_local_assistant_installation(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn uninstall_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    delete_local_assistant_installation(state, assistant_id).await
}

#[tauri::command]
pub async fn rate_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantRatingRequest,
) -> Result<LocalAssistantRatingResponse, String> {
    record_local_assistant_rating(state, assistant_id, payload).await
}

#[tauri::command]
pub async fn record_local_assistant_routing_trial(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<LocalAssistantRoutingState, String> {
    state
        .mcp
        .store
        .record_local_assistant_routing_trial(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_user_documents(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    state
        .mcp
        .store
        .list_local_user_documents(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .get_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
    payload: UpdateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .update_local_user_document(&file_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    crate::modules::providers::model_guard::ensure_required_local_models_configured(state.inner())
        .await?;

    state
        .mcp
        .store
        .retry_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_user_document_chunks(
    state: State<'_, AppState>,
    file_id: String,
    query: LocalUserDocumentChunkListQuery,
) -> Result<LocalKnowledgeChunkListResponse, String> {
    state
        .mcp
        .store
        .list_local_user_document_chunks(&file_id, query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_admin_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalAdminConversationItem, String> {
    state
        .mcp
        .store
        .get_local_admin_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn trigger_local_conversation_summary_job(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .trigger_local_conversation_summary_job(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<LocalConversationSummaryEnqueueResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_job(&job_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn retry_local_conversation_summary_jobs(
    state: State<'_, AppState>,
    payload: LocalConversationSummaryBatchRetryRequest,
) -> Result<LocalConversationSummaryBatchRetryResponse, String> {
    state
        .mcp
        .store
        .retry_local_conversation_summary_jobs(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn append_assistant_message(
    state: State<'_, AppState>,
    payload: CreateAssistantMessageRequest,
) -> Result<LocalAssistantMessage, String> {
    create_assistant_message(state, payload).await
}

#[tauri::command]
pub async fn preview_local_assistant(
    state: State<'_, AppState>,
    assistant_id: String,
    payload: LocalAssistantPreviewRequest,
) -> Result<serde_json::Value, String> {
    let assistant = state
        .mcp
        .store
        .get_local_assistant(&assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "assistant not found".to_string())?;

    let model_from_config = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "default".to_string());
    let provider_model_id = assistant
        .model_config
        .as_ref()
        .and_then(|value| value.get("provider_model_id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let model_connection = resolve_local_model_connection(
        state.inner(),
        &model_from_config,
        provider_model_id.as_deref(),
    )
    .await?;

    let messages = vec![
        LocalChatInputMessage {
            role: "system".to_string(),
            content: assistant.system_prompt,
        },
        LocalChatInputMessage {
            role: "user".to_string(),
            content: payload.message,
        },
    ];
    let response = request_provider_chat_completion(
        state.inner(),
        &model_connection.provider_model_id,
        &model_connection.model_id,
        messages,
        None,
        payload.temperature,
        payload.max_tokens,
        None,
        None,
    )
    .await?;
    let content = response
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Ok(serde_json::json!({ "content": content }))
}

#[tauri::command]
pub async fn delete_assistant_messages(
    state: State<'_, AppState>,
    assistant_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_assistant_messages(&assistant_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_conversations(
    state: State<'_, AppState>,
    query: LocalConversationSessionsQuery,
) -> Result<LocalConversationSessionPage, String> {
    list_local_conversation_sessions(state, query).await
}

#[tauri::command]
pub async fn create_local_conversation(
    state: State<'_, AppState>,
    payload: LocalConversationCreateRequest,
) -> Result<LocalConversationCreateResponse, String> {
    create_local_conversation_session(state, payload).await
}

#[tauri::command]
pub async fn archive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    archive_local_conversation_session(state, session_id).await
}

#[tauri::command]
pub async fn close_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Closed)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn unarchive_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationArchiveResponse, String> {
    state
        .mcp
        .store
        .update_local_conversation_status(&session_id, LocalConversationStatus::Active)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rename_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
    payload: LocalConversationRenameRequest,
) -> Result<LocalConversationRenameResponse, String> {
    rename_local_conversation_session(state, session_id, payload).await
}

#[tauri::command]
pub async fn append_local_conversation_message(
    state: State<'_, AppState>,
    payload: CreateConversationMessageRequest,
) -> Result<LocalConversationHistoryMessage, String> {
    state
        .mcp
        .store
        .append_local_conversation_message(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_conversation_message(
    state: State<'_, AppState>,
    session_id: String,
    turn_index: i64,
) -> Result<LocalConversationDeleteResponse, String> {
    state
        .mcp
        .store
        .delete_local_conversation_message(&session_id, turn_index)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn clear_local_conversation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<LocalConversationClearResponse, String> {
    state
        .mcp
        .store
        .clear_local_conversation(&session_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn approve_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    call_id: Option<String>,
    #[allow(non_snake_case)] callId: Option<String>,
    execution_token: Option<String>,
    #[allow(non_snake_case)] executionToken: Option<String>,
) -> Result<Value, String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    let approval_context = state.mcp.build_approval_context(
        call_id.or(callId).as_deref(),
        execution_token.or(executionToken).as_deref(),
    );

    approve_mcp_tool_inner_with_context(
        &approval_context,
        Some(&state.mcp),
        state.mcp.store.as_ref(),
        state.mcp.pending_tool_calls.as_ref(),
        &token,
    )
    .await
}

#[tauri::command]
pub async fn reject_mcp_tool(
    state: State<'_, AppState>,
    approval_token: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
) -> Result<(), String> {
    let token = approval_token
        .or(approvalToken)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "approval token is required".to_string())?;
    reject_mcp_tool_inner(state.mcp.pending_tool_calls.as_ref(), &token).await;
    Ok(())
}
