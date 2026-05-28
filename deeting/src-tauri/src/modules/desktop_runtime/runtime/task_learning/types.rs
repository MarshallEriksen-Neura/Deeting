use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

pub(crate) const DECISION_POINT_WORKER_SELECTION: &str = "worker_selection";
pub(crate) const DECISION_POINT_DISCOVERY: &str = "discovery";
pub(crate) const DECISION_POINT_CAPABILITY_ATTACH: &str = "capability_attach";
pub(crate) const DECISION_POINT_EXECUTION: &str = "execution";
pub(crate) const DECISION_POINT_VERIFICATION: &str = "verification";

pub(crate) const ACTION_DISCOVERY_SEARCH_EARLY: &str = "search_sdk_early";
pub(crate) const ACTION_CAPABILITY_ATTACH: &str = "attach_capability";
pub(crate) const ACTION_EXECUTE_CODE_PLAN: &str = "execute_code_plan";
pub(crate) const ACTION_VERIFICATION_STRONGER_CHECKS: &str = "stronger_checks";

pub(crate) fn is_legacy_route_control_delta(decision_point: &str, action_key: &str) -> bool {
    decision_point == "route" && matches!(action_key, "direct" | "worker")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TaskFingerprint {
    pub(crate) goal_shape: String,
    pub(crate) output_shape: String,
    pub(crate) scope_shape: String,
    pub(crate) risk_class: String,
    pub(crate) execution_pressure: String,
    pub(crate) discovery_pressure: String,
    pub(crate) environment_dependency: String,
    pub(crate) verification_demand: String,
}

impl TaskFingerprint {
    pub(crate) fn key(&self) -> String {
        let canonical = [
            self.goal_shape.as_str(),
            self.output_shape.as_str(),
            self.scope_shape.as_str(),
            self.risk_class.as_str(),
            self.execution_pressure.as_str(),
            self.discovery_pressure.as_str(),
            self.environment_dependency.as_str(),
            self.verification_demand.as_str(),
        ]
        .join("|");
        let mut hasher = Sha1::new();
        hasher.update(canonical.as_bytes());
        hex::encode(hasher.finalize())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskPolicyHintItem {
    pub(crate) action_key: String,
    pub(crate) raw_weight: f64,
    pub(crate) effective_weight: f64,
    pub(crate) confidence: f64,
    pub(crate) evidence_count: i64,
    pub(crate) maturity: String,
    pub(crate) updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskPolicyHint {
    pub(crate) query: String,
    pub(crate) decision_point: String,
    pub(crate) fingerprint_key: String,
    pub(crate) task_fingerprint: TaskFingerprint,
    pub(crate) recommended_action: Option<String>,
    pub(crate) priors: Vec<TaskPolicyHintItem>,
    pub(crate) guidance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskLearningDelegatedExecution {
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) selected_profile_id: Option<String>,
    pub(crate) worker_ref: Option<String>,
    pub(crate) packet_hash: Option<String>,
    pub(crate) task_kind: Option<String>,
    pub(crate) deliverable_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct EvaluatedOutcome {
    pub(crate) final_status: String,
    pub(crate) verification_result: String,
    pub(crate) user_response_signal: String,
    pub(crate) judgment_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) worker_selection_judgment: Option<String>,
    pub(crate) discovery_judgment: String,
    pub(crate) execution_judgment: String,
    pub(crate) cost_class: String,
    pub(crate) retry_profile: String,
    pub(crate) error_profile: String,
    pub(crate) confidence: f64,
    pub(crate) finish_reason: String,
    pub(crate) tool_call_count: usize,
    pub(crate) search_sdk_calls: usize,
    pub(crate) used_attach_capability: bool,
    pub(crate) used_execute_code_plan: bool,
    pub(crate) had_delegated_execution: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) delegated_execution: Option<TaskLearningDelegatedExecution>,
    pub(crate) observed_error_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskAttribution {
    pub(crate) primary_stage: Option<String>,
    pub(crate) secondary_evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct PolicyDelta {
    pub(crate) decision_point: String,
    pub(crate) action_key: String,
    pub(crate) direction: String,
    pub(crate) magnitude: f64,
    pub(crate) state: String,
    pub(crate) rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaskLearningEvaluation {
    pub(crate) outcome: EvaluatedOutcome,
    pub(crate) attribution: TaskAttribution,
    pub(crate) policy_delta: Option<PolicyDelta>,
    pub(crate) learning_eligible: bool,
    pub(crate) delta_state: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct TaskLearningSignals {
    pub(crate) tool_call_count: usize,
    pub(crate) tool_error_count: usize,
    pub(crate) requires_approval_count: usize,
    pub(crate) search_sdk_calls: usize,
    pub(crate) used_attach_capability: bool,
    pub(crate) attach_capability_errors: usize,
    pub(crate) used_execute_code_plan: bool,
    pub(crate) successful_execute_code_plan: bool,
    pub(crate) delegated_execution: bool,
    pub(crate) observed_error_codes: Vec<String>,
}
