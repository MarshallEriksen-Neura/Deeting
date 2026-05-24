use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct RuntimeTransition {
    pub(crate) transition_id: String,
    pub(crate) trace_id: String,
    pub(crate) request_id: Option<String>,
    pub(crate) session_id: String,
    pub(crate) source: TransitionSource,
    pub(crate) from_state: RuntimeStateKind,
    pub(crate) to_state: RuntimeStateKind,
    pub(crate) proposed_action: ProposedAction,
    pub(crate) capability_id: Option<String>,
    pub(crate) tool_name: Option<String>,
    pub(crate) effect_scope: EffectScope,
    pub(crate) observed_evidence: Vec<EvidenceRef>,
    pub(crate) uncertainty_flags: Vec<String>,
    pub(crate) metadata_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TransitionSource {
    ProviderResponse,
    CapabilityDiscovery,
    CapabilityContract,
    ExecutionObservation,
    MonitorResult,
    RuntimePolicy,
    UserFeedback,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeStateKind {
    UserInput,
    ModelProposal,
    ToolExecutionPending,
    CapabilityDiscovered,
    CapabilityExposed,
    CapabilityExecutable,
    ExecutionObserved,
    PlanDrafted,
    PlanRevisionNeeded,
    FinalAnswerProposed,
    Finalized,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProposedAction {
    DirectAnswer,
    DraftPlan,
    ExecuteTool,
    ExposeCapability,
    AdmitExecutableCapability,
    RevisePlan,
    VerifyFinalAnswer,
    RecordMonitorCheckpoint,
    Noop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EffectScope {
    ReadOnly,
    Session,
    Workspace,
    External,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct EvidenceRef {
    pub(crate) kind: String,
    pub(crate) source: String,
    pub(crate) id: Option<String>,
    pub(crate) metadata_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HookDecision {
    Allow {
        reason: String,
    },
    RequireArtifact {
        artifact: RequiredArtifact,
        reason: String,
        enforcement: HookEnforcementMode,
    },
    RequireApproval {
        reason: String,
    },
    Block {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RequiredArtifact {
    DitingThinkPreflight,
    PlanDraft,
    PlanRevision,
    VerificationPlan,
    CapabilityLease,
    MonitorCheckpoint,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HookEnforcementMode {
    Enforced,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_transition_serialization_payload_is_stable() {
        let transition = RuntimeTransition {
            transition_id: "runtime-transition:call-1".to_string(),
            trace_id: "trace-1".to_string(),
            request_id: Some("request-1".to_string()),
            session_id: "session-1".to_string(),
            source: TransitionSource::ProviderResponse,
            from_state: RuntimeStateKind::ModelProposal,
            to_state: RuntimeStateKind::ToolExecutionPending,
            proposed_action: ProposedAction::ExecuteTool,
            capability_id: Some("capability-1".to_string()),
            tool_name: Some("shell_execute".to_string()),
            effect_scope: EffectScope::Workspace,
            observed_evidence: vec![EvidenceRef {
                kind: "provider_tool_call".to_string(),
                source: "openai_responses".to_string(),
                id: Some("call-1".to_string()),
                metadata_json: json!({"round": 1}),
            }],
            uncertainty_flags: vec!["side_effect_scope_unknown".to_string()],
            metadata_json: json!({"call_index": 0}),
        };

        assert_eq!(
            serde_json::to_value(&transition).expect("transition json"),
            json!({
                "transition_id": "runtime-transition:call-1",
                "trace_id": "trace-1",
                "request_id": "request-1",
                "session_id": "session-1",
                "source": "provider_response",
                "from_state": "model_proposal",
                "to_state": "tool_execution_pending",
                "proposed_action": "execute_tool",
                "capability_id": "capability-1",
                "tool_name": "shell_execute",
                "effect_scope": "workspace",
                "observed_evidence": [{
                    "kind": "provider_tool_call",
                    "source": "openai_responses",
                    "id": "call-1",
                    "metadata_json": {"round": 1}
                }],
                "uncertainty_flags": ["side_effect_scope_unknown"],
                "metadata_json": {"call_index": 0}
            })
        );
    }

    #[test]
    fn hook_decision_serialization_payload_is_stable() {
        let decision = HookDecision::RequireArtifact {
            artifact: RequiredArtifact::DitingThinkPreflight,
            reason: "tool proposal crosses execution boundary".to_string(),
            enforcement: HookEnforcementMode::Enforced,
        };

        assert_eq!(
            serde_json::to_value(&decision).expect("decision json"),
            json!({
                "require_artifact": {
                    "artifact": "diting_think_preflight",
                    "reason": "tool proposal crosses execution boundary",
                    "enforcement": "enforced"
                }
            })
        );
    }
}
