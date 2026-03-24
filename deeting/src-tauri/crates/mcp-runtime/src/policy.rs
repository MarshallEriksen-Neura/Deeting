use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{json, Value};

use crate::prompt::{PromptAssets, PromptPlan};
use crate::route::{
    build_local_route_status_meta, LocalRouteDecision, LocalRouteKind, RouteEvidence,
};

pub const SEARCH_SDK_TOOL_NAME: &str = "search_sdk";
pub const EXECUTE_CODE_PLAN_TOOL_NAME: &str = "execute_code_plan";
pub const CONSULT_EXPERT_NETWORK_TOOL_NAME: &str = "consult_expert_network";
pub const ATTACH_CAPABILITY_TOOL_NAME: &str = "attach_capability";
pub const DETACH_CAPABILITY_TOOL_NAME: &str = "detach_capability";
pub const SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME: &str = "sys_submit_onboarding_request";
pub const REFRESH_SKILL_INDEX_TOOL_NAME: &str = "refresh_skill_index";

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct RuntimeDiscoveryBundle {
    raw_search_result: Value,
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
            raw_search_result: search_result,
        }
    }

    #[allow(dead_code)]
    pub fn raw_search_result(&self) -> &Value {
        &self.raw_search_result
    }

    #[allow(dead_code)]
    pub fn skill_recipes(&self) -> &[Value] {
        &self.recipes
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum LocalExecutionPlane {
    ResponseOnly,
    WorkerReasoning,
    CodeModeOrchestration,
}

impl LocalExecutionPlane {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ResponseOnly => "response_only",
            Self::WorkerReasoning => "worker_reasoning",
            Self::CodeModeOrchestration => "code_mode_orchestration",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LocalExecutionPolicy {
    pub route: LocalRouteKind,
    pub plane: LocalExecutionPlane,
    pub allowed_tool_names: Vec<String>,
    pub inject_code_mode_protocol: bool,
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
        let mut allowed = self.allowed_tool_names.clone();
        if let Some(snapshot) = capability_snapshot {
            if let Some(items) = snapshot
                .get("allowed_tool_names")
                .and_then(|v| v.as_array())
            {
                for item in items {
                    if let Some(text) = item.as_str() {
                        allowed.push(text.to_string());
                    }
                }
            }
        }
        allowed.sort();
        allowed.dedup();
        allowed
    }
}

pub fn build_default_local_execution_policy() -> LocalExecutionPolicy {
    LocalExecutionPolicy {
        route: LocalRouteKind::Direct,
        plane: LocalExecutionPlane::ResponseOnly,
        allowed_tool_names: Vec::new(),
        inject_code_mode_protocol: false,
        allow_worker_delegation: false,
        prefer_workflow_runtime: false,
        capability_snapshot: None,
    }
}

pub fn build_local_execution_policy(decision: &LocalRouteDecision) -> LocalExecutionPolicy {
    match decision.route {
        LocalRouteKind::Direct => LocalExecutionPolicy {
            route: LocalRouteKind::Direct,
            plane: LocalExecutionPlane::ResponseOnly,
            allowed_tool_names: vec![SEARCH_SDK_TOOL_NAME.to_string()],
            inject_code_mode_protocol: false,
            allow_worker_delegation: false,
            prefer_workflow_runtime: false,
            capability_snapshot: None,
        },
        LocalRouteKind::Worker => LocalExecutionPolicy {
            route: LocalRouteKind::Worker,
            plane: LocalExecutionPlane::WorkerReasoning,
            allowed_tool_names: vec![SEARCH_SDK_TOOL_NAME.to_string()],
            inject_code_mode_protocol: false,
            allow_worker_delegation: true,
            prefer_workflow_runtime: false,
            capability_snapshot: None,
        },
        LocalRouteKind::CodeMode => LocalExecutionPolicy {
            route: LocalRouteKind::CodeMode,
            plane: LocalExecutionPlane::CodeModeOrchestration,
            allowed_tool_names: full_code_mode_tool_names(),
            inject_code_mode_protocol: true,
            allow_worker_delegation: false,
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
        "inject_code_mode_protocol": policy.inject_code_mode_protocol,
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
    if !allowed.iter().any(|name| name == SEARCH_SDK_TOOL_NAME) {
        allowed.push(SEARCH_SDK_TOOL_NAME.to_string());
    }
    if let Some(discovery) = runtime_discovery {
        policy.capability_snapshot = Some(discovery.raw_search_result().clone());
        allowed.extend(
            discovery
                .route_evidence
                .callable_direct_capability_names
                .iter()
                .cloned(),
        );
    } else {
        policy.capability_snapshot = None;
    }

    policy.allowed_tool_names = normalize_tool_names(allowed);
    policy
}

pub fn full_code_mode_tool_names() -> Vec<String> {
    [
        SEARCH_SDK_TOOL_NAME,
        EXECUTE_CODE_PLAN_TOOL_NAME,
        CONSULT_EXPERT_NETWORK_TOOL_NAME,
        ATTACH_CAPABILITY_TOOL_NAME,
        DETACH_CAPABILITY_TOOL_NAME,
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

fn normalize_tool_names<I>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    names
        .into_iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
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
            reasons: vec!["analysis_request".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: true,
                wants_single_action: false,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 0,
                has_code_mode_executor: false,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: Vec::new(),
                callable_direct_capability_names: Vec::new(),
            },
        };

        let policy = build_local_execution_policy(&decision);

        assert!(policy.allow_worker_delegation);
        assert!(!policy.prefer_workflow_runtime);
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
                {"name": "exa", "status": {"callable": true}},
                {"name": "tavily-search", "status": {"callable": true}},
                {"name": "tavily-extract", "status": {"callable": true}},
                {"name": "fetch_page", "status": {"callable": true}},
                {"name": "disabled_tool", "status": {"callable": false}}
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
                "exa".to_string(),
                "fetch_page".to_string(),
                "search_sdk".to_string(),
                "tavily-extract".to_string(),
                "tavily-search".to_string(),
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
