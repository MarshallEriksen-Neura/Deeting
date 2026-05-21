use super::*;
use crate::modules::desktop_runtime::local_orchestrator::workflow::LayerExecutionMode;
use crate::modules::desktop_runtime::runtime::worker_dispatch::select_custom_task_agent_candidate;
use futures_util::future::BoxFuture;

fn layer_mode_label(mode: LayerExecutionMode) -> &'static str {
    match mode {
        LayerExecutionMode::Sequential => "sequential",
        LayerExecutionMode::Parallel => "parallel",
    }
}

#[derive(Default, Clone)]
struct EngineTestContext {
    applied_steps: Vec<String>,
    system_messages: Vec<String>,
    status_codes: Vec<String>,
    selected_prompt_variant: Option<String>,
    metrics: Vec<Value>,
    layer_started: Vec<String>,
    layer_finished: Vec<String>,
}

impl StepResultContext for EngineTestContext {
    type Patch = ContextPatch;

    fn apply_step_result(
        &mut self,
        step_name: &str,
        result: StepResult<Self::Patch>,
    ) -> Result<(), String> {
        let StepResult {
            status,
            system_messages,
            patches,
            events: _,
            metrics,
        } = result;

        for message in system_messages {
            self.system_messages.push(message);
        }
        for patch in patches {
            match patch {
                ContextPatch::SetSelectedPromptVariant(selected_prompt_variant) => {
                    self.selected_prompt_variant = selected_prompt_variant;
                }
                ContextPatch::EmitStatus(status_patch) => {
                    self.status_codes.push(status_patch.code);
                }
                _ => {}
            }
        }
        if let Some(metrics) = metrics {
            self.metrics.push(metrics);
        }
        self.applied_steps
            .push(format!("{}:{}", step_name, status.as_str()));
        Ok(())
    }

    fn before_layer_execution(
        &mut self,
        layer_index: usize,
        layer_steps: &[String],
        mode: LayerExecutionMode,
    ) -> Result<(), String> {
        self.layer_started.push(format!(
            "{}:{}:{}",
            layer_index + 1,
            layer_mode_label(mode),
            layer_steps.join(",")
        ));
        Ok(())
    }

    fn after_layer_execution(
        &mut self,
        layer_index: usize,
        layer_steps: &[String],
        mode: LayerExecutionMode,
    ) -> Result<(), String> {
        self.layer_finished.push(format!(
            "{}:{}:{}",
            layer_index + 1,
            layer_mode_label(mode),
            layer_steps.join(",")
        ));
        Ok(())
    }

    fn supports_parallel_snapshot(&self) -> bool {
        true
    }

    fn clone_for_parallel(&self) -> Result<Self, String> {
        Ok(self.clone())
    }
}

struct TestStep {
    name: &'static str,
    deps: &'static [&'static str],
    system_message: Option<&'static str>,
    status_code: Option<&'static str>,
    selected_prompt_variant: Option<&'static str>,
    metric_name: Option<&'static str>,
}

impl LocalWorkflowStep<EngineTestContext> for TestStep {
    fn name(&self) -> &'static str {
        self.name
    }

    fn depends_on(&self) -> &'static [&'static str] {
        self.deps
    }

    fn execute<'a>(
        &'a self,
        _ctx: &'a mut EngineTestContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let mut result = StepResult::success();
            if let Some(message) = self.system_message {
                result = result.with_system_message(message);
            }
            if let Some(selected_prompt_variant) = self.selected_prompt_variant {
                result = result.with_patch(ContextPatch::SetSelectedPromptVariant(Some(
                    selected_prompt_variant.to_string(),
                )));
            }
            if let Some(status_code) = self.status_code {
                result = result.with_patch(status_patch(
                    "test",
                    Some(self.name),
                    "success",
                    status_code,
                    None,
                ));
            }
            if let Some(metric_name) = self.metric_name {
                result = result.with_metrics(json!({ "name": metric_name }));
            }
            Ok(result)
        })
    }
}

#[test]
fn engine_builds_layers_for_linear_dependencies() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &[],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &["step_a"],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_c",
            deps: &["step_b"],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
    ];

    let engine = LocalOrchestrationEngine::new(steps).expect("engine should build without errors");
    let layers = engine.debug_layers();

    assert_eq!(layers.len(), 3);
    assert_eq!(layers[0], vec!["step_a".to_string()]);
    assert_eq!(layers[1], vec!["step_b".to_string()]);
    assert_eq!(layers[2], vec!["step_c".to_string()]);
}

#[test]
fn engine_fails_on_unknown_dependency() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &[],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &["unknown_step"],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
    ];

    let result = LocalOrchestrationEngine::new(steps);
    assert!(result.is_err());
    let msg = result.err().unwrap();
    assert!(msg.contains("depends on unknown step"));
}

#[test]
fn engine_fails_on_cycle() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &["step_b"],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &["step_a"],
            system_message: None,
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
    ];

    let result = LocalOrchestrationEngine::new(steps);
    assert!(result.is_err());
    let msg = result.err().unwrap();
    assert!(msg.contains("cyclic dependencies"));
}

#[tokio::test]
async fn engine_executes_and_applies_step_results_centrally() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &[],
            system_message: Some("summary"),
            status_code: Some("summary.loaded"),
            selected_prompt_variant: None,
            metric_name: Some("summary"),
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &["step_a"],
            system_message: Some("style"),
            status_code: Some("prompt.variant.selected"),
            selected_prompt_variant: Some("concise"),
            metric_name: None,
        }),
    ];

    let engine = LocalOrchestrationEngine::new(steps).expect("engine should build");
    let mut ctx = EngineTestContext::default();
    engine
        .execute(&mut ctx)
        .await
        .expect("engine should execute successfully");

    assert_eq!(
        ctx.applied_steps,
        vec!["step_a:success".to_string(), "step_b:success".to_string()]
    );
    assert_eq!(ctx.system_messages, vec!["summary", "style"]);
    assert_eq!(
        ctx.status_codes,
        vec![
            "summary.loaded".to_string(),
            "prompt.variant.selected".to_string()
        ]
    );
    assert_eq!(ctx.selected_prompt_variant.as_deref(), Some("concise"));
    assert_eq!(ctx.metrics.len(), 1);
    assert_eq!(
        ctx.metrics[0].get("name").and_then(Value::as_str),
        Some("summary")
    );
    assert_eq!(
        ctx.layer_started,
        vec![
            "1:sequential:step_a".to_string(),
            "2:sequential:step_b".to_string()
        ]
    );
    assert_eq!(
        ctx.layer_finished,
        vec![
            "1:sequential:step_a".to_string(),
            "2:sequential:step_b".to_string()
        ]
    );
}

#[tokio::test]
async fn engine_rejects_conflicting_parallel_layer_patches() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &[],
            system_message: None,
            status_code: None,
            selected_prompt_variant: Some("detailed"),
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &[],
            system_message: None,
            status_code: None,
            selected_prompt_variant: Some("concise"),
            metric_name: None,
        }),
    ];

    let engine = LocalOrchestrationEngine::new(steps).expect("engine should build");
    let mut ctx = EngineTestContext::default();
    let error = engine
        .execute(&mut ctx)
        .await
        .expect_err("conflicting layer patches should fail");

    assert!(error.contains("conflicting"));
    assert!(error.contains("set_selected_prompt_variant"));
}

#[tokio::test]
async fn engine_marks_parallel_layer_execution_mode() {
    let steps: Vec<Box<dyn LocalWorkflowStep<EngineTestContext>>> = vec![
        Box::new(TestStep {
            name: "step_a",
            deps: &[],
            system_message: Some("a"),
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_b",
            deps: &[],
            system_message: Some("b"),
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
        Box::new(TestStep {
            name: "step_c",
            deps: &["step_a", "step_b"],
            system_message: Some("c"),
            status_code: None,
            selected_prompt_variant: None,
            metric_name: None,
        }),
    ];

    let engine = LocalOrchestrationEngine::new(steps).expect("engine should build");
    let mut ctx = EngineTestContext::default();
    engine.execute(&mut ctx).await.expect("engine executes");

    assert_eq!(ctx.layer_started.len(), 2);
    assert_eq!(ctx.layer_finished.len(), 2);
    assert!(ctx.layer_started[0].contains(":parallel:"));
    assert!(ctx.layer_finished[0].contains(":parallel:"));
    assert!(ctx.layer_started[1].contains(":sequential:"));
    assert!(ctx.layer_finished[1].contains(":sequential:"));
}

#[test]
fn render_local_router_base_prompt_includes_date_timezone_and_language() {
    let prompt = render_local_router_base_prompt(
        "2026-03-08",
        "Asia/Shanghai",
        "Simplified Chinese (zh-CN)",
    );

    assert!(prompt.contains("## Current Context"));
    assert!(prompt.contains("- Current local date: 2026-03-08"));
    assert!(prompt.contains("- Current local timezone: Asia/Shanghai"));
    assert!(prompt.contains("## Core Routing Rules"));
    assert!(prompt.contains("Default response language: Simplified Chinese (zh-CN)."));
    assert!(prompt.contains("If the user explicitly requests another language"));
    assert!(prompt.contains("When a retrieved semantic memory contains a direct user fact"));
    assert!(prompt.contains("Do not fabricate facts, tool results, files, system state"));
}

#[test]
fn render_local_runtime_system_prompt_adds_runtime_and_code_sections() {
    let prompt = render_local_runtime_system_prompt(
        "## Current Context",
        Some("search_sdk, shell_execute"),
        Some("execute_code_plan"),
    );

    assert!(prompt.contains("## Current Context"));
    assert!(prompt.contains("## Runtime Capability Contract"));
    assert!(prompt.contains("search_sdk, shell_execute"));
    assert!(prompt.contains("## Execution Tool Protocol"));
    assert!(prompt.contains("execute_code_plan"));
    assert!(prompt.contains("## User-Visible Tool Call Updates"));
    assert!(prompt.contains("Before a user-visible tool call"));
    assert!(prompt.contains("Do not repeat the same pre-tool note"));
}

#[test]
fn render_local_runtime_system_prompt_omits_optional_sections_when_not_requested() {
    let prompt = render_local_runtime_system_prompt("## Current Context", None, None);

    assert!(prompt.contains("## Current Context"));
    assert!(!prompt.contains("## Runtime Capability Contract"));
    assert!(!prompt.contains("## Execution Tool Protocol"));
    assert!(prompt.contains("## User-Visible Tool Call Updates"));
}

#[test]
fn build_local_prompt_plan_always_includes_pre_tool_visibility_guidance() {
    let rendered = build_local_prelude_messages(&PromptAssets::default(), None)
        .first()
        .map(|message| message.content.clone())
        .unwrap_or_default();

    assert!(rendered.contains("## User-Visible Tool Call Updates"));
    assert!(rendered
        .contains("briefly state what you are about to check or do in one natural sentence"));
    assert!(
        rendered.contains("Do not add a pre-tool note when you can answer directly without tools")
    );
}

#[test]
fn build_local_prompt_plan_omits_execution_tool_protocol_without_policy() {
    let rendered = build_local_prelude_messages(
        &PromptAssets::default(),
        Some(&build_default_local_execution_policy()),
    )
    .first()
    .map(|message| message.content.clone())
    .unwrap_or_default();

    assert!(rendered.contains("## Current Context"));
    assert!(!rendered.contains("## Runtime Capability Contract"));
    assert!(!rendered.contains("## Execution Tool Protocol"));
}

#[test]
fn build_local_prompt_plan_includes_runtime_capability_contract_for_direct_policy() {
    let policy = build_local_execution_policy(&select_local_route(
        "检查当前目录",
        &json!({
            "capabilities": [
                { "name": "shell_execute", "status": { "callable": true }, "invocation_mode": "direct" }
            ],
            "routing_hint": { "direct_callable_capability_count": 1 }
        }),
    ));
    let rendered = build_local_prelude_messages(&PromptAssets::default(), Some(&policy))
        .first()
        .map(|message| message.content.clone())
        .unwrap_or_default();

    assert!(rendered.contains("## Runtime Capability Contract"));
    assert!(rendered.contains("search_sdk"));
    assert!(!rendered.contains("## Execution Tool Protocol"));
}

#[test]
fn build_local_prompt_plan_includes_code_orchestration_protocol_from_worker_policy() {
    let policy = build_local_execution_policy(&select_local_route(
        "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
        &json!({
            "orchestration_primitives": [{ "name": "execute_code_plan" }],
            "capabilities": [],
            "routing_hint": { "programmatic_path": "execute_code_plan" }
        }),
    ));
    assert_eq!(policy.route, LocalRouteKind::Worker);
    let rendered = build_local_prelude_messages(&PromptAssets::default(), Some(&policy))
        .first()
        .map(|message| message.content.clone())
        .unwrap_or_default();

    assert!(rendered.contains("## Current Context"));
    assert!(rendered.contains("## Runtime Capability Contract"));
    assert!(rendered.contains("## Execution Tool Protocol"));
    assert!(rendered.contains("search_sdk"));
    assert!(rendered.contains("execute_code_plan"));
}

#[test]
fn build_route_selection_status_meta_embeds_execution_policy() {
    let decision = select_local_route(
        "遍历所有 markdown files，抽标题、分类、去重后输出 JSON",
        &json!({
            "orchestration_primitives": [{ "name": "execute_code_plan" }],
            "capabilities": [],
            "routing_hint": { "programmatic_path": "execute_code_plan" }
        }),
    );
    let policy = build_local_execution_policy(&decision);
    let meta = build_local_control_plane_status_meta(&decision, &policy);

    assert_eq!(meta.get("route").and_then(Value::as_str), Some("worker"));
    assert_eq!(
        meta.get("execution_policy")
            .and_then(|value| value.get("plane"))
            .and_then(Value::as_str),
        Some("worker_reasoning")
    );
}

#[test]
fn render_skill_recipe_prompt_defers_execution_truth_to_search_sdk() {
    let prompt = render_skill_recipe_prompt(
        &[json!({
            "name": "Planner",
            "description": "Design execution plans",
            "docs_excerpt": "Read the planning checklist before execution.",
            "docs_paths": ["SKILL.md", "examples/plan.md"],
            "status": {
                "recommended_action": "read_skill_docs",
                "reason": "skill_routed_via_docs"
            },
            "entry": {
                "backend": "main.py"
            }
        })],
        &[],
    )
    .expect("skill recipe prompt");

    assert!(prompt.contains("## Installed Skills"));
    assert!(prompt.contains("Planner"));
    assert!(prompt.contains("recipe preview is not the full skill"));
    assert!(prompt.contains("call `activate_skill`"));
    assert!(prompt.contains("read_skill_resource"));
    assert!(prompt.contains("`shell_execute`"));
    assert!(prompt.contains("actual host command execution"));
    assert!(prompt.contains("Next: activate_skill"));
    assert!(prompt.contains("read_skill_docs"));
    assert!(prompt.contains("SKILL.md"));
    assert!(prompt.contains("Bundle backend: main.py"));
    assert!(!prompt.contains("ui/index.html"));
}

#[test]
fn extract_explicit_skill_mentions_deduplicates_dollar_skill_names() {
    let mentions = extract_explicit_skill_mentions(
        "Use $planner, then $official.skills.planner and ignore $100.",
    );

    assert_eq!(
        mentions,
        vec!["planner".to_string(), "official.skills.planner".to_string()]
    );
}

#[test]
fn render_skill_recipe_prompt_prioritizes_explicit_skill_mentions() {
    let prompt = render_skill_recipe_prompt(
        &[
            json!({
                "name": "Writer",
                "description": "Draft prose",
                "skill_id": "official.skills.writer",
            }),
            json!({
                "name": "Planner",
                "description": "Design execution plans",
                "skill_id": "official.skills.planner",
            }),
        ],
        &["planner".to_string()],
    )
    .expect("skill recipe prompt");

    let planner_index = prompt.find("- Planner -").expect("planner line");
    let writer_index = prompt.find("- Writer -").expect("writer line");
    assert!(planner_index < writer_index);
    assert!(prompt.contains("Explicit user skill mentions in this request: $planner"));
    assert!(prompt.contains("Explicit mention match: true"));
    assert!(prompt.contains("Next: activate_skill(skill_id=\"official.skills.planner\")"));
}

#[test]
fn desktop_local_chat_engine_includes_route_selection_before_recipe_and_template() {
    let engine = build_desktop_local_chat_engine().expect("engine should build");
    let layers = engine.debug_layers();

    let route_index = layers
        .iter()
        .position(|layer| layer.iter().any(|name| name == "route_selection"))
        .expect("route_selection layer");
    let recipe_index = layers
        .iter()
        .position(|layer| layer.iter().any(|name| name == "skill_recipe_injection"))
        .expect("skill_recipe_injection layer");
    let template_index = layers
        .iter()
        .position(|layer| layer.iter().any(|name| name == "template_render"))
        .expect("template_render layer");

    assert!(route_index < recipe_index);
    assert!(route_index < template_index);
}

#[test]
fn desktop_local_chat_engine_uses_context_manifest_without_body_injection_steps() {
    let engine = build_desktop_local_chat_engine().expect("engine should build");
    let layers = engine.debug_layers();

    let manifest_index = layers
        .iter()
        .position(|layer| layer.iter().any(|name| name == "context_manifest"))
        .expect("context_manifest layer");
    let artifact_index = layers
        .iter()
        .position(|layer| {
            layer
                .iter()
                .any(|name| name == "generated_artifact_context_injection")
        })
        .expect("generated_artifact_context_injection layer");
    let template_index = layers
        .iter()
        .position(|layer| layer.iter().any(|name| name == "template_render"))
        .expect("template_render layer");

    assert!(manifest_index < artifact_index);
    assert!(manifest_index < template_index);
    assert!(!layers
        .iter()
        .flatten()
        .any(|name| name == "semantic_memory_injection"));
    assert!(!layers
        .iter()
        .flatten()
        .any(|name| name == "selected_knowledge_injection"));
}

#[test]
fn reusable_pinned_provider_model_id_requires_requested_pool_match() {
    let binding = LocalConversationModelBinding {
        pinned_model_key: Some("qwen-max".to_string()),
        pinned_provider_model_id: Some("provider-model-a".to_string()),
        pinned_binding_source: Some("pool_selection".to_string()),
    };

    assert_eq!(
        reusable_pinned_provider_model_id(Some(&binding), "qwen-max"),
        Some("provider-model-a")
    );
    assert_eq!(
        reusable_pinned_provider_model_id(Some(&binding), "provider-model-a"),
        Some("provider-model-a")
    );
    assert_eq!(
        reusable_pinned_provider_model_id(Some(&binding), "deepseek-v3"),
        None
    );
}

fn test_bandit_arm(
    last_reward: f64,
    cooldown_until: Option<&str>,
) -> crate::modules::providers::types::BanditArmState {
    crate::modules::providers::types::BanditArmState {
        id: "bandit-arm-state".to_string(),
        provider_model_id: None,
        scene: "router:llm".to_string(),
        arm_id: Some("provider-model-a".to_string()),
        reward_metric_type: None,
        strategy: "epsilon_greedy".to_string(),
        epsilon: 0.1,
        alpha: 1.0,
        beta: 1.0,
        total_trials: 1,
        successes: if last_reward > 0.0 { 1 } else { 0 },
        failures: if last_reward > 0.0 { 0 } else { 1 },
        total_latency_ms: 1000,
        latency_p95_ms: None,
        total_cost: 0.0,
        last_reward,
        cooldown_until: cooldown_until.map(str::to_string),
        version: 1,
        created_at: "2026-05-21T00:00:00Z".to_string(),
        updated_at: "2026-05-21T00:00:00Z".to_string(),
    }
}

#[test]
fn bandit_arm_allows_pinned_reuse_rejects_recent_failure_or_cooldown() {
    assert!(bandit_arm_allows_pinned_reuse(None, "2026-05-21T10:00:00Z"));
    assert!(bandit_arm_allows_pinned_reuse(
        Some(&test_bandit_arm(1.0, None)),
        "2026-05-21T10:00:00Z"
    ));
    assert!(!bandit_arm_allows_pinned_reuse(
        Some(&test_bandit_arm(0.0, None)),
        "2026-05-21T10:00:00Z"
    ));
    assert!(!bandit_arm_allows_pinned_reuse(
        Some(&test_bandit_arm(1.0, Some("2026-05-21T11:00:00Z"))),
        "2026-05-21T10:00:00Z"
    ));
}

#[test]
fn pool_request_matches_model_connection_checks_pool_key_model_id_and_provider_member() {
    let connection = crate::modules::ai_upstream::types::LocalModelConnection {
        provider_model_id: "provider-model-a".to_string(),
        model_id: "gpt-4o".to_string(),
        logical_model_key: Some("gpt-4o".to_string()),
        protocol_family: "openai".to_string(),
    };

    assert!(pool_request_matches_model_connection("gpt-4o", &connection));
    assert!(pool_request_matches_model_connection(
        "provider-model-a",
        &connection
    ));
    assert!(!pool_request_matches_model_connection(
        "deepseek-v1",
        &connection
    ));
}

#[test]
fn parse_router_prompt_local_context_parses_date_and_timezone() {
    let ctx = parse_router_prompt_local_context("2026-03-08|Asia/Shanghai\n")
        .expect("local context should parse");

    assert_eq!(ctx.current_date, "2026-03-08");
    assert_eq!(ctx.timezone, "Asia/Shanghai");
}

#[test]
fn default_local_context_has_non_empty_date_and_timezone() {
    let ctx = router_prompt_default_local_context();

    assert!(!ctx.current_date.trim().is_empty());
    assert!(!ctx.timezone.trim().is_empty());
}

#[test]
fn router_prompt_default_response_language_maps_locale_preference() {
    assert_eq!(
        router_prompt_response_language_for_locale_pref(true),
        "Simplified Chinese (zh-CN)"
    );
    assert_eq!(
        router_prompt_response_language_for_locale_pref(false),
        "English (en)"
    );
}

#[test]
fn build_compare_only_messages_removes_latest_assistant_answer() {
    let messages = vec![
        mcp_session::conversation::LocalConversationHistoryMessage {
            role: "user".to_string(),
            content: Some(json!("first question")),
            turn_index: Some(1),
            created_at: None,
            is_truncated: Some(false),
            name: None,
            meta_info: None,
        },
        mcp_session::conversation::LocalConversationHistoryMessage {
            role: "assistant".to_string(),
            content: Some(json!("first answer")),
            turn_index: Some(2),
            created_at: None,
            is_truncated: Some(false),
            name: None,
            meta_info: None,
        },
        mcp_session::conversation::LocalConversationHistoryMessage {
            role: "user".to_string(),
            content: Some(json!("second question")),
            turn_index: Some(3),
            created_at: None,
            is_truncated: Some(false),
            name: None,
            meta_info: None,
        },
        mcp_session::conversation::LocalConversationHistoryMessage {
            role: "assistant".to_string(),
            content: Some(json!("baseline answer")),
            turn_index: Some(4),
            created_at: None,
            is_truncated: Some(false),
            name: None,
            meta_info: None,
        },
    ];

    let snapshot = build_compare_only_messages(messages).expect("compare snapshot");
    assert_eq!(snapshot.len(), 3);
    assert_eq!(snapshot[0].content, "first question");
    assert_eq!(snapshot[1].content, "first answer");
    assert_eq!(snapshot[2].content, "second question");
}

#[test]
fn build_compare_only_messages_requires_latest_assistant_answer() {
    let messages = vec![mcp_session::conversation::LocalConversationHistoryMessage {
        role: "user".to_string(),
        content: Some(json!("question only")),
        turn_index: Some(1),
        created_at: None,
        is_truncated: Some(false),
        name: None,
        meta_info: None,
    }];

    let error = build_compare_only_messages(messages).expect_err("missing baseline answer");
    assert!(error.contains("latest assistant answer"));
}

#[test]
fn convert_history_message_to_chat_input_preserves_tool_trace_blocks() {
    let assistant = mcp_session::conversation::LocalConversationHistoryMessage {
        role: "assistant".to_string(),
        content: Some(json!("I'll check that.")),
        turn_index: Some(1),
        created_at: None,
        is_truncated: Some(false),
        name: None,
        meta_info: Some(json!({
            "blocks": [
                {
                    "type": "tool_call",
                    "toolCallId": "call-1",
                    "toolName": "search_sdk",
                    "arguments": { "query": "hello" }
                }
            ]
        })),
    };

    let assistant_input = convert_history_message_to_chat_input(assistant);
    assert_eq!(assistant_input.tool_calls.len(), 1);
    assert_eq!(assistant_input.tool_calls[0].id.as_deref(), Some("call-1"));
    assert_eq!(assistant_input.tool_calls[0].name, "search_sdk");
    assert_eq!(
        assistant_input.tool_calls[0].arguments,
        json!({ "query": "hello" })
    );

    let tool = mcp_session::conversation::LocalConversationHistoryMessage {
        role: "tool".to_string(),
        content: Some(json!(r#"{"ok":true}"#)),
        turn_index: Some(2),
        created_at: None,
        is_truncated: Some(false),
        name: Some("search_sdk".to_string()),
        meta_info: Some(json!({
            "blocks": [
                {
                    "type": "tool_result",
                    "toolCallId": "call-1",
                    "toolName": "search_sdk",
                    "status": "success",
                    "result": { "ok": true }
                }
            ]
        })),
    };

    let tool_input = convert_history_message_to_chat_input(tool);
    assert_eq!(tool_input.tool_call_id.as_deref(), Some("call-1"));
    assert_eq!(tool_input.name.as_deref(), Some("search_sdk"));
}

#[test]
fn recall_when_matching_uses_substring_and_keywords() {
    assert!(matches_recall_when(
        "Please keep the response style concise for this reply",
        Some("response style concise")
    ));
    assert!(matches_recall_when(
        "Need architecture help for the current project",
        Some("project architecture")
    ));
    assert!(!matches_recall_when(
        "Discuss the user's favorite movies",
        Some("response style concise")
    ));
}

#[test]
fn injected_memory_promotes_core_tier_to_core_flag() {
    let memory = InjectedMemory::from_item(LocalMemoryItem {
        id: "memory-1".to_string(),
        content: "remember this".to_string(),
        session_id: None,
        capability_id: None,
        meta_info: Some(json!({ "memory_tier": "core", "recall_when": "architecture" })),
        embedding_model: None,
        category: None,
        source: None,
        tags: None,
        vitality: None,
        last_accessed_at: None,
        created_at: "2026-03-09T00:00:00Z".to_string(),
        updated_at: "2026-03-09T00:00:00Z".to_string(),
    });

    assert!(memory.is_core);
    assert!(!memory.is_boot);
    assert_eq!(memory.memory_tier.as_deref(), Some("core"));
    assert_eq!(memory.recall_when.as_deref(), Some("architecture"));
}

#[test]
fn semantic_memory_search_query_is_global() {
    let query = build_global_semantic_memory_search_query("你知道我住在哪里吗");

    assert_eq!(query.query, "你知道我住在哪里吗");
    assert_eq!(query.limit, Some(SEMANTIC_MEMORY_SEARCH_LIMIT));
    assert_eq!(query.session_id, None);
    assert_eq!(query.capability_id, None);
}

#[test]
fn core_memory_list_query_is_global() {
    let query = build_global_memory_list_query(CORE_MEMORY_LIST_LIMIT);

    assert_eq!(query.limit, Some(CORE_MEMORY_LIST_LIMIT));
    assert_eq!(query.session_id, None);
    assert_eq!(query.capability_id, None);
}

#[test]
fn scoped_memory_list_query_preserves_session_and_capability() {
    let query = build_scoped_memory_list_query("session-1", Some("assistant-1"), 5);

    assert_eq!(query.limit, Some(5));
    assert_eq!(query.session_id.as_deref(), Some("session-1"));
    assert_eq!(query.capability_id.as_deref(), Some("assistant-1"));
}

#[test]
fn latest_tool_error_summary_formats_latest_error_for_chinese() {
    let blocks = vec![
        json!({
            "type": "tool_result",
            "toolName": "search_sdk",
            "status": "success",
            "result": {}
        }),
        json!({
            "type": "tool_result",
            "toolName": "skill.official.skills.crawler.fetch_web_content",
            "status": "error",
            "result": {
                "error": "skill binding 'skill.official.skills.crawler.fetch_web_content' failed (exit=1): [!] Error: 'httpx' library not found in the python environment.",
                "error_code": "LOCAL_TOOL_EXECUTION_FAILED"
            }
        }),
    ];

    let summary = latest_tool_error_summary(&blocks, true).expect("tool error summary");

    assert!(summary.contains("工具调用失败"));
    assert!(summary.contains("skill.official.skills.crawler.fetch_web_content"));
    assert!(summary.contains("httpx"));
    assert!(summary.contains("LOCAL_TOOL_EXECUTION_FAILED"));
}

#[test]
fn latest_tool_error_summary_returns_none_without_error_blocks() {
    let blocks = vec![json!({
        "type": "tool_result",
        "toolName": "search_sdk",
        "status": "success",
        "result": {}
    })];

    assert!(latest_tool_error_summary(&blocks, false).is_none());
}

#[test]
fn latest_tool_error_summary_marks_output_encoding_failures() {
    let blocks = vec![json!({
        "type": "tool_result",
        "toolName": "skill.official.skills.crawler.fetch_web_content",
        "status": "error",
        "result": {
            "error": "UnicodeEncodeError: 'gbk' codec can't encode character '\\u200b' in position 17: illegal multibyte sequence",
            "error_code": "LOCAL_TOOL_EXECUTION_FAILED"
        }
    })];

    let summary = latest_tool_error_summary(&blocks, true).expect("tool error summary");

    assert!(summary.contains("本地技能输出编码失败"));
    assert!(summary.contains("skill.official.skills.crawler.fetch_web_content"));
    assert!(summary.contains("LOCAL_TOOL_EXECUTION_FAILED"));
}

#[test]
fn build_selected_document_overview_uses_leading_chunks() {
    let chunks = vec![
            crate::modules::knowledge::types::LocalKnowledgeChunk {
                id: "chunk-1".to_string(),
                file_id: "file-1".to_string(),
                index: 0,
                content: "This document describes the desktop knowledge flow and how selected files should be injected into chat.".to_string(),
                token_count: 16,
                chunk_type: "paragraph".to_string(),
                section_path: vec!["Desktop Knowledge".to_string()],
                page_hint: None,
                char_start: Some(0),
                char_end: Some(108),
                char_count: 108,
                content_hash: Some("hash-1".to_string()),
                quality_flags: Vec::new(),
            },
            crate::modules::knowledge::types::LocalKnowledgeChunk {
                id: "chunk-2".to_string(),
                file_id: "file-1".to_string(),
                index: 1,
                content: "It also explains fallback behavior for generic prompts like summary requests.".to_string(),
                token_count: 12,
                chunk_type: "paragraph".to_string(),
                section_path: vec!["Desktop Knowledge".to_string()],
                page_hint: None,
                char_start: Some(109),
                char_end: Some(186),
                char_count: 77,
                content_hash: Some("hash-2".to_string()),
                quality_flags: vec!["short_chunk".to_string()],
            },
        ];

    let overview = build_selected_document_overview(&chunks).expect("overview should exist");

    assert!(overview.contains("Desktop Knowledge"));
    assert!(overview.contains("desktop knowledge flow"));
    assert!(overview.contains("fallback behavior"));
}

#[test]
fn build_selected_knowledge_fallback_hits_uses_document_leading_chunks() {
    let contexts = vec![SelectedKnowledgeDocumentContext {
        file_id: "file-1".to_string(),
        file_name: "guide.docx".to_string(),
        overview: Some("guide overview".to_string()),
        leading_chunks: vec![
            crate::modules::knowledge::types::LocalKnowledgeChunk {
                id: "chunk-1".to_string(),
                file_id: "file-1".to_string(),
                index: 0,
                content: "first chunk".to_string(),
                token_count: 2,
                chunk_type: "paragraph".to_string(),
                section_path: vec!["Guide".to_string()],
                page_hint: None,
                char_start: Some(0),
                char_end: Some(11),
                char_count: 11,
                content_hash: Some("hash-a".to_string()),
                quality_flags: vec!["short_chunk".to_string()],
            },
            crate::modules::knowledge::types::LocalKnowledgeChunk {
                id: "chunk-2".to_string(),
                file_id: "file-1".to_string(),
                index: 1,
                content: "second chunk".to_string(),
                token_count: 2,
                chunk_type: "paragraph".to_string(),
                section_path: vec!["Guide".to_string()],
                page_hint: None,
                char_start: Some(12),
                char_end: Some(24),
                char_count: 12,
                content_hash: Some("hash-b".to_string()),
                quality_flags: vec!["short_chunk".to_string()],
            },
        ],
    }];

    let hits = build_selected_knowledge_fallback_hits(&contexts, 1);

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].file_name, "guide.docx");
    assert_eq!(hits[0].content, "first chunk");
}

#[test]
fn fuse_selected_knowledge_hits_merges_lexical_and_semantic_candidates() {
    let lexical_hits = vec![
        crate::modules::knowledge::types::LocalKnowledgeSearchHit {
            chunk_id: "chunk-1".to_string(),
            file_id: "file-1".to_string(),
            file_name: "guide.docx".to_string(),
            index: 0,
            content: "lexical overlap".to_string(),
            token_count: 6,
            chunk_type: "paragraph".to_string(),
            section_path: vec!["Guide".to_string(), "Intro".to_string()],
            page_hint: None,
            char_start: Some(0),
            char_end: Some(15),
            char_count: 15,
            content_hash: Some("hash-hit-1".to_string()),
            quality_flags: Vec::new(),
            lexical_score: Some(0.92),
            match_reasons: vec!["fts:body".to_string(), "fts:section".to_string()],
            score_breakdown: Some(json!({ "lexical_score": 0.92 })),
            score: 12.0,
        },
        crate::modules::knowledge::types::LocalKnowledgeSearchHit {
            chunk_id: "chunk-2".to_string(),
            file_id: "file-1".to_string(),
            file_name: "guide.docx".to_string(),
            index: 1,
            content: "lexical only".to_string(),
            token_count: 4,
            chunk_type: "paragraph".to_string(),
            section_path: vec!["Guide".to_string(), "Body".to_string()],
            page_hint: None,
            char_start: Some(16),
            char_end: Some(28),
            char_count: 12,
            content_hash: Some("hash-hit-2".to_string()),
            quality_flags: vec!["short_chunk".to_string()],
            lexical_score: Some(0.71),
            match_reasons: vec!["fts:body".to_string()],
            score_breakdown: Some(json!({ "lexical_score": 0.71 })),
            score: 8.0,
        },
    ];
    let semantic_hits = vec![
        crate::modules::knowledge::types::LocalKnowledgeSearchHit {
            chunk_id: "chunk-3".to_string(),
            file_id: "file-1".to_string(),
            file_name: "guide.docx".to_string(),
            index: 2,
            content: "semantic only".to_string(),
            token_count: 9,
            chunk_type: "paragraph".to_string(),
            section_path: vec!["Guide".to_string(), "Appendix".to_string()],
            page_hint: None,
            char_start: Some(29),
            char_end: Some(42),
            char_count: 13,
            content_hash: Some("hash-hit-3".to_string()),
            quality_flags: Vec::new(),
            lexical_score: None,
            match_reasons: vec!["semantic:topk".to_string()],
            score_breakdown: Some(json!({ "semantic_score": 0.9 })),
            score: 0.9,
        },
        crate::modules::knowledge::types::LocalKnowledgeSearchHit {
            chunk_id: "chunk-1".to_string(),
            file_id: "file-1".to_string(),
            file_name: "guide.docx".to_string(),
            index: 0,
            content: "lexical overlap".to_string(),
            token_count: 6,
            chunk_type: "paragraph".to_string(),
            section_path: vec!["Guide".to_string(), "Intro".to_string()],
            page_hint: None,
            char_start: Some(0),
            char_end: Some(15),
            char_count: 15,
            content_hash: Some("hash-hit-1".to_string()),
            quality_flags: Vec::new(),
            lexical_score: None,
            match_reasons: vec!["semantic:topk".to_string()],
            score_breakdown: Some(json!({ "semantic_score": 0.8 })),
            score: 0.8,
        },
    ];

    let hits = fuse_selected_knowledge_hits(lexical_hits, semantic_hits, 3);

    assert_eq!(hits.len(), 3);
    assert_eq!(hits[0].chunk_id, "chunk-1");
    assert_eq!(hits[1].chunk_id, "chunk-3");
    assert_eq!(hits[2].chunk_id, "chunk-2");
    assert!(hits[0].score > hits[1].score);
    assert!(hits[1].score > hits[2].score);
}

#[test]
fn derive_local_finish_reason_uses_error_for_synthesized_failure_text() {
    assert_eq!(derive_local_finish_reason(&json!({}), true, &[]), "error");
    assert_eq!(derive_local_finish_reason(&json!({}), false, &[]), "stop");
    assert_eq!(
        derive_local_finish_reason(&json!({ "finish_reason": "length" }), false, &[]),
        "length"
    );
}

#[test]
fn derive_local_finish_reason_uses_blocked_for_pending_approval() {
    assert_eq!(
        derive_local_finish_reason(
            &json!({ "finish_reason": "stop" }),
            false,
            &[json!({
                "type": "tool_result",
                "status": "requires_approval",
                "result": { "approval_token": "approval-1" }
            })],
        ),
        "blocked"
    );

    assert_eq!(
        derive_local_finish_reason(
            &json!({
                "execution_graph": {
                    "nodes": [{
                        "node_id": "approval_gate:call-1",
                        "node_type": "approval_gate",
                        "status": "waiting_approval"
                    }]
                }
            }),
            false,
            &[],
        ),
        "blocked"
    );
}

#[test]
fn build_assistant_meta_persists_execution_tree_summary() {
    let meta = build_assistant_meta(
        vec![json!({ "type": "text", "content": "done" })],
        "model-a",
        "provider-model-a",
        Some(json!({ "latency_ms": 10 })),
        Some(json!({
            "execution_id": "graph-exec-1",
            "nodes": [],
            "events": [],
        })),
        Some(json!({
            "execution_id": "exec-1",
            "execution_kind": "workflow",
            "workflow_run_id": "run-1",
        })),
        AssistantMetaMode::Canonical,
    )
    .expect("assistant meta");

    let object = meta.as_object().expect("meta object");
    assert!(object.contains_key("blocks"));
    assert_eq!(
        object
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .and_then(Value::as_str),
        Some("graph-exec-1")
    );
    assert_eq!(
        object
            .get("execution_tree")
            .and_then(|value| value.get("execution_id"))
            .and_then(Value::as_str),
        Some("exec-1")
    );
    assert_eq!(
        object
            .get("execution_tree")
            .and_then(|value| value.get("workflow_run_id"))
            .and_then(Value::as_str),
        Some("run-1")
    );
}

#[test]
fn select_custom_task_agent_candidate_prefers_image_agent_for_image_query() {
    let profiles = vec![
        CustomTaskAgentProfile {
            id: "agent-image".to_string(),
            name: "Image Agent".to_string(),
            description: Some("Creates images".to_string()),
            task_prompt: "Generate images".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::ImageGeneration,
            preferred_for_image_generation: true,
            model_config: None,
            callable_mcp_tool_ids: vec![],
            guidance_skill_ids: vec![],
            callable_skill_action_refs: vec![],
            bound_asset_id: None,
            tags: vec!["image".to_string(), "draw".to_string()],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-03-12T00:00:00Z".to_string(),
            updated_at: "2026-03-12T00:00:00Z".to_string(),
        },
        CustomTaskAgentProfile {
            id: "agent-text".to_string(),
            name: "Planner".to_string(),
            description: Some("Plans tasks".to_string()),
            task_prompt: "Plan".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: vec![],
            guidance_skill_ids: vec![],
            callable_skill_action_refs: vec![],
            bound_asset_id: None,
            tags: vec!["plan".to_string()],
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-03-12T00:00:00Z".to_string(),
            updated_at: "2026-03-12T00:00:00Z".to_string(),
        },
    ];

    let selection = select_custom_task_agent_candidate(
        "Generate one image of a neon cat",
        &profiles,
        &HashMap::new(),
    )
    .expect("image agent should be selected");

    assert_eq!(selection.profile.id, "agent-image");
    assert_eq!(
        selection.profile.invocation_kind,
        CustomTaskAgentInvocationKind::ImageGeneration
    );
}
