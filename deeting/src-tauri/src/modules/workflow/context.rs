use std::path::Path;

use crate::modules::workflow::run_dir;
use crate::modules::workflow::types::{
    CompiledPhase, ContextConstraints, ContextInputs, ContextJson, ContextPacket, ExecutionSnapshot,
};

pub fn build_context_md(
    phase: &CompiledPhase,
    original_goal: &str,
    upstream_summaries: &[(String, String)],
    artifact_refs: &[String],
) -> String {
    let mut sections = Vec::<String>::new();
    sections.push(format!("# {}: {}", phase.phase_id, phase.title));
    sections.push(format!("## Task Goal\n{}", phase.goal));

    if !upstream_summaries.is_empty() {
        let mut summary_section = String::from("## Upstream Results\n");
        for (phase_id, summary) in upstream_summaries {
            summary_section.push_str(&format!("### {phase_id}\n{summary}\n\n"));
        }
        sections.push(summary_section.trim_end().to_string());
    }

    sections.push(format!("## Original User Request\n{}", original_goal));

    let mut constraints = format!("## Constraints\n- Worker: {}", phase.worker_ref);
    if let Some(expected_output) = phase.expected_output.as_ref() {
        constraints.push_str(&format!(
            "\n- Expected output: {}",
            expected_output.result_kind
        ));
        if let Some(schema_hint) = expected_output.result_schema_hint.as_deref() {
            constraints.push_str(&format!(" ({schema_hint})"));
        }
    }
    sections.push(constraints);

    if !artifact_refs.is_empty() {
        let mut refs_section = String::from("## Artifact References\n");
        for artifact_ref in artifact_refs {
            refs_section.push_str(&format!("- {artifact_ref}\n"));
        }
        sections.push(refs_section.trim_end().to_string());
    }

    sections.push("## User Notes\n".to_string());

    sections.join("\n\n")
}

fn collect_upstream_summaries(
    phase: &CompiledPhase,
    run_dir_path: &Path,
) -> Result<Vec<(String, String)>, String> {
    let mut summaries = Vec::new();
    for dependency in &phase.depends_on {
        let phase_dir = run_dir_path.join("phases").join(dependency);
        if let Some(text) = run_dir::read_result_md(&phase_dir)? {
            summaries.push((dependency.clone(), text));
        }
    }
    Ok(summaries)
}

fn collect_upstream_artifact_refs(phase: &CompiledPhase, run_dir_path: &Path) -> Vec<String> {
    let mut refs = Vec::new();
    for dependency in &phase.depends_on {
        let phase_dir = run_dir_path.join("phases").join(dependency);
        if phase_dir.join("result.md").exists() {
            refs.push(format!("{dependency}/result.md"));
        }
        if phase_dir.join("result.json").exists() {
            refs.push(format!("{dependency}/result.json"));
        }
        let artifacts_dir = phase_dir.join("artifacts");
        if artifacts_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(artifacts_dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        refs.push(format!("{dependency}/artifacts/{name}"));
                    }
                }
            }
        }
    }
    refs
}

pub fn build_context_packet(
    snapshot: &ExecutionSnapshot,
    phase: &CompiledPhase,
    run_dir_path: &Path,
    original_goal: &str,
    _proposal_text: &str,
) -> Result<ContextPacket, String> {
    let upstream_summaries = collect_upstream_summaries(phase, run_dir_path)?;
    let artifact_refs = collect_upstream_artifact_refs(phase, run_dir_path);
    let context_md = build_context_md(phase, original_goal, &upstream_summaries, &artifact_refs);
    let context_json = ContextJson {
        run_id: snapshot.run_id.clone(),
        phase_id: phase.phase_id.clone(),
        phase_title: phase.title.clone(),
        proposal_version: snapshot.proposal_version,
        snapshot_version: snapshot.snapshot_version,
        worker_ref: phase.worker_ref.clone(),
        goal: phase.goal.clone(),
        constraints: ContextConstraints {
            timeout_ms: snapshot.policy.default_timeout_ms,
            allowed_tools: Vec::new(),
        },
        inputs: ContextInputs {
            artifact_refs,
            upstream_phase_ids: phase.depends_on.clone(),
        },
        expected_output: phase.expected_output.clone(),
    };

    Ok(ContextPacket {
        run_id: snapshot.run_id.clone(),
        phase_id: phase.phase_id.clone(),
        phase_title: phase.title.clone(),
        context_md,
        context_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::{
        CompiledPhase, ExecutionSnapshot, ExpectedOutput, SnapshotPolicy,
    };

    fn sample_snapshot() -> ExecutionSnapshot {
        ExecutionSnapshot {
            run_id: "run-1".to_string(),
            proposal_version: 1,
            snapshot_version: 1,
            compiled_at: "2026-03-23T12:00:00Z".to_string(),
            goal: "Test goal".to_string(),
            phases: vec![
                CompiledPhase {
                    phase_id: "phase-1".to_string(),
                    title: "Research".to_string(),
                    worker_ref: "direct_llm:default".to_string(),
                    depends_on: vec![],
                    goal: "Find stuff".to_string(),
                    expected_output: None,
                },
                CompiledPhase {
                    phase_id: "phase-2".to_string(),
                    title: "Analysis".to_string(),
                    worker_ref: "user_worker_profile:analyst".to_string(),
                    depends_on: vec!["phase-1".to_string()],
                    goal: "Analyze findings".to_string(),
                    expected_output: Some(ExpectedOutput {
                        result_kind: "json_structured".to_string(),
                        result_schema_hint: Some("analysis.v1".to_string()),
                    }),
                },
            ],
            policy: SnapshotPolicy::default(),
        }
    }

    #[test]
    fn build_context_md_for_first_phase_omits_upstream_results() {
        let snapshot = sample_snapshot();
        let phase = &snapshot.phases[0];
        let md = build_context_md(phase, "Test goal", &[], &[]);
        assert!(md.contains("# phase-1: Research"));
        assert!(md.contains("## Task Goal"));
        assert!(md.contains("Find stuff"));
        assert!(md.contains("## Original User Request"));
        assert!(!md.contains("## Upstream Results"));
    }

    #[test]
    fn build_context_md_includes_upstream_summaries_and_refs() {
        let snapshot = sample_snapshot();
        let phase = &snapshot.phases[1];
        let summaries = vec![(
            "phase-1".to_string(),
            "Found 3 interesting things".to_string(),
        )];
        let refs = vec!["phase-1/result.md".to_string()];
        let md = build_context_md(phase, "Test goal", &summaries, &refs);
        assert!(md.contains("## Upstream Results"));
        assert!(md.contains("Found 3 interesting things"));
        assert!(md.contains("## Artifact References"));
        assert!(md.contains("phase-1/result.md"));
    }

    #[test]
    fn build_context_packet_reads_upstream_phase_files() {
        let temp_root = std::env::temp_dir().join(format!("ctx-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(temp_root.join("phases").join("phase-1")).expect("create phase dir");
        std::fs::write(
            temp_root.join("phases").join("phase-1").join("result.md"),
            "Phase 1 found useful results",
        )
        .expect("write result.md");

        let snapshot = sample_snapshot();
        let phase = &snapshot.phases[1];
        let packet =
            build_context_packet(&snapshot, phase, &temp_root, "Test goal", "proposal text")
                .expect("build context packet");

        assert_eq!(packet.phase_id, "phase-2");
        assert!(packet.context_md.contains("Phase 1 found useful results"));
        assert_eq!(packet.context_json.worker_ref, "user_worker_profile:analyst");
        assert!(packet
            .context_json
            .inputs
            .upstream_phase_ids
            .contains(&"phase-1".to_string()));

        std::fs::remove_dir_all(temp_root).ok();
    }
}
