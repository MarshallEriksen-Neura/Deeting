use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PlanDraftArtifact {
    pub(crate) intent: String,
    pub(crate) constraints: Vec<String>,
    pub(crate) known_facts: Vec<String>,
    pub(crate) unknowns: Vec<String>,
    pub(crate) adaptation_rules: Vec<String>,
    pub(crate) verification_targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct PlanRevisionArtifact {
    pub(crate) prior_plan_id: Option<String>,
    pub(crate) trigger: String,
    pub(crate) changed_assumptions: Vec<String>,
    pub(crate) revised_intent: Option<String>,
    pub(crate) adaptation_rules: Vec<String>,
    pub(crate) verification_targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct VerificationPlanArtifact {
    pub(crate) target: String,
    pub(crate) required_evidence: Vec<String>,
    pub(crate) acceptable_commands: Vec<String>,
    pub(crate) completion_gate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct CapabilityLeaseArtifact {
    pub(crate) capability_id: Option<String>,
    pub(crate) tool_name: Option<String>,
    pub(crate) exposure_kind: String,
    pub(crate) lease_scope: String,
    pub(crate) verification_target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct MonitorCheckpointArtifact {
    pub(crate) monitor_task_id: Option<String>,
    pub(crate) strategy_tag: Option<String>,
    pub(crate) observations: Vec<String>,
    pub(crate) evidence_role: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeTransitionCorrelationOutcome {
    Matched,
    Contradicted,
    Unverified,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RuntimeTransitionCorrelationArtifact {
    pub(crate) transition_id: String,
    pub(crate) outcome: RuntimeTransitionCorrelationOutcome,
    pub(crate) evidence_refs: Vec<String>,
    pub(crate) note: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_draft_describes_adaptation_not_fixed_tool_order() {
        let artifact = PlanDraftArtifact {
            intent: "inspect runtime boundary".to_string(),
            constraints: vec!["shadow only".to_string()],
            known_facts: vec!["search_sdk can widen capabilities".to_string()],
            unknowns: vec!["which tool will be needed".to_string()],
            adaptation_rules: vec!["revise after capability discovery".to_string()],
            verification_targets: vec!["graph event persisted".to_string()],
        };

        assert!(artifact.adaptation_rules[0].contains("revise"));
        assert!(artifact.verification_targets[0].contains("graph"));
    }
}
