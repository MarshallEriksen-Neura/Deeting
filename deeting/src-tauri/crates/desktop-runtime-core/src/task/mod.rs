use crate::frame::WorldModelFrame;
use crate::hook::HookEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserInput {
    pub session_id: String,
    pub task_id: String,
    pub content: String,
    pub source: TaskInputSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskInputSource {
    UserChat,
    CronMonitor {
        task_id: String,
        schedule_id: String,
        cron_expr: String,
        objective: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        next_run_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        monitor_frame_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        execution_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        execution_frame_id: Option<String>,
        checkpoint_policy: MonitorCheckpointPolicy,
        capability_lease: CapabilityLease,
    },
    DelegatedAgent {
        parent_task_id: String,
        parent_frame_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        child_run_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        child_frame_id: Option<String>,
        agent_id: String,
        invocation_kind: DelegatedInvocationKind,
        delegated_goal: String,
        capability_lease: CapabilityLease,
        return_channel: DelegationReturnChannel,
        approval_inheritance: ApprovalInheritance,
    },
    AgentDelegation {
        parent_task_id: String,
        delegated_by: String,
        approval_inheritance: ApprovalInheritance,
    },
    ScheduledWakeup {
        schedule_id: String,
    },
}

impl Default for TaskInputSource {
    fn default() -> Self {
        Self::UserChat
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalInheritance {
    ParentDecides,
    UserRequired,
    FullyAutomatic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CapabilityLease {
    pub allowed_tools: Vec<String>,
    pub allowed_actions: Vec<String>,
    pub model_id: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonitorCheckpointPolicy {
    BeforeEveryRun,
    OnChangeOnly,
    OnFailureOnly,
    Disabled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DelegatedInvocationKind {
    Chat,
    Workflow,
    ImageGeneration,
    TextToSpeech,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DelegationReturnChannel {
    ParentFrameObservation,
    WorkflowEvent,
    AssistantMessage,
    DirectArtifact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameRefreshRequest {
    pub reason: String,
    pub interruption: Option<UserInterruption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact: Option<FrameRefreshArtifact>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrameRefreshArtifact {
    WorldModelFrameRefresh,
    WorldModelFrameRevision,
    DitingThinkPreflight,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrameValidation {
    pub is_valid: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserInterruption {
    pub interruption_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PhaseObservation {
    pub observation_ref: String,
    pub summary: String,
    pub goal_satisfied: bool,
    pub frame_still_valid: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hook_events: Vec<HookEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_frame: Option<WorldModelFrame>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cron_monitor_source_preserves_frame_bootstrap_contract() {
        let source = TaskInputSource::CronMonitor {
            task_id: "monitor-task-1".to_string(),
            schedule_id: "schedule-1".to_string(),
            cron_expr: "0 */6 * * *".to_string(),
            objective: "watch vendor pricing changes".to_string(),
            next_run_at: None,
            monitor_frame_id: None,
            execution_id: None,
            execution_frame_id: None,
            checkpoint_policy: MonitorCheckpointPolicy::BeforeEveryRun,
            capability_lease: CapabilityLease {
                allowed_tools: vec!["search_sdk".to_string()],
                allowed_actions: vec!["notify_on_change".to_string()],
                model_id: Some("gpt-4.1".to_string()),
                expires_at: None,
            },
        };

        assert_eq!(
            serde_json::to_value(source).expect("serialize source"),
            json!({
                "cron_monitor": {
                    "task_id": "monitor-task-1",
                    "schedule_id": "schedule-1",
                    "cron_expr": "0 */6 * * *",
                    "objective": "watch vendor pricing changes",
                    "checkpoint_policy": "before_every_run",
                    "capability_lease": {
                        "allowed_tools": ["search_sdk"],
                        "allowed_actions": ["notify_on_change"],
                        "model_id": "gpt-4.1",
                        "expires_at": null
                    }
                }
            })
        );
    }

    #[test]
    fn delegated_agent_source_carries_parent_frame_and_return_channel() {
        let source = TaskInputSource::DelegatedAgent {
            parent_task_id: "parent-task".to_string(),
            parent_frame_id: Some("frame-parent".to_string()),
            child_run_id: Some("child-run-1".to_string()),
            child_frame_id: Some("frame-parent:delegation:child-run-1".to_string()),
            agent_id: "agent-research".to_string(),
            invocation_kind: DelegatedInvocationKind::Chat,
            delegated_goal: "collect evidence".to_string(),
            capability_lease: CapabilityLease {
                allowed_tools: vec!["context_search".to_string()],
                allowed_actions: vec!["return_structured_findings".to_string()],
                model_id: None,
                expires_at: Some("2026-05-25T00:00:00Z".to_string()),
            },
            return_channel: DelegationReturnChannel::ParentFrameObservation,
            approval_inheritance: ApprovalInheritance::ParentDecides,
        };

        let encoded = serde_json::to_value(source).expect("serialize source");

        assert_eq!(
            encoded
                .pointer("/delegated_agent/parent_frame_id")
                .and_then(serde_json::Value::as_str),
            Some("frame-parent")
        );
        assert_eq!(
            encoded
                .pointer("/delegated_agent/child_run_id")
                .and_then(serde_json::Value::as_str),
            Some("child-run-1")
        );
        assert_eq!(
            encoded
                .pointer("/delegated_agent/child_frame_id")
                .and_then(serde_json::Value::as_str),
            Some("frame-parent:delegation:child-run-1")
        );
        assert_eq!(
            encoded
                .pointer("/delegated_agent/return_channel")
                .and_then(serde_json::Value::as_str),
            Some("parent_frame_observation")
        );
        assert_eq!(
            encoded
                .pointer("/delegated_agent/capability_lease/allowed_tools/0")
                .and_then(serde_json::Value::as_str),
            Some("context_search")
        );
    }
}
