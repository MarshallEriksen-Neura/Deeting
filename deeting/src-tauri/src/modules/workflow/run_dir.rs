use std::path::{Path, PathBuf};

use crate::modules::workflow::types::{ContextJson, ExecutionSnapshot, ResultJson};

pub fn resolve_workflows_dir(app_data_dir: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = app_data_dir {
        return dir.join("workflows");
    }
    if let Some(home) = dirs::home_dir() {
        return home.join(".config").join("deeting").join("workflows");
    }
    PathBuf::from("workflows")
}

pub fn resolve_run_dir(app_data_dir: Option<PathBuf>, run_id: &str) -> PathBuf {
    resolve_workflows_dir(app_data_dir).join(run_id.trim())
}

pub fn resolve_phase_dir(app_data_dir: Option<PathBuf>, run_id: &str, phase_id: &str) -> PathBuf {
    resolve_run_dir(app_data_dir, run_id)
        .join("phases")
        .join(phase_id.trim())
}

fn validate_phase_id(phase_id: &str) -> Result<&str, String> {
    let normalized = phase_id.trim();
    if normalized.is_empty() {
        return Err("phase_id is required".to_string());
    }
    if normalized.contains('/') || normalized.contains('\\') || normalized.contains("..") {
        return Err("invalid phase_id: must not contain path separators".to_string());
    }
    Ok(normalized)
}

pub fn ensure_run_dir(app_data_dir: Option<PathBuf>, run_id: &str) -> Result<PathBuf, String> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("run_id is required to create workflow run directory".to_string());
    }
    let dir = resolve_run_dir(app_data_dir, run_id);
    std::fs::create_dir_all(&dir).map_err(|err| format!("Failed to create run dir: {err}"))?;
    Ok(dir)
}

pub fn ensure_phase_dir(run_dir: &Path, phase_id: &str) -> Result<PathBuf, String> {
    let phase_id = validate_phase_id(phase_id)?;
    let dir = run_dir.join("phases").join(phase_id);
    std::fs::create_dir_all(&dir).map_err(|err| format!("Failed to create phase dir: {err}"))?;
    Ok(dir)
}

pub fn ensure_artifacts_dir(phase_dir: &Path) -> Result<PathBuf, String> {
    let dir = phase_dir.join("artifacts");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create artifacts dir: {err}"))?;
    Ok(dir)
}

pub fn write_proposal_file(run_dir: &Path, proposal_text: &str) -> Result<(), String> {
    std::fs::write(run_dir.join("proposal.md"), proposal_text)
        .map_err(|err| format!("Failed to write proposal.md: {err}"))
}

pub fn read_proposal_file(run_dir: &Path) -> Result<Option<String>, String> {
    let path = run_dir.join("proposal.md");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|err| format!("Failed to read proposal.md: {err}"))
}

pub fn write_snapshot_file(run_dir: &Path, snapshot: &ExecutionSnapshot) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(snapshot)
        .map_err(|err| format!("Failed to serialize snapshot: {err}"))?;
    std::fs::write(run_dir.join("snapshot.json"), serialized)
        .map_err(|err| format!("Failed to write snapshot.json: {err}"))
}

pub fn write_context_md(phase_dir: &Path, content: &str) -> Result<(), String> {
    std::fs::write(phase_dir.join("context.md"), content)
        .map_err(|err| format!("Failed to write context.md: {err}"))
}

pub fn write_context_json(phase_dir: &Path, json: &ContextJson) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(json)
        .map_err(|err| format!("Failed to serialize context.json: {err}"))?;
    std::fs::write(phase_dir.join("context.json"), serialized)
        .map_err(|err| format!("Failed to write context.json: {err}"))
}

pub fn write_result_md(phase_dir: &Path, content: &str) -> Result<(), String> {
    std::fs::write(phase_dir.join("result.md"), content)
        .map_err(|err| format!("Failed to write result.md: {err}"))
}

pub fn write_result_json(phase_dir: &Path, json: &ResultJson) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(json)
        .map_err(|err| format!("Failed to serialize result.json: {err}"))?;
    std::fs::write(phase_dir.join("result.json"), serialized)
        .map_err(|err| format!("Failed to write result.json: {err}"))
}

pub fn read_snapshot_file(run_dir: &Path) -> Result<Option<String>, String> {
    let path = run_dir.join("snapshot.json");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|err| format!("Failed to read snapshot.json: {err}"))
}

pub fn read_result_md(phase_dir: &Path) -> Result<Option<String>, String> {
    let path = phase_dir.join("result.md");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|err| format!("Failed to read result.md: {err}"))
}

pub fn read_context_md(phase_dir: &Path) -> Result<Option<String>, String> {
    let path = phase_dir.join("context.md");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|err| format!("Failed to read context.md: {err}"))
}

pub fn read_context_json(phase_dir: &Path) -> Result<Option<ContextJson>, String> {
    let path = phase_dir.join("context.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read context.json: {err}"))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| format!("Failed to parse context.json: {err}"))
}

pub fn read_result_json(phase_dir: &Path) -> Result<Option<ResultJson>, String> {
    let path = phase_dir.join("result.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read result.json: {err}"))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| format!("Failed to parse result.json: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::{
        CompiledPhase, ExecutionSnapshot, ExpectedOutput, FollowupHints, ResultJson, ResultOutputs,
        SnapshotPolicy,
    };

    #[test]
    fn ensure_run_dir_creates_directory() {
        let temp_root =
            std::env::temp_dir().join(format!("deeting-workflow-run-dir-{}", uuid::Uuid::new_v4()));
        let dir = ensure_run_dir(Some(temp_root.clone()), "test-run-1").expect("ensure run dir");
        assert!(dir.exists());
        assert!(dir.is_dir());
        std::fs::remove_dir_all(temp_root).ok();
    }

    #[test]
    fn write_and_read_proposal_round_trip() {
        let temp_root = std::env::temp_dir().join(format!(
            "deeting-workflow-proposal-{}",
            uuid::Uuid::new_v4()
        ));
        let dir = ensure_run_dir(Some(temp_root.clone()), "test-run-2").expect("ensure run dir");
        write_proposal_file(&dir, "# Test Proposal").expect("write proposal");
        let content = read_proposal_file(&dir).expect("read proposal");
        assert_eq!(content.as_deref(), Some("# Test Proposal"));
        std::fs::remove_dir_all(temp_root).ok();
    }

    #[test]
    fn write_snapshot_file_persists_pretty_json() {
        let temp_root = std::env::temp_dir().join(format!(
            "deeting-workflow-snapshot-{}",
            uuid::Uuid::new_v4()
        ));
        let dir = ensure_run_dir(Some(temp_root.clone()), "test-run-3").expect("ensure run dir");
        let snapshot = ExecutionSnapshot {
            run_id: "run-1".to_string(),
            proposal_version: 1,
            snapshot_version: 1,
            compiled_at: "2026-03-23T12:00:00Z".to_string(),
            goal: "Goal".to_string(),
            phases: vec![CompiledPhase {
                phase_id: "phase-1".to_string(),
                title: "Phase".to_string(),
                worker_ref: "direct_llm:default".to_string(),
                depends_on: vec![],
                goal: "Do a thing".to_string(),
                expected_output: Some(ExpectedOutput {
                    result_kind: "text_summary".to_string(),
                    result_schema_hint: Some("notes".to_string()),
                }),
            }],
            policy: SnapshotPolicy::default(),
        };

        write_snapshot_file(&dir, &snapshot).expect("write snapshot");
        let written = std::fs::read_to_string(dir.join("snapshot.json")).expect("read snapshot");
        assert!(written.contains("\"run_id\": \"run-1\""));
        assert!(written.contains("\"snapshot_version\": 1"));
        std::fs::remove_dir_all(temp_root).ok();
    }

    #[test]
    fn ensure_phase_dir_rejects_path_traversal() {
        let temp_root = std::env::temp_dir().join(format!(
            "deeting-workflow-phase-dir-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_root).expect("create temp root");
        let error = ensure_phase_dir(&temp_root, "../phase-1").expect_err("invalid phase id");
        assert!(error.contains("invalid phase_id"));
        std::fs::remove_dir_all(temp_root).ok();
    }

    #[test]
    fn write_and_read_result_json_round_trip() {
        let temp_root = std::env::temp_dir().join(format!(
            "deeting-workflow-result-json-{}",
            uuid::Uuid::new_v4()
        ));
        let phase_dir = ensure_phase_dir(&temp_root, "phase-1").expect("ensure phase dir");
        let json = ResultJson {
            run_id: "run-1".to_string(),
            phase_id: "phase-1".to_string(),
            worker_ref: "direct_llm:default".to_string(),
            status: "succeeded".to_string(),
            summary: "summary".to_string(),
            outputs: ResultOutputs {
                primary_artifact_ref: Some("phase-1/result.md".to_string()),
                named_outputs: std::collections::HashMap::new(),
            },
            followup_hints: FollowupHints {
                recommended_next_action: "continue".to_string(),
                invalidates_future_phases: vec![],
            },
        };
        write_result_json(&phase_dir, &json).expect("write result json");
        let round_trip = read_result_json(&phase_dir)
            .expect("read result json")
            .expect("result json exists");
        assert_eq!(round_trip.summary, "summary");
        std::fs::remove_dir_all(temp_root).ok();
    }
}
