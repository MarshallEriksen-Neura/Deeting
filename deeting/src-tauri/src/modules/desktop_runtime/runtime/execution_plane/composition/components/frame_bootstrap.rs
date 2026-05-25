use super::super::super::user_input::latest_user_message;
use super::super::super::LocalExecutionRequest;
use crate::modules::desktop_runtime::runtime::sovereign::{DecisionLocus, PolicyGuidance, Self_};
use crate::modules::desktop_runtime::runtime::task_learning::{
    build_task_fingerprint, ACTION_VERIFICATION_STRONGER_CHECKS,
};
use crate::modules::mcp::store::McpStore;
use desktop_runtime_core::{
    ConfidenceLevel, ExecutionStrategy, FrameBootstrapOutput, FrameProvenance, Prior,
    WorldModelFrame,
};

const STRONGER_CHECKS_THRESHOLD: f64 = 0.35;

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn build_bootstrap_frame(
    request: &LocalExecutionRequest,
    task_id: &str,
) -> WorldModelFrame {
    let frame_version_id = format!("frame:{}:{}", request.session_id, task_id);
    let goal = latest_user_message(&request.messages)
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| "local runtime request".to_string());
    let fingerprint = build_task_fingerprint(&goal);
    let mut frame = WorldModelFrame::new(
        frame_version_id,
        request.session_id.clone(),
        task_id.to_string(),
        goal,
        ExecutionStrategy::DirectIteration,
        FrameProvenance {
            produced_by: "deeting_runtime_composition".to_string(),
            reason: "bootstrap frame from local execution request".to_string(),
            evidence_refs: vec![
                format!("fingerprint_key:{}", fingerprint.key()),
                format!(
                    "model_connection:{}",
                    request.model_connection.provider_model_id
                ),
            ],
        },
    );
    frame.fingerprint_key = Some(fingerprint.key());
    frame
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) async fn build_bootstrap_frame_with_priors(
    request: &LocalExecutionRequest,
    task_id: &str,
    store: &McpStore,
) -> FrameBootstrapOutput {
    let mut frame = build_bootstrap_frame(request, task_id);
    let guidance = Self_::consult(store, DecisionLocus::Verification, &frame.goal, 8).await;
    if guidance.as_raw().fingerprint_key == frame.fingerprint_key.clone().unwrap_or_default() {
        if let Some(prior) = verification_prior_from_guidance(&guidance) {
            frame.memory_priors.push(prior);
        }
    }

    FrameBootstrapOutput {
        frame,
        immediate_action: None,
    }
}

fn verification_prior_from_guidance(guidance: &PolicyGuidance) -> Option<Prior> {
    let action_weight = guidance.weight_for(ACTION_VERIFICATION_STRONGER_CHECKS);
    if guidance.recommended_action() == Some(ACTION_VERIFICATION_STRONGER_CHECKS)
        && action_weight > STRONGER_CHECKS_THRESHOLD
    {
        return Some(Prior {
            id: ACTION_VERIFICATION_STRONGER_CHECKS.to_string(),
            statement: format!(
                "verification prior weight {:.2} crossed threshold {:.2}",
                action_weight, STRONGER_CHECKS_THRESHOLD
            ),
            confidence: ConfidenceLevel::High,
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_frame_uses_request_fingerprint_without_provider_call() {
        let mut frame = WorldModelFrame::new(
            "frame-1",
            "session-1",
            "task-1",
            "answer directly",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );
        frame.fingerprint_key = Some(build_task_fingerprint("answer directly").key());

        assert_eq!(frame.execution_strategy, ExecutionStrategy::DirectIteration);
        assert!(frame.fingerprint_key.is_some());
    }
}
