use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type BatchId = String;
pub type TaskId = String;
pub type ChildRunId = String;
pub type HostRunId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiAgentPlan {
    pub batch_id: BatchId,
    pub max_concurrent: usize,
    pub tasks: Vec<AgentTaskSpec>,
}

impl MultiAgentPlan {
    pub fn new(
        batch_id: impl Into<BatchId>,
        max_concurrent: usize,
        tasks: Vec<AgentTaskSpec>,
    ) -> Self {
        Self {
            batch_id: batch_id.into(),
            max_concurrent: max_concurrent.max(1),
            tasks,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentTaskSpec {
    pub task_id: TaskId,
    pub child_id: ChildRunId,
    pub task: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub write_scope: WriteScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum WriteScope {
    ReadOnly,
    WorkspaceWrite { paths: Vec<String> },
    GlobalState,
}

impl Default for WriteScope {
    fn default() -> Self {
        Self::ReadOnly
    }
}

impl WriteScope {
    fn is_read_only(&self) -> bool {
        matches!(self, Self::ReadOnly)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChildState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Blocked,
    LostAfterRestart,
}

impl ChildState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed
                | Self::Failed
                | Self::Cancelled
                | Self::Blocked
                | Self::LostAfterRestart
        )
    }

    pub fn is_success(self) -> bool {
        self == Self::Completed
    }

    pub fn is_failure(self) -> bool {
        matches!(
            self,
            Self::Failed | Self::Cancelled | Self::Blocked | Self::LostAfterRestart
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChildSnapshot {
    pub task_id: TaskId,
    pub child_id: ChildRunId,
    pub spec: AgentTaskSpec,
    pub state: ChildState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_run_id: Option<HostRunId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MultiAgentSnapshot {
    pub batch_id: BatchId,
    pub max_concurrent: usize,
    pub child_order: Vec<ChildRunId>,
    pub children: BTreeMap<ChildRunId, ChildSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum MultiAgentCommand {
    SpawnChild {
        child_id: ChildRunId,
        task_id: TaskId,
        spec: AgentTaskSpec,
    },
    CancelChild {
        child_id: ChildRunId,
    },
    EmitProgress(MultiAgentProgress),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiAgentProgress {
    pub batch_id: BatchId,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_id: Option<ChildRunId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<ChildState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum MultiAgentEvent {
    ChildStarted {
        child_id: ChildRunId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        host_run_id: Option<HostRunId>,
    },
    ChildCompleted {
        child_id: ChildRunId,
        result: Value,
    },
    ChildFailed {
        child_id: ChildRunId,
        error: String,
    },
    ChildCancelled {
        child_id: ChildRunId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    ChildLostAfterRestart {
        child_id: ChildRunId,
        reason: String,
    },
}

pub fn start(plan: MultiAgentPlan) -> (MultiAgentSnapshot, Vec<MultiAgentCommand>) {
    let child_order = plan
        .tasks
        .iter()
        .map(|task| task.child_id.clone())
        .collect::<Vec<_>>();
    let children = plan
        .tasks
        .into_iter()
        .map(|task| {
            (
                task.child_id.clone(),
                ChildSnapshot {
                    task_id: task.task_id.clone(),
                    child_id: task.child_id.clone(),
                    spec: task,
                    state: ChildState::Queued,
                    host_run_id: None,
                    result: None,
                    error: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut snapshot = MultiAgentSnapshot {
        batch_id: plan.batch_id,
        max_concurrent: plan.max_concurrent.max(1),
        child_order,
        children,
    };
    let mut commands = vec![MultiAgentCommand::EmitProgress(MultiAgentProgress {
        batch_id: snapshot.batch_id.clone(),
        kind: "batch_started".to_string(),
        child_id: None,
        state: None,
        message: None,
    })];
    commands.extend(schedule_queued(&mut snapshot));
    (snapshot, commands)
}

pub fn apply_event(
    mut snapshot: MultiAgentSnapshot,
    event: MultiAgentEvent,
) -> (MultiAgentSnapshot, Vec<MultiAgentCommand>) {
    let mut commands = Vec::new();
    let Some(child_id) = event_child_id(&event).cloned() else {
        return (snapshot, commands);
    };
    let Some(child) = snapshot.children.get_mut(&child_id) else {
        commands.push(MultiAgentCommand::EmitProgress(MultiAgentProgress {
            batch_id: snapshot.batch_id.clone(),
            kind: "unknown_child_event".to_string(),
            child_id: Some(child_id.clone()),
            state: None,
            message: None,
        }));
        return (snapshot, commands);
    };
    if child.state.is_terminal() {
        commands.push(MultiAgentCommand::EmitProgress(MultiAgentProgress {
            batch_id: snapshot.batch_id.clone(),
            kind: "late_child_event_ignored".to_string(),
            child_id: Some(child.child_id.clone()),
            state: Some(child.state),
            message: None,
        }));
        return (snapshot, commands);
    }

    match event {
        MultiAgentEvent::ChildStarted {
            child_id: _,
            host_run_id,
        } => {
            child.state = ChildState::Running;
            child.host_run_id = host_run_id;
        }
        MultiAgentEvent::ChildCompleted {
            child_id: _,
            result,
        } => {
            child.state = ChildState::Completed;
            child.result = Some(result);
            child.error = None;
        }
        MultiAgentEvent::ChildFailed { child_id: _, error } => {
            child.state = ChildState::Failed;
            child.error = Some(error);
        }
        MultiAgentEvent::ChildCancelled {
            child_id: _,
            reason,
        } => {
            child.state = ChildState::Cancelled;
            child.error = reason;
        }
        MultiAgentEvent::ChildLostAfterRestart {
            child_id: _,
            reason,
        } => {
            child.state = ChildState::LostAfterRestart;
            child.error = Some(reason);
        }
    }
    commands.push(MultiAgentCommand::EmitProgress(MultiAgentProgress {
        batch_id: snapshot.batch_id.clone(),
        kind: "child_state_changed".to_string(),
        child_id: Some(child_id.clone()),
        state: Some(child.state),
        message: child.error.clone(),
    }));
    commands.extend(schedule_queued(&mut snapshot));
    (snapshot, commands)
}

fn event_child_id(event: &MultiAgentEvent) -> Option<&ChildRunId> {
    match event {
        MultiAgentEvent::ChildStarted { child_id, .. }
        | MultiAgentEvent::ChildCompleted { child_id, .. }
        | MultiAgentEvent::ChildFailed { child_id, .. }
        | MultiAgentEvent::ChildCancelled { child_id, .. }
        | MultiAgentEvent::ChildLostAfterRestart { child_id, .. } => Some(child_id),
    }
}

fn schedule_queued(snapshot: &mut MultiAgentSnapshot) -> Vec<MultiAgentCommand> {
    let mut commands = Vec::new();
    let batch_id = snapshot.batch_id.clone();
    for child_id in snapshot.child_order.clone() {
        if running_count(snapshot) >= snapshot.max_concurrent {
            break;
        }
        let Some(candidate) = snapshot.children.get(&child_id) else {
            continue;
        };
        if candidate.state != ChildState::Queued {
            continue;
        }
        if !can_schedule(snapshot, &candidate.spec.write_scope) {
            continue;
        }
        let Some((scheduled_child_id, scheduled_task_id, scheduled_spec)) =
            snapshot.children.get_mut(&child_id).map(|candidate| {
                candidate.state = ChildState::Running;
                (
                    candidate.child_id.clone(),
                    candidate.task_id.clone(),
                    candidate.spec.clone(),
                )
            })
        else {
            continue;
        };
        commands.push(MultiAgentCommand::SpawnChild {
            child_id: scheduled_child_id.clone(),
            task_id: scheduled_task_id,
            spec: scheduled_spec,
        });
        commands.push(MultiAgentCommand::EmitProgress(MultiAgentProgress {
            batch_id: batch_id.clone(),
            kind: "child_started".to_string(),
            child_id: Some(scheduled_child_id),
            state: Some(ChildState::Running),
            message: None,
        }));
    }
    commands
}

fn running_count(snapshot: &MultiAgentSnapshot) -> usize {
    snapshot
        .children
        .values()
        .filter(|child| child.state == ChildState::Running)
        .count()
}

fn can_schedule(snapshot: &MultiAgentSnapshot, scope: &WriteScope) -> bool {
    let running_non_read_only = snapshot
        .children
        .values()
        .any(|child| child.state == ChildState::Running && !child.spec.write_scope.is_read_only());
    if scope.is_read_only() {
        !running_non_read_only
    } else {
        running_count(snapshot) == 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum JoinPolicy {
    AllTerminal,
    AllSuccess,
    AnySuccess,
    AnyTerminal,
    FirstFailure,
    Quorum { min_success: usize },
}

impl Default for JoinPolicy {
    fn default() -> Self {
        Self::AllTerminal
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinSelection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_ids: Option<Vec<ChildRunId>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinOutcome {
    pub policy: JoinPolicy,
    pub status: JoinStatus,
    pub success_count: usize,
    pub failure_count: usize,
    pub cancelled_count: usize,
    pub pending_count: usize,
    pub children: Vec<JoinChild>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JoinStatus {
    Succeeded,
    Failed,
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinChild {
    pub child_id: ChildRunId,
    pub task_id: TaskId,
    pub state: ChildState,
}

pub fn try_join(
    snapshot: &MultiAgentSnapshot,
    selection: &JoinSelection,
    policy: JoinPolicy,
) -> Option<JoinOutcome> {
    let children = selected_children(snapshot, selection);
    let success_count = children
        .iter()
        .filter(|child| child.state.is_success())
        .count();
    let failure_count = children
        .iter()
        .filter(|child| child.state == ChildState::Failed)
        .count();
    let cancelled_count = children
        .iter()
        .filter(|child| {
            matches!(
                child.state,
                ChildState::Cancelled | ChildState::Blocked | ChildState::LostAfterRestart
            )
        })
        .count();
    let terminal_count = children
        .iter()
        .filter(|child| child.state.is_terminal())
        .count();
    let pending_count = children.len().saturating_sub(terminal_count);
    let failure_total = failure_count + cancelled_count;

    let status = match policy {
        JoinPolicy::AllTerminal => {
            if pending_count > 0 {
                return None;
            }
            if failure_total == 0 {
                JoinStatus::Succeeded
            } else if success_count > 0 {
                JoinStatus::Partial
            } else {
                JoinStatus::Failed
            }
        }
        JoinPolicy::AllSuccess => {
            if failure_total > 0 {
                JoinStatus::Failed
            } else if pending_count == 0 {
                JoinStatus::Succeeded
            } else {
                return None;
            }
        }
        JoinPolicy::AnySuccess => {
            if success_count > 0 {
                JoinStatus::Succeeded
            } else if pending_count == 0 {
                JoinStatus::Failed
            } else {
                return None;
            }
        }
        JoinPolicy::AnyTerminal => {
            if terminal_count == 0 {
                return None;
            }
            if success_count > 0 && failure_total == 0 {
                JoinStatus::Succeeded
            } else if success_count > 0 {
                JoinStatus::Partial
            } else {
                JoinStatus::Failed
            }
        }
        JoinPolicy::FirstFailure => {
            if failure_total > 0 {
                JoinStatus::Failed
            } else if pending_count == 0 {
                JoinStatus::Succeeded
            } else {
                return None;
            }
        }
        JoinPolicy::Quorum { min_success } => {
            if success_count >= min_success {
                JoinStatus::Succeeded
            } else if success_count + pending_count < min_success {
                JoinStatus::Failed
            } else {
                return None;
            }
        }
    };

    Some(JoinOutcome {
        policy,
        status,
        success_count,
        failure_count,
        cancelled_count,
        pending_count,
        children,
    })
}

fn selected_children(snapshot: &MultiAgentSnapshot, selection: &JoinSelection) -> Vec<JoinChild> {
    snapshot
        .child_order
        .iter()
        .filter(|child_id| {
            selection
                .child_ids
                .as_ref()
                .map(|selected| selected.contains(child_id))
                .unwrap_or(true)
        })
        .filter_map(|child_id| snapshot.children.get(child_id))
        .map(|child| JoinChild {
            child_id: child.child_id.clone(),
            task_id: child.task_id.clone(),
            state: child.state,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn start_schedules_up_to_concurrency_limit_and_leaves_the_rest_queued() {
        let (snapshot, commands) = start(MultiAgentPlan::new(
            "batch-1",
            2,
            vec![
                task("task-1", "child-1"),
                task("task-2", "child-2"),
                task("task-3", "child-3"),
            ],
        ));

        assert_eq!(spawn_child_ids(&commands), vec!["child-1", "child-2"]);
        assert_eq!(snapshot.children["child-1"].state, ChildState::Running);
        assert_eq!(snapshot.children["child-2"].state, ChildState::Running);
        assert_eq!(snapshot.children["child-3"].state, ChildState::Queued);
    }

    #[test]
    fn completion_unlocks_the_next_queued_child_in_plan_order() {
        let (snapshot, _) = start(MultiAgentPlan::new(
            "batch-1",
            1,
            vec![task("task-1", "child-1"), task("task-2", "child-2")],
        ));
        let (snapshot, commands) = apply_event(
            snapshot,
            MultiAgentEvent::ChildCompleted {
                child_id: "child-1".to_string(),
                result: json!({"ok": true}),
            },
        );

        assert_eq!(snapshot.children["child-1"].state, ChildState::Completed);
        assert_eq!(snapshot.children["child-2"].state, ChildState::Running);
        assert_eq!(spawn_child_ids(&commands), vec!["child-2"]);
    }

    #[test]
    fn duplicate_or_late_terminal_event_is_ignored() {
        let (snapshot, _) = start(MultiAgentPlan::new(
            "batch-1",
            1,
            vec![task("task-1", "child-1")],
        ));
        let (snapshot, _) = apply_event(
            snapshot,
            MultiAgentEvent::ChildCancelled {
                child_id: "child-1".to_string(),
                reason: Some("stop".to_string()),
            },
        );
        let (snapshot, commands) = apply_event(
            snapshot,
            MultiAgentEvent::ChildCompleted {
                child_id: "child-1".to_string(),
                result: json!({"late": true}),
            },
        );

        assert_eq!(snapshot.children["child-1"].state, ChildState::Cancelled);
        assert!(matches!(
            commands.first(),
            Some(MultiAgentCommand::EmitProgress(progress))
                if progress.kind == "late_child_event_ignored"
        ));
    }

    #[test]
    fn join_all_terminal_waits_for_selected_subset_only() {
        let (snapshot, _) = start(MultiAgentPlan::new(
            "batch-1",
            2,
            vec![
                task("task-1", "child-1"),
                task("task-2", "child-2"),
                task("task-3", "child-3"),
            ],
        ));
        let (snapshot, _) = apply_event(
            snapshot,
            MultiAgentEvent::ChildCompleted {
                child_id: "child-1".to_string(),
                result: json!({}),
            },
        );

        let outcome = try_join(
            &snapshot,
            &JoinSelection {
                child_ids: Some(vec!["child-1".to_string()]),
            },
            JoinPolicy::AllTerminal,
        )
        .expect("selected child is terminal");
        assert_eq!(outcome.status, JoinStatus::Succeeded);

        assert!(try_join(
            &snapshot,
            &JoinSelection::default(),
            JoinPolicy::AllTerminal
        )
        .is_none());
    }

    #[test]
    fn write_scoped_children_are_serialized() {
        let (snapshot, commands) = start(MultiAgentPlan::new(
            "batch-1",
            3,
            vec![
                writable_task("task-1", "child-1"),
                task("task-2", "child-2"),
                writable_task("task-3", "child-3"),
            ],
        ));

        assert_eq!(spawn_child_ids(&commands), vec!["child-1"]);
        assert_eq!(snapshot.children["child-1"].state, ChildState::Running);
        assert_eq!(snapshot.children["child-2"].state, ChildState::Queued);
        assert_eq!(snapshot.children["child-3"].state, ChildState::Queued);
    }

    fn task(task_id: &str, child_id: &str) -> AgentTaskSpec {
        AgentTaskSpec {
            task_id: task_id.to_string(),
            child_id: child_id.to_string(),
            task: "inspect".to_string(),
            agent_id: None,
            agent_type: Some("explore".to_string()),
            write_scope: WriteScope::ReadOnly,
        }
    }

    fn writable_task(task_id: &str, child_id: &str) -> AgentTaskSpec {
        AgentTaskSpec {
            write_scope: WriteScope::WorkspaceWrite {
                paths: vec!["src".to_string()],
            },
            ..task(task_id, child_id)
        }
    }

    fn spawn_child_ids(commands: &[MultiAgentCommand]) -> Vec<&str> {
        commands
            .iter()
            .filter_map(|command| match command {
                MultiAgentCommand::SpawnChild { child_id, .. } => Some(child_id.as_str()),
                MultiAgentCommand::CancelChild { .. } | MultiAgentCommand::EmitProgress(_) => None,
            })
            .collect()
    }
}
