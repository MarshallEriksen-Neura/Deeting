use std::collections::HashMap;
use std::path::Path;

use crate::modules::workflow::run_dir;
use crate::modules::workflow::types::{
    FollowupHints, ResultJson, ResultOutputs, ResultPacket, WorkerExecutionResult,
};

const MAX_SUMMARY_CHARS: usize = usize::MAX;

pub fn build_result_summary(content: &str) -> String {
    if content.chars().count() <= MAX_SUMMARY_CHARS {
        return content.to_string();
    }

    let truncated = content
        .char_indices()
        .nth(MAX_SUMMARY_CHARS)
        .map(|(index, _)| &content[..index])
        .unwrap_or(content);
    format!("{truncated}\n\n[... truncated, see full result.md]")
}

pub fn build_result_packet(
    run_id: &str,
    phase_id: &str,
    worker_ref: &str,
    execution_result: &WorkerExecutionResult,
) -> ResultPacket {
    let summary = build_result_summary(&execution_result.content);
    let result_json = ResultJson {
        run_id: run_id.to_string(),
        phase_id: phase_id.to_string(),
        worker_ref: worker_ref.to_string(),
        status: execution_result.status.clone(),
        summary: summary.clone(),
        outputs: ResultOutputs {
            primary_artifact_ref: if execution_result.content.is_empty() {
                None
            } else {
                Some(format!("{phase_id}/result.md"))
            },
            named_outputs: HashMap::new(),
        },
        followup_hints: FollowupHints {
            recommended_next_action: if execution_result.status == "succeeded" {
                "continue".to_string()
            } else {
                "pause_for_edit".to_string()
            },
            invalidates_future_phases: Vec::new(),
        },
    };

    ResultPacket {
        run_id: run_id.to_string(),
        phase_id: phase_id.to_string(),
        worker_ref: worker_ref.to_string(),
        status: execution_result.status.clone(),
        summary,
        result_json,
    }
}

pub fn persist_result_packet(
    phase_dir: &Path,
    result_packet: &ResultPacket,
    full_content: &str,
) -> Result<(), String> {
    run_dir::write_result_md(phase_dir, full_content)?;
    run_dir::write_result_json(phase_dir, &result_packet.result_json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::WorkerExecutionResult;

    #[test]
    fn build_result_packet_succeeded_sets_continue() {
        let execution_result = WorkerExecutionResult {
            status: "succeeded".to_string(),
            content: "Found 3 competitors with feature comparison".to_string(),
            model_id: "gpt-4o".to_string(),
            provider_model_id: "uuid-123".to_string(),
            tool_trace: vec![],
            images: vec![],
            error: None,
        };

        let packet =
            build_result_packet("run-1", "phase-1", "direct_llm:default", &execution_result);
        assert_eq!(packet.status, "succeeded");
        assert_eq!(
            packet.result_json.followup_hints.recommended_next_action,
            "continue"
        );
        assert!(packet.result_json.outputs.primary_artifact_ref.is_some());
    }

    #[test]
    fn build_result_packet_failed_sets_pause_for_edit() {
        let execution_result = WorkerExecutionResult {
            status: "failed".to_string(),
            content: String::new(),
            model_id: "gpt-4o".to_string(),
            provider_model_id: "uuid-123".to_string(),
            tool_trace: vec![],
            images: vec![],
            error: Some("timeout".to_string()),
        };

        let packet =
            build_result_packet("run-1", "phase-1", "direct_llm:default", &execution_result);
        assert_eq!(packet.status, "failed");
        assert_eq!(
            packet.result_json.followup_hints.recommended_next_action,
            "pause_for_edit"
        );
    }

    #[test]
    fn result_summary_is_truncated() {
        let long_content = "x".repeat(5000);
        let summary = build_result_summary(&long_content);
        assert!(summary.len() < 2100);
        assert!(summary.contains("[... truncated"));
    }

    #[test]
    fn persist_result_packet_writes_files() {
        let temp_dir = std::env::temp_dir().join(format!("result-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let execution_result = WorkerExecutionResult {
            status: "succeeded".to_string(),
            content: "Full detailed result text".to_string(),
            model_id: "gpt-4o".to_string(),
            provider_model_id: "uuid".to_string(),
            tool_trace: vec![],
            images: vec![],
            error: None,
        };
        let packet =
            build_result_packet("run-1", "phase-1", "direct_llm:default", &execution_result);
        persist_result_packet(&temp_dir, &packet, &execution_result.content)
            .expect("persist result packet");

        assert!(temp_dir.join("result.md").exists());
        assert!(temp_dir.join("result.json").exists());
        let md = std::fs::read_to_string(temp_dir.join("result.md")).expect("read result.md");
        assert_eq!(md, "Full detailed result text");

        std::fs::remove_dir_all(temp_dir).ok();
    }
}
