use desktop_runtime_core::PhaseStepType;
use serde::de;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::capability_snapshot::merge_allowed_tool_names;
use crate::prompt::{PromptAssets, PromptPlan};
use crate::runtime_evidence::RuntimeCapabilityEvidence;

pub const SEARCH_SDK_TOOL_NAME: &str = "search_sdk";
pub const QUERY_TASK_POLICY_TOOL_NAME: &str = "query_task_policy";
pub const GET_TOOL_SCHEMA_TOOL_NAME: &str = "get_tool_schema";
pub const ACTIVATE_SKILL_TOOL_NAME: &str = "activate_skill";
pub const READ_SKILL_RESOURCE_TOOL_NAME: &str = "read_skill_resource";
pub const START_DELEGATE_AGENT_TOOL_NAME: &str = "start_delegate_agent";
pub const START_DELEGATE_MANY_TOOL_NAME: &str = "start_delegate_many";
pub const DELEGATIONS_STATUS_TOOL_NAME: &str = "delegations_status";
pub const WAIT_DELEGATIONS_TOOL_NAME: &str = "wait_delegations";
pub const STOP_DELEGATIONS_TOOL_NAME: &str = "stop_delegations";
pub const EXECUTE_CODE_PLAN_TOOL_NAME: &str = "execute_code_plan";
pub const CONSULT_EXPERT_NETWORK_TOOL_NAME: &str = "consult_expert_network";
pub const SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME: &str = "sys_submit_onboarding_request";
pub const REFRESH_SKILL_INDEX_TOOL_NAME: &str = "refresh_skill_index";
pub const CONTEXT_SEARCH_TOOL_NAME: &str = "context_search";
pub const CONTEXT_OPEN_TOOL_NAME: &str = "context_open";
pub const CONTEXT_EXPAND_TOOL_NAME: &str = "context_expand";
pub const CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME: &str = "context_summarize_evidence";

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct RuntimeDiscoveryBundle {
    execution_snapshot: Value,
    pub capabilities: Vec<Value>,
    pub recipes: Vec<Value>,
    pub orchestration_primitives: Vec<Value>,
    pub runtime_evidence: RuntimeCapabilityEvidence,
}

impl RuntimeDiscoveryBundle {
    pub fn from_search_result(search_result: Value) -> Self {
        Self {
            capabilities: extract_array_items(&search_result, "capabilities"),
            recipes: extract_array_items(&search_result, "recipes"),
            orchestration_primitives: extract_array_items(
                &search_result,
                "orchestration_primitives",
            ),
            runtime_evidence: RuntimeCapabilityEvidence::from_search_result(&search_result),
            execution_snapshot: search_result,
        }
    }

    #[allow(dead_code)]
    pub fn execution_snapshot(&self) -> &Value {
        &self.execution_snapshot
    }

    #[allow(dead_code)]
    pub fn skill_recipes(&self) -> &[Value] {
        &self.recipes
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LocalExecutionPolicy {
    pub initial_phase_step: PhaseStepType,
    pub allowed_tool_names: Vec<String>,
    pub inject_execution_protocol: bool,
    pub allow_worker_delegation: bool,
    pub prefer_workflow_runtime: bool,
    pub require_world_model_update: bool,
    pub capability_snapshot: Option<Value>,
}

impl<'de> Deserialize<'de> for LocalExecutionPolicy {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| de::Error::custom("LocalExecutionPolicy must be an object"))?;
        let initial_phase_step = object
            .get("initial_phase_step")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?
            .or_else(|| legacy_plane_phase_step(object.get("plane")))
            .unwrap_or(PhaseStepType::DirectChat);
        let allowed_tool_names = object
            .get("allowed_tool_names")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(de::Error::custom)?
            .unwrap_or_default();
        let inject_execution_protocol = object
            .get("inject_execution_protocol")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let allow_worker_delegation = object
            .get("allow_worker_delegation")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let prefer_workflow_runtime = object
            .get("prefer_workflow_runtime")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let require_world_model_update = object
            .get("require_world_model_update")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let capability_snapshot = object
            .get("capability_snapshot")
            .filter(|value| !value.is_null())
            .cloned();

        Ok(Self {
            initial_phase_step,
            allowed_tool_names,
            inject_execution_protocol,
            allow_worker_delegation,
            prefer_workflow_runtime,
            require_world_model_update,
            capability_snapshot,
        })
    }
}

fn legacy_plane_phase_step(value: Option<&Value>) -> Option<PhaseStepType> {
    match value.and_then(Value::as_str) {
        Some("ResponseOnly") | Some("response_only") => Some(PhaseStepType::DirectChat),
        Some("WorkerReasoning") | Some("worker_reasoning") => Some(PhaseStepType::DelegatedWorker),
        _ => None,
    }
}

pub fn phase_step_type_name(step_type: PhaseStepType) -> &'static str {
    match step_type {
        PhaseStepType::DirectChat => "direct_chat",
        PhaseStepType::ToolCall => "tool_call",
        PhaseStepType::DelegatedWorker => "delegated_worker",
        PhaseStepType::DelegatedWorkflow => "delegated_workflow",
        PhaseStepType::CapabilityAdmit => "capability_admit",
        PhaseStepType::VerifyFinal => "verify_final",
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct LocalControlPlaneResult {
    pub runtime_discovery: Option<RuntimeDiscoveryBundle>,
    pub execution_policy: LocalExecutionPolicy,
    pub prompt_assets: PromptAssets,
    pub prompt_plan: PromptPlan,
    pub status_meta: Value,
}

impl LocalExecutionPolicy {
    pub fn initial_phase_step_name(&self) -> &'static str {
        phase_step_type_name(self.initial_phase_step)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn allows_tool(&self, tool_name: &str) -> bool {
        let normalized = tool_name.trim().to_lowercase();
        if normalized.is_empty() {
            return false;
        }
        self.allowed_tool_names
            .iter()
            .any(|item| item == &normalized)
    }

    pub fn prompt_tool_names(&self) -> Vec<String> {
        self.allowed_tool_names
            .iter()
            .filter(|name| name.as_str() != SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME)
            .cloned()
            .collect()
    }

    pub fn effective_allowed_tool_names(
        &self,
        capability_snapshot: Option<&serde_json::Value>,
    ) -> Vec<String> {
        merge_allowed_tool_names(&self.allowed_tool_names, capability_snapshot)
    }
}

pub fn build_default_local_execution_policy() -> LocalExecutionPolicy {
    LocalExecutionPolicy {
        initial_phase_step: PhaseStepType::DirectChat,
        allowed_tool_names: Vec::new(),
        inject_execution_protocol: false,
        allow_worker_delegation: false,
        prefer_workflow_runtime: false,
        require_world_model_update: false,
        capability_snapshot: None,
    }
}

pub fn resident_capability_control_tool_names() -> Vec<String> {
    [
        SEARCH_SDK_TOOL_NAME,
        ACTIVATE_SKILL_TOOL_NAME,
        READ_SKILL_RESOURCE_TOOL_NAME,
        "terminal_context_peek",
        "terminal_context_read",
        "terminal_context_pack",
        "terminal_write_input",
        "workflow_plan_peek",
        "workflow_plan_read",
        "workflow_plan_update",
        "workflow_plan_compile",
        CONTEXT_SEARCH_TOOL_NAME,
        CONTEXT_OPEN_TOOL_NAME,
        CONTEXT_EXPAND_TOOL_NAME,
        CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn ensure_resident_capability_control_tools(allowed: &mut Vec<String>) {
    for name in resident_capability_control_tool_names() {
        if !allowed.iter().any(|item| item == &name) {
            allowed.push(name);
        }
    }
}

pub fn build_local_execution_policy_status_meta(policy: &LocalExecutionPolicy) -> Value {
    json!({
        "initial_phase_step": phase_step_type_name(policy.initial_phase_step),
        "allowed_tool_names": policy.allowed_tool_names,
        "inject_execution_protocol": policy.inject_execution_protocol,
        "allow_worker_delegation": policy.allow_worker_delegation,
        "prefer_workflow_runtime": policy.prefer_workflow_runtime,
        "require_world_model_update": policy.require_world_model_update,
        "has_capability_snapshot": policy.capability_snapshot.is_some(),
    })
}

pub fn enrich_execution_policy_with_runtime_discovery(
    mut policy: LocalExecutionPolicy,
    runtime_discovery: Option<&RuntimeDiscoveryBundle>,
) -> LocalExecutionPolicy {
    let mut allowed = policy.allowed_tool_names.clone();
    ensure_resident_capability_control_tools(&mut allowed);
    if let Some(discovery) = runtime_discovery {
        policy.capability_snapshot = Some(discovery.execution_snapshot().clone());
    } else {
        policy.capability_snapshot = None;
    }

    policy.allowed_tool_names = merge_allowed_tool_names(
        &allowed,
        runtime_discovery.map(RuntimeDiscoveryBundle::execution_snapshot),
    );
    policy
}

pub fn full_execution_tool_names() -> Vec<String> {
    [
        SEARCH_SDK_TOOL_NAME,
        QUERY_TASK_POLICY_TOOL_NAME,
        GET_TOOL_SCHEMA_TOOL_NAME,
        ACTIVATE_SKILL_TOOL_NAME,
        READ_SKILL_RESOURCE_TOOL_NAME,
        START_DELEGATE_AGENT_TOOL_NAME,
        START_DELEGATE_MANY_TOOL_NAME,
        DELEGATIONS_STATUS_TOOL_NAME,
        WAIT_DELEGATIONS_TOOL_NAME,
        STOP_DELEGATIONS_TOOL_NAME,
        EXECUTE_CODE_PLAN_TOOL_NAME,
        CONSULT_EXPERT_NETWORK_TOOL_NAME,
        "terminal_context_peek",
        "terminal_context_read",
        "terminal_context_pack",
        "terminal_write_input",
        "workflow_plan_peek",
        "workflow_plan_read",
        "workflow_plan_update",
        "workflow_plan_compile",
        CONTEXT_SEARCH_TOOL_NAME,
        CONTEXT_OPEN_TOOL_NAME,
        CONTEXT_EXPAND_TOOL_NAME,
        CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME,
        SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME,
        REFRESH_SKILL_INDEX_TOOL_NAME,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn extract_array_items(search_result: &Value, field: &str) -> Vec<Value> {
    search_result
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn local_execution_policy_deserializes_legacy_plane_as_phase_step() {
        let policy: LocalExecutionPolicy = serde_json::from_value(json!({
            "plane": "worker_reasoning",
            "allowed_tool_names": [],
            "inject_execution_protocol": true,
            "allow_worker_delegation": true,
            "prefer_workflow_runtime": false,
        }))
        .expect("legacy plane policy should deserialize");

        assert_eq!(policy.initial_phase_step, PhaseStepType::DelegatedWorker);
    }

    #[test]
    fn local_execution_policy_ignores_legacy_route_field() {
        let policy: LocalExecutionPolicy = serde_json::from_value(json!({
            "route": "worker",
            "allowed_tool_names": [],
            "inject_execution_protocol": true,
            "allow_worker_delegation": true,
            "prefer_workflow_runtime": false,
        }))
        .expect("legacy route-only policy should deserialize");

        assert_eq!(policy.initial_phase_step, PhaseStepType::DirectChat);
    }

    #[test]
    fn status_meta_includes_prefer_workflow_runtime_flag() {
        let mut policy = build_default_local_execution_policy();
        policy.prefer_workflow_runtime = true;

        let meta = build_local_execution_policy_status_meta(&policy);

        assert_eq!(
            meta.get("prefer_workflow_runtime").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn resident_policy_exposes_context_tools() {
        let tools = resident_capability_control_tool_names();

        assert!(tools.iter().any(|name| name == CONTEXT_SEARCH_TOOL_NAME));
        assert!(tools.iter().any(|name| name == CONTEXT_OPEN_TOOL_NAME));
        assert!(tools.iter().any(|name| name == CONTEXT_EXPAND_TOOL_NAME));
        assert!(tools
            .iter()
            .any(|name| name == CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME));
    }

    #[test]
    fn full_execution_policy_exposes_context_tools() {
        let tools = full_execution_tool_names();

        assert!(tools.iter().any(|name| name == CONTEXT_SEARCH_TOOL_NAME));
        assert!(tools.iter().any(|name| name == CONTEXT_OPEN_TOOL_NAME));
        assert!(tools.iter().any(|name| name == CONTEXT_EXPAND_TOOL_NAME));
        assert!(tools
            .iter()
            .any(|name| name == CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME));
    }

    #[test]
    fn enrich_execution_policy_with_runtime_discovery_allows_all_callable_direct_capabilities() {
        let discovery = RuntimeDiscoveryBundle::from_search_result(json!({
            "capabilities": [
                {"name": "exa", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "tavily-search", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "tavily-extract", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "fetch_page", "invocation_mode": "direct", "status": {"callable": true}},
                {"name": "disabled_tool", "invocation_mode": "direct", "status": {"callable": false}}
            ]
        }));

        assert_eq!(
            discovery.runtime_evidence.direct_capability_names,
            vec![
                "exa".to_string(),
                "tavily-search".to_string(),
                "tavily-extract".to_string(),
            ]
        );

        let policy = enrich_execution_policy_with_runtime_discovery(
            build_default_local_execution_policy(),
            Some(&discovery),
        );

        assert!(!policy.prefer_workflow_runtime);
        assert_eq!(
            policy.allowed_tool_names,
            vec![
                "activate_skill".to_string(),
                "context_expand".to_string(),
                "context_open".to_string(),
                "context_search".to_string(),
                "context_summarize_evidence".to_string(),
                "exa".to_string(),
                "fetch_page".to_string(),
                "read_skill_resource".to_string(),
                "search_sdk".to_string(),
                "tavily-extract".to_string(),
                "tavily-search".to_string(),
                "terminal_context_pack".to_string(),
                "terminal_context_peek".to_string(),
                "terminal_context_read".to_string(),
                "terminal_write_input".to_string(),
                "workflow_plan_compile".to_string(),
                "workflow_plan_peek".to_string(),
                "workflow_plan_read".to_string(),
                "workflow_plan_update".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_discovery_exposes_execution_snapshot_accessor() {
        let discovery = RuntimeDiscoveryBundle::from_search_result(json!({
            "capabilities": [{"name": "weather_lookup"}],
            "recipes": [],
            "orchestration_primitives": [],
        }));

        assert_eq!(
            discovery.execution_snapshot()["capabilities"][0]["name"],
            json!("weather_lookup")
        );
    }

    #[test]
    fn effective_allowed_tool_names_merges_snapshot_direct_capabilities_without_legacy_field() {
        let policy = LocalExecutionPolicy {
            initial_phase_step: PhaseStepType::DelegatedWorker,
            allowed_tool_names: vec!["search_sdk".to_string()],
            inject_execution_protocol: true,
            allow_worker_delegation: true,
            prefer_workflow_runtime: false,
            require_world_model_update: false,
            capability_snapshot: None,
        };

        assert_eq!(
            policy.effective_allowed_tool_names(Some(&json!({
                "capabilities": [
                    {"name": "browser_open_tab", "invocation_mode": "direct", "status": {"callable": true}},
                    {"name": "browser_get_page_snapshot", "invocation_mode": "direct", "status": {"callable": true}}
                ]
            }))),
            vec![
                "browser_get_page_snapshot".to_string(),
                "browser_open_tab".to_string(),
                "search_sdk".to_string(),
            ]
        );
    }

    #[test]
    fn runtime_discovery_preserves_skill_control_tools_when_base_policy_is_empty() {
        let policy = enrich_execution_policy_with_runtime_discovery(
            build_default_local_execution_policy(),
            None,
        );

        assert_eq!(
            policy.allowed_tool_names,
            vec![
                ACTIVATE_SKILL_TOOL_NAME.to_string(),
                CONTEXT_EXPAND_TOOL_NAME.to_string(),
                CONTEXT_OPEN_TOOL_NAME.to_string(),
                CONTEXT_SEARCH_TOOL_NAME.to_string(),
                CONTEXT_SUMMARIZE_EVIDENCE_TOOL_NAME.to_string(),
                READ_SKILL_RESOURCE_TOOL_NAME.to_string(),
                SEARCH_SDK_TOOL_NAME.to_string(),
                "terminal_context_pack".to_string(),
                "terminal_context_peek".to_string(),
                "terminal_context_read".to_string(),
                "terminal_write_input".to_string(),
                "workflow_plan_compile".to_string(),
                "workflow_plan_peek".to_string(),
                "workflow_plan_read".to_string(),
                "workflow_plan_update".to_string(),
            ]
        );
    }

    #[test]
    fn prompt_tool_names_follow_allowed_tools_for_direct_lane() {
        let mut policy = build_default_local_execution_policy();
        policy.allowed_tool_names = vec![
            SEARCH_SDK_TOOL_NAME.to_string(),
            "shell_execute".to_string(),
            SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME.to_string(),
        ];

        assert_eq!(
            policy.prompt_tool_names(),
            vec![
                SEARCH_SDK_TOOL_NAME.to_string(),
                "shell_execute".to_string()
            ]
        );
    }
}
