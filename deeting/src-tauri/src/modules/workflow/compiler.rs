use std::collections::HashSet;

use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::types::{
    CompileResult, CompiledPhase, CompilerError, ExecutionSnapshot, ExpectedOutput, ParsedProposal,
    ProposalPhase, SnapshotPolicy,
};

fn push_error(
    errors: &mut Vec<CompilerError>,
    phase_id: Option<String>,
    field: impl Into<String>,
    message: impl Into<String>,
) {
    errors.push(CompilerError {
        phase_id,
        field: field.into(),
        message: message.into(),
    });
}

pub fn parse_proposal(text: &str) -> Result<ParsedProposal, Vec<CompilerError>> {
    let mut parsed = ParsedProposal::default();
    let mut errors = Vec::<CompilerError>::new();
    let mut current_phase: Option<ProposalPhase> = None;
    let mut in_constraints = false;
    let mut capture_user_notes = false;

    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();

        if trimmed.starts_with("# ") || trimmed.is_empty() {
            if capture_user_notes {
                if let Some(phase) = current_phase.as_mut() {
                    let existing = phase.user_notes.take().unwrap_or_default();
                    let next = if existing.is_empty() {
                        trimmed.to_string()
                    } else {
                        format!("{existing}\n{trimmed}")
                    };
                    phase.user_notes = Some(next.trim().to_string());
                }
            }
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("Title:") {
            parsed.title = Some(value.trim().to_string()).filter(|value| !value.is_empty());
            in_constraints = false;
            capture_user_notes = false;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("Goal:") {
            if current_phase.is_none() {
                parsed.goal = Some(value.trim().to_string()).filter(|value| !value.is_empty());
            } else if let Some(phase) = current_phase.as_mut() {
                phase.goal = Some(value.trim().to_string()).filter(|value| !value.is_empty());
            }
            continue;
        }

        if trimmed == "## Global Constraints" {
            in_constraints = true;
            capture_user_notes = false;
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("## Phase ") {
            if let Some(phase) = current_phase.take() {
                parsed.phases.push(phase);
            }
            in_constraints = false;
            capture_user_notes = false;

            let Some((number_part, title_part)) = rest.split_once(':') else {
                push_error(
                    &mut errors,
                    None,
                    "phase",
                    format!("Malformed phase header: {trimmed}"),
                );
                continue;
            };
            let phase_number = number_part.trim();
            let title = title_part.trim();
            if phase_number.is_empty() || title.is_empty() {
                push_error(
                    &mut errors,
                    None,
                    "phase",
                    format!("Malformed phase header: {trimmed}"),
                );
                continue;
            }
            current_phase = Some(ProposalPhase {
                phase_id: format!("phase-{phase_number}"),
                title: title.to_string(),
                worker_ref: None,
                goal: None,
                expected_output: None,
                depends_on: Vec::new(),
                user_notes: None,
            });
            continue;
        }

        if in_constraints && trimmed.starts_with("- ") {
            parsed
                .global_constraints
                .push(trimmed.trim_start_matches("- ").trim().to_string());
            continue;
        }

        let Some(phase) = current_phase.as_mut() else {
            continue;
        };

        if let Some(value) = trimmed.strip_prefix("- Worker:") {
            phase.worker_ref = Some(value.trim().to_string()).filter(|value| !value.is_empty());
            capture_user_notes = false;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Goal:") {
            phase.goal = Some(value.trim().to_string()).filter(|value| !value.is_empty());
            capture_user_notes = false;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Expected output:") {
            phase.expected_output =
                Some(value.trim().to_string()).filter(|value| !value.is_empty());
            capture_user_notes = false;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Depends on:") {
            let mut depends_on = Vec::new();
            for entry in value.split(',') {
                let normalized = entry.trim();
                if normalized.is_empty() {
                    continue;
                }
                if let Some(number) = normalized.strip_prefix("Phase ") {
                    depends_on.push(format!("phase-{}", number.trim()));
                } else {
                    push_error(
                        &mut errors,
                        Some(phase.phase_id.clone()),
                        "depends_on",
                        format!("Malformed dependency reference: {normalized}"),
                    );
                }
            }
            phase.depends_on = depends_on;
            capture_user_notes = false;
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- User Notes:") {
            let note = value.trim();
            phase.user_notes = if note.is_empty() {
                None
            } else {
                Some(note.to_string())
            };
            capture_user_notes = true;
            continue;
        }

        if capture_user_notes {
            let existing = phase.user_notes.take().unwrap_or_default();
            let next = if existing.is_empty() {
                trimmed.to_string()
            } else {
                format!("{existing}\n{trimmed}")
            };
            phase.user_notes = Some(next.trim().to_string());
        }
    }

    if let Some(phase) = current_phase.take() {
        parsed.phases.push(phase);
    }

    if parsed.phases.is_empty() {
        push_error(
            &mut errors,
            None,
            "phases",
            "No executable phases found in proposal",
        );
    }

    if errors.is_empty() {
        Ok(parsed)
    } else {
        Err(errors)
    }
}

pub fn compile_proposal(
    run_id: &str,
    parsed: &ParsedProposal,
    proposal_version: i64,
    snapshot_version: i64,
    available_worker_refs: &[String],
) -> CompileResult {
    let mut errors = Vec::<CompilerError>::new();
    let mut compiled_phases = Vec::<CompiledPhase>::new();
    let available_refs: HashSet<&str> = available_worker_refs.iter().map(String::as_str).collect();

    for phase in &parsed.phases {
        let worker_ref = phase
            .worker_ref
            .clone()
            .unwrap_or_else(|| "direct_llm:default".to_string());

        if !worker_ref.starts_with("direct_llm:") && !available_refs.contains(worker_ref.as_str()) {
            push_error(
                &mut errors,
                Some(phase.phase_id.clone()),
                "worker_ref",
                format!("Unknown worker reference: {worker_ref}"),
            );
        }

        for dependency in &phase.depends_on {
            if !parsed
                .phases
                .iter()
                .any(|candidate| candidate.phase_id == *dependency)
            {
                push_error(
                    &mut errors,
                    Some(phase.phase_id.clone()),
                    "depends_on",
                    format!("Dependency not found: {dependency}"),
                );
            }
        }

        compiled_phases.push(CompiledPhase {
            phase_id: phase.phase_id.clone(),
            title: phase.title.clone(),
            worker_ref,
            depends_on: phase.depends_on.clone(),
            goal: phase.goal.clone().unwrap_or_else(|| phase.title.clone()),
            expected_output: phase.expected_output.as_ref().map(|value| ExpectedOutput {
                result_kind: "text_summary".to_string(),
                result_schema_hint: Some(value.clone()),
            }),
        });
    }

    for (index, phase) in compiled_phases.iter().enumerate() {
        for dependency in &phase.depends_on {
            if let Some(dep_index) = compiled_phases
                .iter()
                .position(|candidate| candidate.phase_id == *dependency)
            {
                if dep_index >= index {
                    push_error(
                        &mut errors,
                        Some(phase.phase_id.clone()),
                        "depends_on",
                        format!(
                            "Forward dependency not allowed: {} depends on {}",
                            phase.phase_id, dependency
                        ),
                    );
                }
            }
        }
    }

    if !errors.is_empty() {
        return CompileResult {
            snapshot: None,
            errors,
        };
    }

    let compiled_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();

    CompileResult {
        snapshot: Some(ExecutionSnapshot {
            run_id: run_id.to_string(),
            proposal_version,
            snapshot_version,
            compiled_at,
            goal: parsed.goal.clone().unwrap_or_default(),
            phases: compiled_phases,
            policy: SnapshotPolicy::default(),
        }),
        errors: Vec::new(),
    }
}

pub(crate) async fn collect_available_worker_refs(store: &McpStore) -> Result<Vec<String>, String> {
    let agents = store
        .list_custom_task_agents()
        .await
        .map_err(|err| err.to_string())?;

    Ok(agents
        .into_iter()
        .filter(|agent| agent.is_enabled && !agent.is_deleted)
        .map(|agent| format!("user_worker_profile:{}", agent.id))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::workflow::types::{ParsedProposal, ProposalPhase};

    #[test]
    fn parse_valid_proposal_extracts_phases_and_notes() {
        let text = r#"# Workflow Proposal

Title: Test Workflow
Goal: Do something useful

## Global Constraints
- Language: Chinese

## Phase 1: Research
- Worker: direct_llm:default
- Goal: Find relevant information
- Expected output: research_notes
- User Notes:

## Phase 2: Analysis
- Worker: user_worker_profile:analyst
- Goal: Analyze the findings
- Expected output: analysis_report
- Depends on: Phase 1
- User Notes: Focus on pricing
"#;

        let parsed = parse_proposal(text).expect("parse proposal");
        assert_eq!(parsed.phases.len(), 2);
        assert_eq!(parsed.phases[0].phase_id, "phase-1");
        assert_eq!(parsed.phases[0].title, "Research");
        assert_eq!(parsed.phases[1].depends_on, vec!["phase-1"]);
        assert_eq!(
            parsed.phases[1].user_notes.as_deref(),
            Some("Focus on pricing")
        );
    }

    #[test]
    fn parse_empty_proposal_fails() {
        let result = parse_proposal("Some random text without phases");
        assert!(result.is_err());
    }

    #[test]
    fn compile_valid_proposal_produces_snapshot() {
        let parsed = ParsedProposal {
            title: Some("Test".to_string()),
            goal: Some("Test goal".to_string()),
            global_constraints: vec![],
            phases: vec![ProposalPhase {
                phase_id: "phase-1".to_string(),
                title: "Step 1".to_string(),
                worker_ref: Some("direct_llm:default".to_string()),
                goal: Some("Do thing".to_string()),
                expected_output: None,
                depends_on: vec![],
                user_notes: None,
            }],
        };

        let result = compile_proposal("run-1", &parsed, 1, 1, &[]);
        assert!(result.snapshot.is_some());
        assert!(result.errors.is_empty());
    }

    #[test]
    fn compile_rejects_unknown_worker_ref() {
        let parsed = ParsedProposal {
            title: None,
            goal: Some("Test".to_string()),
            global_constraints: vec![],
            phases: vec![ProposalPhase {
                phase_id: "phase-1".to_string(),
                title: "Step".to_string(),
                worker_ref: Some("user_worker_profile:nonexistent".to_string()),
                goal: None,
                expected_output: None,
                depends_on: vec![],
                user_notes: None,
            }],
        };

        let result = compile_proposal("run-1", &parsed, 1, 1, &[]);
        assert!(result.snapshot.is_none());
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0]
            .message
            .contains("Unknown worker reference"));
    }

    #[test]
    fn compile_rejects_forward_dependency() {
        let parsed = ParsedProposal {
            title: None,
            goal: Some("Test".to_string()),
            global_constraints: vec![],
            phases: vec![
                ProposalPhase {
                    phase_id: "phase-1".to_string(),
                    title: "First".to_string(),
                    worker_ref: Some("direct_llm:default".to_string()),
                    goal: None,
                    expected_output: None,
                    depends_on: vec!["phase-2".to_string()],
                    user_notes: None,
                },
                ProposalPhase {
                    phase_id: "phase-2".to_string(),
                    title: "Second".to_string(),
                    worker_ref: Some("direct_llm:default".to_string()),
                    goal: None,
                    expected_output: None,
                    depends_on: vec![],
                    user_notes: None,
                },
            ],
        };

        let result = compile_proposal("run-1", &parsed, 1, 1, &[]);
        assert!(result.snapshot.is_none());
        assert!(result
            .errors
            .iter()
            .any(|error| error.message.contains("Forward dependency")));
    }
}
