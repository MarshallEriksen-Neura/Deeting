use std::time::Duration;

use crate::modules::conversations::summary_format::build_local_summary_from_window;
use crate::modules::conversations::summary_generation::{
    generate_local_conversation_summary_with_secretary_model,
    LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
};
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::McpRuntimeState;
use crate::state::AppState;

pub(crate) async fn start_local_conversation_summary_worker(app_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&app_state).await {
            log::warn!("conversation summary worker error: {}", err);
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
            log::warn!("periodic worker dispatch idle task error: {}", err);
        }
        if let Err(err) = state
            .store
            .cleanup_old_local_conversation_summary_jobs(7 * 24 * 60 * 60)
            .await
        {
            log::warn!("periodic worker cleanup old jobs error: {}", err);
        }
        match state
            .store
            .cleanup_expired_local_conversations_from_retention_config()
            .await
        {
            Ok(deleted) if deleted > 0 => {
                log::info!(
                    "periodic worker cleaned up {} expired local conversation sessions",
                    deleted
                );
            }
            Ok(_) => {}
            Err(err) => {
                log::warn!(
                    "periodic worker cleanup expired conversations error: {}",
                    err
                );
            }
        }
    }
}

async fn process_next_local_conversation_summary_job(app_state: &AppState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(Some(app_state), app_state.mcp.store.as_ref())
        .await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn process_next_local_conversation_summary_job_with_store(
    store: &McpStore,
) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(None, store).await
}

async fn process_next_local_conversation_summary_job_inner(
    app_state: Option<&AppState>,
    store: &McpStore,
) -> Result<(), McpError> {
    let Some(job) = store
        .claim_next_local_conversation_summary_job()
        .await
        .map_err(|err| {
            McpError::Storage(format!("summary worker step=claim_next_job err={}", err))
        })?
    else {
        return Ok(());
    };
    let job_context = format!("job_id={} session_id={}", job.id, job.session_id);
    let processing = async {
        let window = store
            .load_local_conversation_runtime_window(&job.session_id)
            .await
            .map_err(|err| {
                McpError::Storage(format!(
                    "summary worker step=load_runtime_window {} err={}",
                    job_context, err
                ))
            })?;
        let model_summary = if let Some(app_state) = app_state {
            match generate_local_conversation_summary_with_secretary_model(
                app_state,
                &window.messages,
                Some(job.session_id.as_str()),
            )
            .await
            {
                Ok(Some((summary, summarizer_model))) if !summary.trim().is_empty() => {
                    Some((summary, summarizer_model))
                }
                Ok(_) => None,
                Err(err) => {
                    log::warn!(
                        "local conversation secretary summary failed {} err={}",
                        job_context,
                        err
                    );
                    None
                }
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
            return Err(McpError::validation(format!(
                "summary worker step=build_summary {} err=conversation summary content is empty",
                job_context
            )));
        }
        store
            .persist_local_conversation_summary(
                &job.session_id,
                &summary,
                Some(summarizer_model.as_str()),
            )
            .await
            .map_err(|err| {
                McpError::Storage(format!(
                    "summary worker step=persist_summary {} err={}",
                    job_context, err
                ))
            })?;
        Ok::<(), McpError>(())
    }
    .await;

    match processing {
        Ok(()) => store
            .complete_local_conversation_summary_job(&job.id)
            .await
            .map_err(|err| {
                McpError::Storage(format!(
                    "summary worker step=complete_job {} err={}",
                    job_context, err
                ))
            }),
        Err(err) => {
            let message = err.to_string();
            if let Err(fail_err) = store
                .fail_local_conversation_summary_job(&job, &message, 30)
                .await
            {
                log::warn!(
                    "summary worker step=mark_failed {} err={}",
                    job_context,
                    fail_err
                );
            }
            Err(err)
        }
    }
}
