use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::capability_snapshot::merge_allowed_tool_names;
use crate::prompt::{PromptAssets, PromptPlan};
use crate::route::{
    build_local_route_status_meta, LocalRouteDecision, LocalRouteKind, RouteEvidence,
};

pub const SEARCH_SDK_TOOL_NAME: &str = "search_sdk";
pub const QUERY_TASK_POLICY_TOOL_NAME: &str = "query_task_policy";
pub const GET_TOOL_SCHEMA_TOOL_NAME: &str = "get_tool_schema";
pub const ACTIVATE_SKILL_TOOL_NAME: &str = "activate_skill";
pub const READ_SKILL_RESOURCE_TOOL_NAME: &str = "read_skill_resource";
pub const DELEGATE_TASK_TOOL_NAME: &str = "delegate_task";
pub const EXECUTE_CODE_PLAN_TOOL_NAME: &str = "execute_code_plan";
pub const CONSULT_EXPERT_NETWORK_TOOL_NAME: &str = "consult_expert_network";
pub const ATTACH_CAPABILITY_TOOL_NAME: &str = "attach_capability";
pub const DETACH_CAPABILITY_TOOL_NAME: &str = "detach_capability";
pub const SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME: &str = "sys_submit_onboarding_request";
pub const REFRESH_SKILL_INDEX_TOOL_NAME: &str = "refresh_skill_index";

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct RuntimeDiscoveryBundle {
    execution_snapshot: Value,
    pub capabilities: Vec<Value>,
    pub recipes: Vec<Value>,
    pub orchestration_primitives: Vec<Value>,
    pub route_evidence: RouteEvidence,
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
            route_evidence: RouteEvidence::from_search_result(&search_result),
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalExecutionPlane {
    ResponseOnly,
    WorkerReasoning,
}

impl LocalExecutionPlane {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ResponseOnly => "response_only",
            Self::WorkerReasoning => "worker_reasoning",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalExecutionPolicy {
    pub route: LocalRouteKind,
    pub plane: LocalExecutionPlane,
    pub allowed_tool_names: Vec<String>,
    pub inject_execution_protocol: bool,
    pub allow_worker_delegation: bool,
    pub prefer_workflow_runtime: bool,
    pub capability_snapshot: Option<Value>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct LocalControlPlaneResult {
    pub runtime_discovery: Option<RuntimeDiscoveryBundle>,
    pub route_decision: Option<LocalRouteDecision>,
    pub execution_policy: LocalExecutionPolicy,
    pub prompt_assets: PromptAssets,
    pub prompt_plan: PromptPlan,
    pub status_meta: Value,
}

impl LocalExecutionPolicy {
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
        route: LocalRouteKind::Direct,
        plane: LocalExecutionPlane::ResponseOnly,
        allowed_tool_names: Vec::new(),
        inject_execution_protocol: false,
        allow_worker_delegation: false,
        prefer_workflow_runtime: false,
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

pub fn build_local_execution_policy(decision: &LocalRouteDecision) -> LocalExecutionPolicy {
    match decision.route {
        LocalRouteKind::Direct => LocalExecutionPolicy {
            route: LocalRouteKind::Direct,
            plane: LocalExecutionPlane::ResponseOnly,
            allowed_tool_names: resident_capability_control_tool_names(),
            inject_execution_protocol: false,
            allow_worker_delegation: false,
            prefer_workflow_runtime: false,
            capability_snapshot: None,
        },
        LocalRouteKind::Worker => LocalExecutionPolicy {
            route: LocalRouteKind::Worker,
            plane: LocalExecutionPlane::WorkerReasoning,
            allowed_tool_names: full_execution_tool_names(),
            inject_execution_protocol: true,
            allow_worker_delegation: true,
            prefer_workflow_runtime: false,
            capability_snapshot: None,
        },
    }
}

pub fn build_local_execution_policy_status_meta(policy: &LocalExecutionPolicy) -> Value {
    json!({
        "route": policy.route.as_str(),
        "plane": policy.plane.as_str(),
        "allowed_tool_names": policy.allowed_tool_names,
        "inject_execution_protocol": policy.inject_execution_protocol,
        "allow_worker_delegation": policy.allow_worker_delegation,
        "prefer_workflow_runtime": policy.prefer_workflow_runtime,
        "has_capability_snapshot": policy.capability_snapshot.is_some(),
    })
}

pub fn build_local_control_plane_status_meta(
    decision: &LocalRouteDecision,
    policy: &LocalExecutionPolicy,
) -> Value {
    let mut meta = build_local_route_status_meta(decision);
    if let Some(object) = meta.as_object_mut() {
        object.insert(
            "execution_policy".to_string(),
            build_local_execution_policy_status_meta(policy),
        );
    }
    meta
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
        DELEGATE_TASK_TOOL_NAME,
        EXECUTE_CODE_PLAN_TOOL_NAME,
        CONSULT_EXPERT_NETWORK_TOOL_NAME,
        ATTACH_CAPABILITY_TOOL_NAME,
        DETACH_CAPABILITY_TOOL_NAME,
        "terminal_context_peek",
        "terminal_context_read",
        "terminal_context_pack",
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
    use crate::route::TaskProfile;
    use serde_json::json;

    #[test]
    fn worker_execution_policy_defaults_to_legacy_worker_path() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::Worker,
            reasons: vec!["programmatic_logic".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: true,
                wants_analysis: false,
                wants_single_action: false,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 0,
                has_programmatic_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: Vec::new(),
                callable_direct_capability_names: Vec::new(),
            },
        };

        let policy = build_local_execution_policy(&decision);

        assert!(policy.allow_worker_delegation);
        assert!(!policy.prefer_workflow_runtime);
        assert!(policy.inject_execution_protocol);
        assert!(policy
            .allowed_tool_names
            .iter()
            .any(|name| name == EXECUTE_CODE_PLAN_TOOL_NAME));
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
            discovery.route_evidence.direct_capability_names,
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
                "exa".to_string(),
                "fetch_page".to_string(),
                "read_skill_resource".to_string(),
                "search_sdk".to_string(),
                "tavily-extract".to_string(),
                "tavily-search".to_string(),
                "terminal_context_pack".to_string(),
                "terminal_context_peek".to_string(),
                "terminal_context_read".to_string(),
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
            route: LocalRouteKind::Worker,
            plane: LocalExecutionPlane::WorkerReasoning,
            allowed_tool_names: vec!["search_sdk".to_string()],
            inject_execution_protocol: true,
            allow_worker_delegation: true,
            prefer_workflow_runtime: false,
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
    fn direct_execution_policy_keeps_skill_control_tools_resident() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::Direct,
            reasons: vec!["single_action".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: false,
                wants_single_action: true,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 0,
                has_programmatic_executor: false,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: Vec::new(),
                callable_direct_capability_names: Vec::new(),
            },
        };

        let policy = build_local_execution_policy(&decision);

        assert_eq!(
            policy.allowed_tool_names,
            vec![
                SEARCH_SDK_TOOL_NAME.to_string(),
                ACTIVATE_SKILL_TOOL_NAME.to_string(),
                READ_SKILL_RESOURCE_TOOL_NAME.to_string(),
                "terminal_context_peek".to_string(),
                "terminal_context_read".to_string(),
                "terminal_context_pack".to_string(),
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
                READ_SKILL_RESOURCE_TOOL_NAME.to_string(),
                SEARCH_SDK_TOOL_NAME.to_string(),
                "terminal_context_pack".to_string(),
                "terminal_context_peek".to_string(),
                "terminal_context_read".to_string(),
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
