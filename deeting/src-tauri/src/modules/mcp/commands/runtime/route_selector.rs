use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum LocalRouteKind {
    Direct,
    Worker,
    CodeMode,
}

impl LocalRouteKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Worker => "worker",
            Self::CodeMode => "codemode",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct TaskProfile {
    pub(crate) explicit_route: Option<LocalRouteKind>,
    pub(crate) has_batch_scope: bool,
    pub(crate) wants_programmatic_logic: bool,
    pub(crate) wants_analysis: bool,
    pub(crate) wants_single_action: bool,
    pub(crate) destructive_intent: bool,
    pub(crate) approval_sensitive: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct RouteEvidence {
    pub(crate) direct_callable_capability_count: usize,
    pub(crate) has_code_mode_executor: bool,
    pub(crate) any_mutating_capability: bool,
    pub(crate) any_high_risk_capability: bool,
    pub(crate) direct_capability_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct LocalRouteDecision {
    pub(crate) route: LocalRouteKind,
    pub(crate) reasons: Vec<String>,
    pub(crate) profile: TaskProfile,
    pub(crate) evidence: RouteEvidence,
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn select_local_route(query: &str, search_result: &Value) -> LocalRouteDecision {
    select_local_route_with_evidence(query, RouteEvidence::from_search_result(search_result))
}

pub(crate) fn select_local_route_with_evidence(
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
        && evidence.has_code_mode_executor
        && (!profile.wants_analysis || profile.has_batch_scope)
    {
        let mut reasons = Vec::new();
        if profile.has_batch_scope {
            reasons.push("batch_scope".to_string());
        }
        reasons.push("programmatic_logic".to_string());
        reasons.push("code_executor_available".to_string());
        (LocalRouteKind::CodeMode, reasons)
    } else if profile.wants_analysis {
        (LocalRouteKind::Worker, vec!["analysis_request".to_string()])
    } else if evidence.direct_callable_capability_count == 1 && profile.wants_single_action {
        (
            LocalRouteKind::Direct,
            vec!["single_direct_callable".to_string()],
        )
    } else if evidence.direct_callable_capability_count > 1 && profile.wants_single_action {
        (
            LocalRouteKind::Worker,
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

pub(crate) fn render_local_route_prompt(decision: &LocalRouteDecision) -> String {
    let route_guidance = match decision.route {
        LocalRouteKind::Direct => {
            "Prefer direct answer or one direct callable capability. Do not escalate into execute_code_plan unless the user clearly needs programmatic orchestration."
        }
        LocalRouteKind::Worker => {
            "Treat this as analysis/planning/decomposition work. Prefer reasoning and structured recommendations over programmatic execution."
        }
        LocalRouteKind::CodeMode => {
            "Treat this as programmatic orchestration work. Prefer search_sdk plus execute_code_plan when execution is required."
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

pub(crate) fn build_local_route_status_meta(decision: &LocalRouteDecision) -> Value {
    json!({
        "route": decision.route.as_str(),
        "reasons": decision.reasons,
        "direct_callable_capability_count": decision.evidence.direct_callable_capability_count,
        "has_code_mode_executor": decision.evidence.has_code_mode_executor,
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
        let explicit_route = if contains_any(&normalized, &["codemode", "code mode", "代码模式"])
        {
            Some(LocalRouteKind::CodeMode)
        } else if contains_any(
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
    pub(crate) fn from_search_result(search_result: &Value) -> Self {
        let direct_callable_capability_count = search_result
            .pointer("/routing_hint/direct_callable_capability_count")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or_else(|| {
                search_result
                    .get("capabilities")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter(|item| {
                                item.pointer("/status/callable")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false)
                            })
                            .count()
                    })
                    .unwrap_or(0)
            });
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
        let direct_capability_names = capabilities
            .iter()
            .filter(|item| {
                item.pointer("/status/callable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .filter_map(|item| item.get("name").and_then(Value::as_str))
            .take(3)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let has_code_mode_executor = search_result
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
            has_code_mode_executor,
            any_mutating_capability,
            any_high_risk_capability,
            direct_capability_names,
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

    struct RouteCase {
        name: &'static str,
        query: &'static str,
        direct_callable_capability_count: usize,
        has_code_mode_executor: bool,
        mutating: bool,
        high_risk: bool,
        expected_route: LocalRouteKind,
        expected_reason: &'static str,
    }

    #[test]
    fn select_local_route_handles_twenty_bilingual_cases() {
        let cases = [
            RouteCase {
                name: "explicit direct mixed",
                query: "直接调用 search_web 抓一下这个页面标题",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "explicit_route",
            },
            RouteCase {
                name: "explicit worker english",
                query: "Please use worker to analyze this auth refactor",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "explicit_route",
            },
            RouteCase {
                name: "explicit codemode chinese english",
                query: "用 codemode 遍历所有 markdown 然后生成目录树",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::CodeMode,
                expected_reason: "explicit_route",
            },
            RouteCase {
                name: "delete provider config",
                query: "删除这个 provider 配置并清理 cache",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: true,
                high_risk: true,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "destructive_intent",
            },
            RouteCase {
                name: "reset api token",
                query: "reset the API token and revoke old keys",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: true,
                high_risk: true,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "approval_sensitive",
            },
            RouteCase {
                name: "single image generation",
                query: "Generate one image of a neon cat",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "single_direct_callable",
            },
            RouteCase {
                name: "single search web mixed",
                query: "search_web 查一下这个官网标题",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "single_direct_callable",
            },
            RouteCase {
                name: "batch markdown json",
                query: "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::CodeMode,
                expected_reason: "programmatic_logic",
            },
            RouteCase {
                name: "aggregate logs",
                query: "Scan every log file and aggregate error counts by service",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::CodeMode,
                expected_reason: "programmatic_logic",
            },
            RouteCase {
                name: "rename png manifest",
                query: "批量 rename 这个目录下所有 png files 并生成 manifest",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::CodeMode,
                expected_reason: "programmatic_logic",
            },
            RouteCase {
                name: "runtime refactor analysis",
                query: "分析一下 desktop runtime 重构对 subagent 的影响",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "compare orchestration plans",
                query: "Compare these two orchestration plans and give me a recommendation",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "boundary research",
                query: "调研一下 search_sdk 和 execute_code_plan 的边界",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "delegation tradeoff",
                query: "Summarize the pros/cons of moving image_generation into delegation layer",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "explicit worker migration",
                query: "Please delegate this to a worker and produce a migration plan",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "explicit_route",
            },
            RouteCase {
                name: "risk and fallback",
                query: "列出这个方案的风险点和 fallback",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "readmes into table",
                query: "为每个 repo 读取 README, extract TODOs, then merge into one table",
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::CodeMode,
                expected_reason: "programmatic_logic",
            },
            RouteCase {
                name: "disable skill remove cache",
                query: "disable this skill and remove local cache",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: true,
                high_risk: true,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "destructive_intent",
            },
            RouteCase {
                name: "capability vs recipe",
                query: "What's the difference between recipe and capability here?",
                direct_callable_capability_count: 2,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Worker,
                expected_reason: "analysis_request",
            },
            RouteCase {
                name: "single weather lookup",
                query: "打开 weather tool 查一下今天上海天气",
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                mutating: false,
                high_risk: false,
                expected_route: LocalRouteKind::Direct,
                expected_reason: "single_direct_callable",
            },
        ];

        for case in cases {
            let decision = select_local_route(
                case.query,
                &fake_search_result(
                    case.direct_callable_capability_count,
                    case.has_code_mode_executor,
                    case.mutating,
                    case.high_risk,
                ),
            );
            assert_eq!(decision.route, case.expected_route, "case={}", case.name);
            assert!(
                decision
                    .reasons
                    .iter()
                    .any(|reason| reason == case.expected_reason),
                "case={} reasons={:?}",
                case.name,
                decision.reasons
            );
        }
    }

    #[test]
    fn render_local_route_prompt_mentions_selected_route() {
        let decision = select_local_route(
            "遍历所有 markdown files，抽标题后输出 JSON",
            &fake_search_result(0, true, false, false),
        );
        let prompt = render_local_route_prompt(&decision);

        assert!(prompt.contains("## Runtime Route Decision"));
        assert!(prompt.contains("Selected route: codemode"));
        assert!(prompt.contains("execute_code_plan"));
    }

    fn fake_search_result(
        direct_callable_capability_count: usize,
        has_code_mode_executor: bool,
        mutating: bool,
        high_risk: bool,
    ) -> Value {
        let capabilities = (0..direct_callable_capability_count)
            .map(|index| {
                json!({
                    "name": format!("capability_{}", index + 1),
                    "status": { "callable": true },
                    "mutating": mutating && index == 0,
                    "risk_level": if high_risk && index == 0 { "high" } else { "low" },
                })
            })
            .collect::<Vec<_>>();
        let orchestration_primitives = if has_code_mode_executor {
            vec![json!({ "name": "execute_code_plan" })]
        } else {
            Vec::new()
        };

        json!({
            "capabilities": capabilities,
            "orchestration_primitives": orchestration_primitives,
            "routing_hint": {
                "direct_callable_capability_count": direct_callable_capability_count,
                "programmatic_path": if has_code_mode_executor { "execute_code_plan" } else { "" },
            }
        })
    }
}
