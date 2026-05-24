use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_workflow_delegated_execution_session, DelegatedExecutionSession,
};
use crate::modules::desktop_runtime::runtime::DelegatedExecutionSelection;

pub(super) fn build_workflow_delegated_execution_session_for_resume(
    execution_graph_execution_id: String,
    detail: crate::modules::workflow::types::WorkflowRunDetail,
) -> DelegatedExecutionSession {
    let content = crate::modules::workflow::service::extract_primary_content(&detail);
    let succeeded =
        detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Completed;

    build_workflow_delegated_execution_session(
        execution_graph_execution_id,
        CustomTaskAgentProfile {
            id: "workflow".to_string(),
            name: "Workflow".to_string(),
            description: None,
            task_prompt: "delegated workflow wake resume".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: Vec::new(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: false,
            is_enabled: true,
            is_deleted: false,
            source_kind: Some("delegated_workflow_runtime".to_string()),
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "1970-01-01T00:00:00Z".to_string(),
            updated_at: "1970-01-01T00:00:00Z".to_string(),
        },
        DelegatedExecutionSelection {
            explicit: false,
            score: None,
            reason_codes: Vec::new(),
            reason_text: Some("delegated workflow wake resume".to_string()),
            candidate_count: 0,
            selected_from_top_k: 0,
            callable_coverage_score: None,
            modality_fit_score: None,
            profile_prior_score: None,
        },
        None,
        "workflow".to_string(),
        Ok(crate::modules::workflow::types::QuickWorkflowResult {
            run: detail.run,
            steps: detail.steps,
            content,
            succeeded,
        }),
    )
}
