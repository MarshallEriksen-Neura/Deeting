pub(super) fn workflow_recovery_notice_text(
    workflow_run_id: &str,
    detail: &crate::modules::workflow::types::WorkflowRunDetail,
) -> String {
    match detail.run.status {
        crate::modules::workflow::types::WorkflowRunStatus::Completed => {
            crate::modules::workflow::service::extract_primary_content(detail).unwrap_or_else(
                || {
                    format!(
                        "The delegated workflow `{}` completed and its result has been restored to the conversation.",
                        workflow_run_id
                    )
                },
            )
        }
        crate::modules::workflow::types::WorkflowRunStatus::WaitingApproval => {
            format!(
                "The delegated workflow `{}` is waiting for approval and its state has been restored.",
                workflow_run_id
            )
        }
        crate::modules::workflow::types::WorkflowRunStatus::Running => {
            format!(
                "The delegated workflow `{}` was still running before the app was interrupted. The system did not auto-replay it, so confirm the state before retrying or abandoning.",
                workflow_run_id
            )
        }
        _ => format!(
            "The delegated workflow `{}` is currently in status `{}`.",
            workflow_run_id,
            detail.run.status.as_str()
        ),
    }
}
