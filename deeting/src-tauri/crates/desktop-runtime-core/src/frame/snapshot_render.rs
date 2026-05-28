use crate::frame::{CommittedAction, Observation, SequenceNumber, UserDirective, WorldModelFrame};

#[derive(Debug, Clone)]
pub struct SnapshotRenderConfig {
    pub max_visible_per_side: usize,
    pub recent_seen_window: usize,
    pub max_text_len_per_entry: usize,
    pub total_snapshot_budget_chars: usize,
}

impl Default for SnapshotRenderConfig {
    fn default() -> Self {
        Self {
            max_visible_per_side: 15,
            recent_seen_window: 5,
            max_text_len_per_entry: 200,
            total_snapshot_budget_chars: 4000,
        }
    }
}

pub fn render_world_model_snapshot(
    frame: &WorldModelFrame,
    config: &SnapshotRenderConfig,
) -> String {
    let directives = render_user_directives(frame, config);
    let observations = render_observations(frame, config);
    let committed = render_committed_actions(frame, config);
    let declared = render_model_declared(frame);

    let mut compaction_notes = Vec::new();
    let obs_total = frame.world_observed.len();
    let obs_rendered = count_rendered_lines(&observations);
    if obs_total > obs_rendered {
        compaction_notes.push(format!(
            "[compaction] world_observed: {obs_total} entries → {obs_rendered} shown"
        ));
    }
    let commit_total = frame.agent_committed.len();
    let commit_rendered = count_rendered_lines(&committed);
    if commit_total > commit_rendered {
        compaction_notes.push(format!(
            "[compaction] agent_committed: {commit_total} entries → {commit_rendered} shown"
        ));
    }

    let compaction_header = if compaction_notes.is_empty() {
        String::new()
    } else {
        format!("{}\n\n", compaction_notes.join("\n"))
    };

    format!(
        "=== World Model Snapshot (turn {turn}) ===\n\n\
         {compaction_header}\
         [USER DIRECTIVES]\n{directives}\n\n\
         [WORLD OBSERVATIONS]\n{observations}\n\n\
         [AGENT COMMITTED ACTIONS]\n{committed}\n\n\
         [MODEL DECLARED]\n{declared}\n\n\
         === End World Model Snapshot ===",
        turn = frame.model_turn_count.saturating_add(1),
    )
}

// --- Layer 1: Structural compression (lossless) ---

fn supersede_chain_heads(directives: &[UserDirective]) -> Vec<&UserDirective> {
    let superseded_ids: std::collections::HashSet<&str> = directives
        .iter()
        .filter_map(|d| d.supersedes.as_deref())
        .collect();
    directives
        .iter()
        .filter(|d| !superseded_ids.contains(d.id.as_str()))
        .collect()
}

fn supersede_chain_label(directive: &UserDirective, all: &[UserDirective]) -> Option<String> {
    if directive.supersedes.is_none() {
        return None;
    }
    let mut chain = vec![directive.id.as_str()];
    let mut current = directive;
    while let Some(parent_id) = current.supersedes.as_deref() {
        chain.push(parent_id);
        match all.iter().find(|d| d.id == parent_id) {
            Some(parent) => current = parent,
            None => break,
        }
    }
    chain.reverse();
    Some(format!("(chain: {})", chain.join("→")))
}

fn observation_entity_key(observation: &Observation) -> Option<String> {
    let structured = observation.structured.as_ref()?;
    let path = structured.get("path").and_then(|v| v.as_str())?;
    Some(format!("{}::{}", observation.source.tool_name, path))
}

struct GroupedObservation<'a> {
    latest: &'a Observation,
    count: usize,
}

fn group_observations_by_entity(observations: &[Observation]) -> Vec<GroupedObservation<'_>> {
    let mut groups: Vec<GroupedObservation<'_>> = Vec::new();
    let mut entity_index: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();

    for obs in observations {
        if let Some(key) = observation_entity_key(obs) {
            if let Some(&idx) = entity_index.get(&key) {
                groups[idx].latest = obs;
                groups[idx].count += 1;
            } else {
                let idx = groups.len();
                entity_index.insert(key, idx);
                groups.push(GroupedObservation {
                    latest: obs,
                    count: 1,
                });
            }
        } else {
            groups.push(GroupedObservation {
                latest: obs,
                count: 1,
            });
        }
    }
    groups
}

struct CommittedGroup<'a> {
    tool_name: String,
    actions: Vec<&'a CommittedAction>,
    first_seq: SequenceNumber,
    last_seq: SequenceNumber,
}

fn group_consecutive_commits(commits: &[CommittedAction]) -> Vec<CommittedGroup<'_>> {
    let mut groups: Vec<CommittedGroup<'_>> = Vec::new();
    for action in commits {
        if let Some(last) = groups.last_mut() {
            if last.tool_name == action.tool_name {
                last.actions.push(action);
                last.last_seq = action.committed_at;
                continue;
            }
        }
        groups.push(CommittedGroup {
            tool_name: action.tool_name.clone(),
            actions: vec![action],
            first_seq: action.committed_at,
            last_seq: action.committed_at,
        });
    }
    groups
}

// --- Layer 2: Window compression (lossy, deterministic) ---

fn render_user_directives(frame: &WorldModelFrame, config: &SnapshotRenderConfig) -> String {
    if frame.user_directed.is_empty() {
        return "- (no directives yet)".to_string();
    }
    let heads = supersede_chain_heads(&frame.user_directed);
    let mut lines: Vec<String> = Vec::new();
    for directive in &heads {
        let marker = new_marker(directive.appended_at, frame.last_seen_by_model);
        let chain = supersede_chain_label(directive, &frame.user_directed)
            .map(|c| format!(" {c}"))
            .unwrap_or_default();
        let text = truncate_text(&directive.text, config.max_text_len_per_entry);
        lines.push(format!("- {marker}{text}{chain}"));
    }
    let omitted = frame.user_directed.len().saturating_sub(heads.len());
    if omitted > 0 {
        lines.push(format!("  ({omitted} superseded directive(s) collapsed)"));
    }
    lines.join("\n")
}

fn render_observations(frame: &WorldModelFrame, config: &SnapshotRenderConfig) -> String {
    if frame.world_observed.is_empty() {
        return "- (no observations yet)".to_string();
    }
    let grouped = group_observations_by_entity(&frame.world_observed);
    let highwater = frame.last_seen_by_model;

    let mut new_items: Vec<String> = Vec::new();
    let mut seen_items: Vec<String> = Vec::new();

    for group in &grouped {
        let obs = group.latest;
        let is_new = obs.appended_at > highwater;
        let marker = if is_new { "[NEW] " } else { "" };
        let count_suffix = if group.count > 1 {
            format!(" (latest of {}, seq={})", group.count, obs.appended_at)
        } else {
            format!(" (seq={})", obs.appended_at)
        };
        let text = truncate_text(&obs.text, config.max_text_len_per_entry);
        let line = format!("- {marker}{text}{count_suffix}");

        if is_new {
            new_items.push(line);
        } else {
            seen_items.push(line);
        }
    }

    let max_new = 10;
    let max_recent = config.recent_seen_window;
    let mut lines: Vec<String> = Vec::new();

    if new_items.len() > max_new {
        let omitted = new_items.len() - max_new;
        lines.extend(new_items.into_iter().take(max_new));
        lines.push(format!("  ({omitted} more new observation(s) omitted)"));
    } else {
        lines.extend(new_items);
    }

    if seen_items.len() > max_recent {
        let omitted = seen_items.len() - max_recent;
        let recent: Vec<String> = seen_items
            .into_iter()
            .rev()
            .take(max_recent)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        lines.extend(recent);
        lines.push(format!("  ({omitted} earlier observation(s) omitted)"));
    } else {
        lines.extend(seen_items);
    }

    lines.join("\n")
}

fn render_committed_actions(frame: &WorldModelFrame, config: &SnapshotRenderConfig) -> String {
    if frame.agent_committed.is_empty() {
        return "- (no committed actions yet)".to_string();
    }
    let groups = group_consecutive_commits(&frame.agent_committed);
    let highwater = frame.last_seen_by_model;

    let mut new_lines: Vec<String> = Vec::new();
    let mut old_lines: Vec<String> = Vec::new();

    for group in &groups {
        let is_new = group.last_seq > highwater;
        let marker = if is_new { "[NEW] " } else { "" };

        if group.actions.len() == 1 {
            let action = group.actions[0];
            let text = truncate_text(&action.action_text, config.max_text_len_per_entry);
            let line = format!("- {marker}{text} (seq={})", action.committed_at);
            if is_new {
                new_lines.push(line);
            } else {
                old_lines.push(line);
            }
        } else {
            let args: Vec<&str> = group
                .actions
                .iter()
                .map(|a| {
                    a.action_text
                        .find('(')
                        .and_then(|start| {
                            a.action_text
                                .find(')')
                                .map(|end| &a.action_text[start + 1..end])
                        })
                        .unwrap_or(&a.action_text)
                })
                .collect();
            let summary = if args.len() <= 4 {
                format!("[{}]", args.join(", "))
            } else {
                format!("[{}, ... +{}]", args[..3].join(", "), args.len() - 3)
            };
            let line = format!(
                "- {marker}{} × {} → {summary} (seq={}-{})",
                group.tool_name,
                group.actions.len(),
                group.first_seq,
                group.last_seq
            );
            if is_new {
                new_lines.push(line);
            } else {
                old_lines.push(line);
            }
        }
    }

    let mut lines = new_lines;
    let max_old = 3;
    if old_lines.len() > max_old {
        let omitted = old_lines.len() - max_old;
        lines.extend(
            old_lines
                .into_iter()
                .rev()
                .take(max_old)
                .collect::<Vec<_>>()
                .into_iter()
                .rev(),
        );
        lines.push(format!("  ({omitted} earlier committed group(s) omitted)"));
    } else {
        lines.extend(old_lines);
    }

    lines.join("\n")
}

fn render_model_declared(frame: &WorldModelFrame) -> String {
    let mut lines = Vec::new();
    lines.extend(
        frame
            .known_facts
            .iter()
            .map(|f| format!("- fact: {}", f.statement.trim())),
    );
    lines.extend(
        frame
            .assumptions
            .iter()
            .map(|a| format!("- assumption: {}", a.statement.trim())),
    );
    lines.extend(
        frame
            .verification_targets
            .iter()
            .map(|t| format!("- verification_target: {}", t.description.trim())),
    );
    lines.extend(
        frame
            .adaptation_rules
            .iter()
            .map(|r| format!("- rule: {}", r.instruction.trim())),
    );
    if lines.is_empty() {
        "- (no model declarations yet)".to_string()
    } else {
        lines.join("\n")
    }
}

// --- Helpers ---

fn new_marker(sequence: SequenceNumber, highwater: SequenceNumber) -> &'static str {
    if sequence > highwater {
        "[NEW] "
    } else {
        ""
    }
}

fn truncate_text(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_len {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(max_len.saturating_sub(1)).collect();
        format!("{truncated}…")
    }
}

fn count_rendered_lines(rendered: &str) -> usize {
    rendered.lines().filter(|l| l.starts_with("- ")).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{ExecutionStrategy, FrameProvenance, ObservationSource};

    fn test_frame() -> WorldModelFrame {
        WorldModelFrame::new(
            "frame-snapshot-test",
            "session-1",
            "task-1",
            "test goal",
            ExecutionStrategy::Hybrid,
            FrameProvenance::bootstrap("test"),
        )
    }

    #[test]
    fn empty_frame_renders_placeholders() {
        let frame = test_frame();
        let config = SnapshotRenderConfig::default();
        let output = render_world_model_snapshot(&frame, &config);
        assert!(output.contains("(no directives yet)"));
        assert!(output.contains("(no observations yet)"));
        assert!(output.contains("(no committed actions yet)"));
        assert!(output.contains("(no model declarations yet)"));
        assert!(!output.contains("[compaction]"));
    }

    #[test]
    fn supersede_chain_collapses_to_head() {
        let mut frame = test_frame();
        frame.append_user_directive("do X", None).unwrap();
        let first_id = frame.user_directed[0].id.clone();
        frame
            .append_user_directive("change to Y", Some(first_id.clone()))
            .unwrap();
        let second_id = frame.user_directed[1].id.clone();
        frame
            .append_user_directive("back to X", Some(second_id.clone()))
            .unwrap();

        let config = SnapshotRenderConfig::default();
        let output = render_user_directives(&frame, &config);
        let item_lines: Vec<&str> = output.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(item_lines.len(), 1);
        assert!(item_lines[0].contains("back to X"));
        assert!(item_lines[0].contains("chain:"));
        assert!(output.contains("2 superseded"));
    }

    #[test]
    fn observation_entity_grouping_shows_latest() {
        let mut frame = test_frame();
        for i in 0..4 {
            frame
                .append_observation(
                    format!("read config.toml v{i}"),
                    Some(serde_json::json!({"path": "/etc/config.toml", "size": 100 + i})),
                    ObservationSource {
                        tool_call_id: format!("c-{i}"),
                        tool_name: "read_file".to_string(),
                    },
                    None,
                )
                .unwrap();
        }

        let config = SnapshotRenderConfig::default();
        let output = render_observations(&frame, &config);
        let item_lines: Vec<&str> = output.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(item_lines.len(), 1);
        assert!(item_lines[0].contains("v3"));
        assert!(item_lines[0].contains("latest of 4"));
    }

    #[test]
    fn consecutive_commits_merge_display() {
        let mut frame = test_frame();
        frame.append_committed_action("fs.write(a.toml) -> ok", "c1", "fs.write");
        frame.append_committed_action("fs.write(b.toml) -> ok", "c2", "fs.write");
        frame.append_committed_action("fs.write(c.toml) -> ok", "c3", "fs.write");

        let config = SnapshotRenderConfig::default();
        let output = render_committed_actions(&frame, &config);
        let item_lines: Vec<&str> = output.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(item_lines.len(), 1);
        assert!(item_lines[0].contains("fs.write × 3"));
        assert!(item_lines[0].contains("a.toml"));
    }

    #[test]
    fn layer2_window_limits_old_observations() {
        let mut frame = test_frame();
        for i in 0..12 {
            frame
                .append_observation(
                    format!("obs-{i}"),
                    None,
                    ObservationSource {
                        tool_call_id: format!("c-{i}"),
                        tool_name: format!("tool_{i}"),
                    },
                    None,
                )
                .unwrap();
        }
        frame.mark_seen();
        frame
            .append_observation(
                "obs-new".to_string(),
                None,
                ObservationSource {
                    tool_call_id: "c-new".to_string(),
                    tool_name: "tool_new".to_string(),
                },
                None,
            )
            .unwrap();

        let config = SnapshotRenderConfig::default();
        let output = render_observations(&frame, &config);
        assert!(output.contains("[NEW] obs-new"));
        assert!(output.contains("earlier observation(s) omitted"));
    }

    #[test]
    fn compaction_header_appears_when_entries_omitted() {
        let mut frame = test_frame();
        for i in 0..12 {
            frame
                .append_observation(
                    format!("obs-{i}"),
                    None,
                    ObservationSource {
                        tool_call_id: format!("c-{i}"),
                        tool_name: format!("tool_{i}"),
                    },
                    None,
                )
                .unwrap();
        }
        frame.mark_seen();

        let config = SnapshotRenderConfig::default();
        let output = render_world_model_snapshot(&frame, &config);
        assert!(output.contains("[compaction] world_observed:"));
    }

    #[test]
    fn text_truncation_works() {
        let long = "a".repeat(300);
        let result = truncate_text(&long, 200);
        assert_eq!(result.chars().count(), 200);
        assert!(result.ends_with('…'));
    }
}
