use super::super::support::*;
use super::{
    apply_config_payload, build_local_summary_from_window,
    generate_local_conversation_summary_with_model, read_local_mcp_config,
    LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
};

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json = read_local_mcp_config(&path)?;
            let config: McpConfigPayload = serde_json::from_str(&config_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
        McpSourceType::Skill => {
            return Err(McpError::validation(
                "skill-backed sources are managed internally and cannot be synced directly",
            ));
        }
        McpSourceType::Cloud
        | McpSourceType::Modelscope
        | McpSourceType::Github
        | McpSourceType::Url => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "failed to fetch cloud config: {}",
                    response.status()
                )));
            }
            let config: McpConfigPayload = response
                .json()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
    };
    Ok(tools)
}

pub(crate) async fn start_local_conversation_summary_worker(app_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&app_state).await {
            warn!("conversation summary worker error: {}", err);
        }
    }
}

pub(crate) async fn start_local_periodic_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = state
            .store
            .dispatch_due_local_conversation_summary_idle_tasks()
            .await
        {
            warn!("periodic worker dispatch idle task error: {}", err);
        }
        if let Err(err) = state
            .store
            .cleanup_old_local_conversation_summary_jobs(7 * 24 * 60 * 60)
            .await
        {
            warn!("periodic worker cleanup old jobs error: {}", err);
        }
    }
}

async fn process_next_local_conversation_summary_job(app_state: &AppState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(Some(app_state), app_state.mcp.store.as_ref())
        .await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn process_next_local_conversation_summary_job_with_store(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(None, store).await
}

async fn process_next_local_conversation_summary_job_inner(
    app_state: Option<&AppState>,
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    let Some(job) = store.claim_next_local_conversation_summary_job().await? else {
        return Ok(());
    };
    let processing = async {
        let window = store
            .load_local_conversation_runtime_window(&job.session_id)
            .await?;
        let model_summary = if let Some(app_state) = app_state {
            let meta = window.meta.as_ref();
            let model_id = meta
                .and_then(|v| v.get("last_model_id"))
                .and_then(|v| v.as_str())
                .map(|v| v.trim())
                .filter(|v| !v.is_empty());
            let provider_model_id = meta
                .and_then(|v| v.get("last_provider_model_id"))
                .and_then(|v| v.as_str())
                .map(|v| v.trim())
                .filter(|v| !v.is_empty());
            if let (Some(model_id), Some(provider_model_id)) = (model_id, provider_model_id) {
                match generate_local_conversation_summary_with_model(
                    app_state,
                    provider_model_id,
                    model_id,
                    &window.messages,
                    Some(job.session_id.as_str()),
                )
                .await
                {
                    Ok(Some(summary)) if !summary.trim().is_empty() => {
                        Some((summary, model_id.to_string()))
                    }
                    Ok(_) => None,
                    Err(err) => {
                        log::warn!(
                            "local conversation model summary failed session={} err={}",
                            job.session_id,
                            err
                        );
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };
        let (summary, summarizer_model) = model_summary.unwrap_or_else(|| {
            (
                build_local_summary_from_window(&window.messages),
                "local-worker".to_string(),
            )
        });
        if summary.trim().is_empty() {
            return Err(McpError::validation(
                "conversation summary content is empty",
            ));
        }
        store
            .persist_local_conversation_summary(
                &job.session_id,
                &summary,
                Some(summarizer_model.as_str()),
            )
            .await?;
        Ok::<(), McpError>(())
    }
    .await;

    match processing {
        Ok(()) => store.complete_local_conversation_summary_job(&job.id).await,
        Err(err) => {
            let message = err.to_string();
            let _ = store
                .fail_local_conversation_summary_job(&job, &message, 30)
                .await;
            Err(err)
        }
    }
}
