use serde::Serialize;
use serde_json::{json, Value};

use crate::capability_snapshot::extract_callable_direct_capability_names;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum LocalRouteKind {
    Direct,
    Worker,
}

impl LocalRouteKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Worker => "worker",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TaskProfile {
    pub explicit_route: Option<LocalRouteKind>,
    pub has_batch_scope: bool,
    pub wants_programmatic_logic: bool,
    pub wants_analysis: bool,
    pub wants_single_action: bool,
    pub destructive_intent: bool,
    pub approval_sensitive: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RouteEvidence {
    pub direct_callable_capability_count: usize,
    pub has_programmatic_executor: bool,
    pub any_mutating_capability: bool,
    pub any_high_risk_capability: bool,
    pub direct_capability_names: Vec<String>,
    pub callable_direct_capability_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LocalRouteDecision {
    pub route: LocalRouteKind,
    pub reasons: Vec<String>,
    pub profile: TaskProfile,
    pub evidence: RouteEvidence,
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn select_local_route(query: &str, search_result: &Value) -> LocalRouteDecision {
    select_local_route_with_evidence(query, RouteEvidence::from_search_result(search_result))
}

pub fn select_local_route_with_evidence(
    query: &str,
    evidence: RouteEvidence,
) -> LocalRouteDecision {
    let profile = TaskProfile::from_query(query);

    let (route, reasons) = if let Some(route) = profile.explicit_route.clone() {
        (route, vec!["explicit_route".to_string()])
    } else if profile.destructive_intent
        || profile.approval_sensitive
        || evidence.any_mutating_capability
        || evidence.any_high_risk_capability
    {
        let mut reasons = Vec::new();
        if profile.destructive_intent {
            reasons.push("destructive_intent".to_string());
        }
        if profile.approval_sensitive {
            reasons.push("approval_sensitive".to_string());
        }
        if evidence.any_mutating_capability {
            reasons.push("mutating_capability".to_string());
        }
        if evidence.any_high_risk_capability {
            reasons.push("high_risk_capability".to_string());
        }
        (LocalRouteKind::Direct, reasons)
    } else if profile.wants_programmatic_logic
        && evidence.has_programmatic_executor
        && (!profile.wants_analysis || profile.has_batch_scope)
    {
        let mut reasons = Vec::new();
        if profile.has_batch_scope {
            reasons.push("batch_scope".to_string());
        }
        reasons.push("programmatic_logic".to_string());
        reasons.push("programmatic_executor_available".to_string());
        (LocalRouteKind::Worker, reasons)
    } else if profile.wants_analysis {
        (LocalRouteKind::Worker, vec!["analysis_request".to_string()])
    } else if evidence.direct_callable_capability_count == 1 && profile.wants_single_action {
        (
            LocalRouteKind::Direct,
            vec!["single_direct_callable".to_string()],
        )
    } else if evidence.direct_callable_capability_count > 1 && profile.wants_single_action {
        (
            LocalRouteKind::Direct,
            vec!["multiple_direct_candidates".to_string()],
        )
    } else {
        (LocalRouteKind::Worker, vec!["fallback_worker".to_string()])
    };

    LocalRouteDecision {
        route,
        reasons,
        profile,
        evidence,
    }
}

pub fn render_local_route_prompt(decision: &LocalRouteDecision) -> String {
    let route_guidance = match decision.route {
        LocalRouteKind::Direct => {
            "Prefer direct answer or the lightest direct callable capability that can finish the job. If capability choice is the blocker, you must use search_sdk to discover the best direct capability and exhaust reasonable low-cost refinements before answering or refusing. Escalate into execute_code_plan when the user wants a concrete deliverable that needs multi-step coordination."
        }
        LocalRouteKind::Worker => {
            "Treat this as analysis, planning, or decomposition work, but keep moving toward completion. If the task depends on unknown runtime capabilities or installed tools, you must use search_sdk and exhaust reasonable low-cost discovery before concluding what is or is not possible. When the task needs multi-step coordination, loops, aggregation, or broad edits, you may use execute_code_plan as a worker execution tool. If verified sources and available capabilities are enough to produce the requested deliverable, do that instead of stopping at recommendations."
        }
    };
    let reasons = if decision.reasons.is_empty() {
        "none".to_string()
    } else {
        decision.reasons.join(", ")
    };
    format!(
        "## Runtime Route Decision\nSelected route: {}\nReason codes: {}\n{}",
        decision.route.as_str(),
        reasons,
        route_guidance
    )
}

pub fn build_local_route_status_meta(decision: &LocalRouteDecision) -> Value {
    json!({
        "route": decision.route.as_str(),
        "reasons": decision.reasons,
        "direct_callable_capability_count": decision.evidence.direct_callable_capability_count,
        "has_programmatic_executor": decision.evidence.has_programmatic_executor,
        "direct_capability_names": decision.evidence.direct_capability_names,
        "has_batch_scope": decision.profile.has_batch_scope,
        "wants_programmatic_logic": decision.profile.wants_programmatic_logic,
        "wants_analysis": decision.profile.wants_analysis,
        "destructive_intent": decision.profile.destructive_intent,
        "approval_sensitive": decision.profile.approval_sensitive,
    })
}

impl TaskProfile {
    fn from_query(query: &str) -> Self {
        let normalized = query.trim().to_lowercase();
        let explicit_route = if contains_any(
            &normalized,
            &[
                "delegated worker",
                "delegate to worker",
                "delegate to a worker",
                "delegate this to a worker",
                "use worker",
                "please use worker",
                "route to worker",
                "use subagent",
                "delegate to subagent",
                "交给子代理",
                "交给 worker",
                "用 worker",
                "codemode",
                "code mode",
                "代码模式",
            ],
        ) {
            Some(LocalRouteKind::Worker)
        } else if contains_any(
            &normalized,
            &["direct", "directly", "直接调用", "直接执行", "直接用"],
        ) {
            Some(LocalRouteKind::Direct)
        } else {
            None
        };

        let has_batch_scope = contains_any(
            &normalized,
            &[
                "all files",
                "all markdown",
                "every file",
                "every log",
                "for each",
                "each repo",
                "batch",
                "scan every",
                "遍历",
                "批量",
                "全部",
                "所有",
                "逐个",
                "每个",
            ],
        );
        let wants_analysis = contains_any(
            &normalized,
            &[
                "analyze",
                "analysis",
                "investigate",
                "research",
                "compare",
                "difference",
                "recommendation",
                "recommend",
                "pros/cons",
                "tradeoff",
                "impact",
                "migration plan",
                "risk",
                "fallback",
                "boundary",
                "分析",
                "调研",
                "评估",
                "对比",
                "区别",
                "方案",
                "影响",
                "风险",
                "边界",
                "建议",
            ],
        );
        let destructive_intent = contains_any(
            &normalized,
            &[
                "delete",
                "remove",
                "drop",
                "revoke",
                "disable",
                "uninstall",
                "reset",
                "purge",
                "clear cache",
                "删除",
                "移除",
                "清理",
                "清空",
                "禁用",
                "卸载",
                "重置",
            ],
        );
        let approval_sensitive = contains_any(
            &normalized,
            &[
                "token",
                "key",
                "password",
                "account",
                "billing",
                "payment",
                "provider config",
                "provider",
                "config",
                "env",
                "database",
                "cache",
                "权限",
                "密钥",
                "账号",
                "支付",
                "配置",
                "环境变量",
                "数据库",
                "缓存",
            ],
        );
        let wants_programmatic_logic = contains_any(
            &normalized,
            &[
                "script",
                "programmatically",
                "automation",
                "pipeline",
                "aggregate",
                "dedup",
                "extract",
                "manifest",
                "rename",
                "directory tree",
                "json",
                "csv",
                "table",
                "脚本",
                "自动化",
                "汇总",
                "聚合",
                "去重",
                "提取",
                "目录树",
                "重命名",
                "生成清单",
                "生成 json",
            ],
        ) || (has_batch_scope
            && contains_any(
                &normalized,
                &[
                    "markdown", "md", "file", "files", "repo", "repos", "log", "logs", "目录",
                    "文件", "仓库", "日志",
                ],
            ));

        let wants_single_action = !wants_programmatic_logic && !wants_analysis;

        Self {
            explicit_route,
            has_batch_scope,
            wants_programmatic_logic,
            wants_analysis,
            wants_single_action,
            destructive_intent,
            approval_sensitive,
        }
    }
}

impl RouteEvidence {
    pub fn from_search_result(search_result: &Value) -> Self {
        let callable_direct_capability_names =
            extract_callable_direct_capability_names(search_result).unwrap_or_default();
        let direct_callable_capability_count = search_result
            .pointer("/routing_hint/direct_callable_capability_count")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(callable_direct_capability_names.len());
        let capabilities = search_result
            .get("capabilities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let any_mutating_capability = capabilities.iter().any(|item| {
            item.get("mutating")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        });
        let any_high_risk_capability = capabilities.iter().any(|item| {
            item.get("risk_level")
                .and_then(Value::as_str)
                .is_some_and(|value| matches!(value, "high" | "critical"))
        });
        let direct_capability_names = callable_direct_capability_names
            .iter()
            .take(3)
            .cloned()
            .collect::<Vec<_>>();
        let has_programmatic_executor = search_result
            .get("orchestration_primitives")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("name").and_then(Value::as_str) == Some("execute_code_plan")
                })
            })
            || search_result
                .pointer("/routing_hint/programmatic_path")
                .and_then(Value::as_str)
                == Some("execute_code_plan");

        Self {
            direct_callable_capability_count,
            has_programmatic_executor,
            any_mutating_capability,
            any_high_risk_capability,
            direct_capability_names,
            callable_direct_capability_names,
        }
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles
        .iter()
        .any(|needle| !needle.is_empty() && haystack.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programmatic_queries_route_to_worker_when_executor_exists() {
        let decision = select_local_route(
            "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
            &json!({
                "orchestration_primitives": [{ "name": "execute_code_plan" }],
                "capabilities": [],
                "routing_hint": { "programmatic_path": "execute_code_plan" }
            }),
        );

        assert_eq!(decision.route, LocalRouteKind::Worker);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason == "programmatic_logic"));
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason == "programmatic_executor_available"));
    }

    #[test]
    fn codemode_phrase_is_treated_as_worker_route_hint() {
        let decision = select_local_route(
            "请用 code mode 处理这个多步文件整理任务",
            &json!({
                "routing_hint": { "programmatic_path": "execute_code_plan" }
            }),
        );

        assert_eq!(decision.route, LocalRouteKind::Worker);
        assert_eq!(decision.reasons, vec!["explicit_route".to_string()]);
    }
}
