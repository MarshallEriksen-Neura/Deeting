use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::modules::desktop_runtime::local_orchestrator::{
    LocalOrchestrationEngine, LocalWorkflowStep, StepResult, StepResultContext,
};

use super::agent_runtime::{build_monitor_task_agent_message, execute_monitor_task_agent};
use super::output_contract::normalize_monitor_output;
use super::run_events::{build_run_event, build_run_terminal_event, project_tool_trace_run_events};
use super::types::{LocalExecutionResult, LocalMonitorTask, MonitorRunEventKind};
use super::{global_app_handle_required, global_app_state_required, MonitorState};

pub(super) struct MonitorExecutionError {
    pub(super) message: String,
    pub(super) events: Vec<Value>,
}

pub(super) struct MonitorWorkflowContext {
    pub(super) state: MonitorState,
    pub(super) task: LocalMonitorTask,
    pub(super) execution_id: String,
    pub(super) events: Vec<Value>,
    pub(super) next_event_seq: u32,
    pub(super) agent_profile: Option<CustomTaskAgentProfile>,
    pub(super) executed_model_id: Option<String>,
    pub(super) prompt: Option<String>,
    pub(super) content: Option<String>,
    pub(super) tokens_used: i64,
    pub(super) is_significant_change: bool,
    pub(super) change_summary: String,
    pub(super) new_snapshot: Value,
    pub(super) strategy_tag: Option<String>,
    pub(super) observations: Option<Value>,
}

impl MonitorWorkflowContext {
    pub(super) fn new(state: MonitorState, task: LocalMonitorTask) -> Self {
        Self {
            state,
            task,
            execution_id: Uuid::new_v4().to_string(),
            events: Vec::new(),
            next_event_seq: 1,
            agent_profile: None,
            executed_model_id: None,
            prompt: None,
            content: None,
            tokens_used: 0,
            is_significant_change: false,
            change_summary: String::new(),
            new_snapshot: json!({}),
            strategy_tag: None,
            observations: None,
        }
    }

    pub(super) fn emit_status(
        &mut self,
        stage: &str,
        step: &str,
        state: &str,
        code: &str,
        meta: Option<Value>,
    ) {
        let summary = if code.trim().is_empty() {
            step.to_string()
        } else {
            code.to_string()
        };
        let payload = build_run_event(
            self.execution_id.as_str(),
            self.task.id.as_str(),
            self.next_event_seq,
            MonitorRunEventKind::StageChanged,
            Some(stage.to_string()),
            Some(step.to_string()),
            Some(state.to_string()),
            Some(summary),
            meta.map(|meta| {
                json!({
                    "code": code,
                    "details": meta,
                })
            })
            .or_else(|| Some(json!({ "code": code }))),
        );
        self.next_event_seq += 1;
        self.events.push(payload.clone());
        log::info!("monitor_status {}", payload);
    }
}

impl StepResultContext for MonitorWorkflowContext {
    type Patch = ();

    fn apply_step_result(
        &mut self,
        _step_name: &str,
        _result: StepResult<Self::Patch>,
    ) -> Result<(), String> {
        Ok(())
    }
}

impl MonitorState {
    pub(super) async fn execute_task_local(
        &self,
        task: &LocalMonitorTask,
    ) -> Result<LocalExecutionResult, MonitorExecutionError> {
        let ctx_task = task.clone();
        let mut ctx = MonitorWorkflowContext::new(self.clone(), ctx_task);
        ctx.events.push(build_run_event(
            ctx.execution_id.as_str(),
            ctx.task.id.as_str(),
            ctx.next_event_seq,
            MonitorRunEventKind::RunStarted,
            None,
            None,
            Some("running".to_string()),
            Some("monitor run started".to_string()),
            Some(json!({
                "analysis_mode": ctx.task.analysis_mode,
                "assistant_id": ctx.task.assistant_id,
            })),
        ));
        ctx.next_event_seq += 1;
        let engine = build_monitor_engine();
        let execution_result = engine.execute(&mut ctx).await;
        if let Err(err) = execution_result {
            ctx.events.push(build_run_terminal_event(
                ctx.execution_id.as_str(),
                ctx.task.id.as_str(),
                ctx.next_event_seq,
                MonitorRunEventKind::RunFailed,
                Some(err.clone()),
                None,
            ));
            return Err(MonitorExecutionError {
                message: err,
                events: ctx.events,
            });
        }

        ctx.events.push(build_run_terminal_event(
            ctx.execution_id.as_str(),
            ctx.task.id.as_str(),
            ctx.next_event_seq,
            MonitorRunEventKind::RunCompleted,
            Some(if ctx.change_summary.trim().is_empty() {
                "monitor run completed".to_string()
            } else {
                super::truncate(ctx.change_summary.as_str(), 240)
            }),
            Some(json!({
                "is_significant_change": ctx.is_significant_change,
                "strategy_tag": ctx.strategy_tag,
            })),
        ));

        Ok(LocalExecutionResult {
            is_significant_change: ctx.is_significant_change,
            change_summary: ctx.change_summary,
            new_snapshot: ctx.new_snapshot,
            strategy_tag: ctx.strategy_tag,
            observations: ctx.observations,
            tokens_used: ctx.tokens_used.max(0),
            model_id: ctx.executed_model_id.unwrap_or_default(),
            events: ctx.events,
        })
    }
}

struct MonitorResolveTaskAgentStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorResolveTaskAgentStep {
    fn name(&self) -> &'static str {
        "monitor_resolve_task_agent"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<StepResult<()>, String>> {
        Box::pin(async move {
            ctx.emit_status(
                "remember",
                "monitor_resolve_task_agent",
                "running",
                "monitor.agent.resolving",
                None,
            );
            let assistant_id = ctx
                .task
                .assistant_id
                .as_deref()
                .ok_or_else(|| "monitor task agent binding is required".to_string())?;
            let profile = ctx.state.ensure_bindable_task_agent(assistant_id).await?;
            ctx.agent_profile = Some(profile.clone());
            ctx.emit_status(
                "remember",
                "monitor_resolve_task_agent",
                "success",
                "monitor.agent.resolved",
                Some(json!({
                    "assistant_id": profile.id,
                    "assistant_name": profile.name,
                })),
            );
            Ok(StepResult::success())
        })
    }
}

struct MonitorBuildPromptStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorBuildPromptStep {
    fn name(&self) -> &'static str {
        "monitor_build_prompt"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_resolve_task_agent"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<StepResult<()>, String>> {
        Box::pin(async move {
            ctx.emit_status(
                "evolve",
                "monitor_build_prompt",
                "running",
                "monitor.prompt.building",
                None,
            );
            let prompt = build_monitor_task_agent_message(&ctx.task);
            ctx.prompt = Some(prompt);
            ctx.emit_status(
                "evolve",
                "monitor_build_prompt",
                "success",
                "monitor.prompt.built",
                None,
            );
            Ok(StepResult::success())
        })
    }
}

struct MonitorInvokeTaskAgentStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorInvokeTaskAgentStep {
    fn name(&self) -> &'static str {
        "monitor_execute_task_agent"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_build_prompt"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<StepResult<()>, String>> {
        Box::pin(async move {
            let app_handle = global_app_handle_required()?;
            let profile = ctx
                .agent_profile
                .clone()
                .ok_or_else(|| "monitor task agent missing".to_string())?;
            let app_state = global_app_state_required()?;
            let prompt = ctx
                .prompt
                .clone()
                .ok_or_else(|| "monitor prompt missing".to_string())?;

            ctx.emit_status(
                "evolve",
                "monitor_execute_task_agent",
                "running",
                "monitor.agent.executing",
                Some(json!({
                    "assistant_id": profile.id.clone(),
                    "assistant_name": profile.name.clone(),
                })),
            );

            let response = execute_monitor_task_agent(&app_handle, &app_state, &profile, &prompt)
                .await
                .map_err(|err| {
                    let error_message = err.clone();
                    ctx.emit_status(
                        "evolve",
                        "monitor_execute_task_agent",
                        "failed",
                        "monitor.agent.error",
                        Some(json!({
                            "message": error_message,
                        })),
                    );
                    err.to_string()
                })?;

            let content = response.content;
            if content.trim().is_empty() {
                ctx.emit_status(
                    "render",
                    "monitor_execute_task_agent",
                    "failed",
                    "monitor.response.empty",
                    None,
                );
                return Err("模型返回内容为空".to_string());
            }
            let tokens = response.tokens_used;
            ctx.next_event_seq = project_tool_trace_run_events(
                &mut ctx.events,
                ctx.execution_id.as_str(),
                ctx.task.id.as_str(),
                ctx.next_event_seq,
                &response.tool_trace,
            );
            ctx.content = Some(content);
            ctx.tokens_used = tokens;
            ctx.executed_model_id = Some(response.model_id.clone());
            ctx.emit_status(
                "render",
                "monitor_execute_task_agent",
                "success",
                "monitor.response.received",
                Some(json!({
                    "assistant_id": profile.id,
                    "model_id": response.model_id.clone(),
                    "tokens_used": tokens,
                    "tool_trace_len": response.tool_trace.len(),
                })),
            );
            Ok(StepResult::success())
        })
    }
}

struct MonitorParseResultStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorParseResultStep {
    fn name(&self) -> &'static str {
        "monitor_parse_result"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_execute_task_agent"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<StepResult<()>, String>> {
        Box::pin(async move {
            let content = ctx
                .content
                .as_ref()
                .ok_or_else(|| "monitor content missing".to_string())?;
            let result = normalize_monitor_output(content);
            ctx.is_significant_change = result.is_significant_change;
            ctx.change_summary = result.change_summary;
            ctx.new_snapshot = result.new_snapshot;
            ctx.strategy_tag = result.strategy_tag.clone();
            ctx.observations = result.observations.clone();
            ctx.emit_status(
                "render",
                "monitor_parse_result",
                "success",
                "monitor.analysis.done",
                Some(json!({
                    "is_significant_change": ctx.is_significant_change,
                    "strategy_tag": result.strategy_tag,
                })),
            );
            ctx.events.push(build_run_event(
                ctx.execution_id.as_str(),
                ctx.task.id.as_str(),
                ctx.next_event_seq,
                MonitorRunEventKind::StageChanged,
                Some("render".to_string()),
                Some("monitor_policy_result".to_string()),
                Some("success".to_string()),
                Some("monitor policy result ready".to_string()),
                Some(json!({
                    "strategy_tag": result.strategy_tag,
                    "observations": result.observations,
                })),
            ));
            ctx.next_event_seq += 1;
            Ok(StepResult::success())
        })
    }
}

fn build_monitor_engine() -> LocalOrchestrationEngine<MonitorWorkflowContext> {
    LocalOrchestrationEngine::new(vec![
        Box::new(MonitorResolveTaskAgentStep),
        Box::new(MonitorBuildPromptStep),
        Box::new(MonitorInvokeTaskAgentStep),
        Box::new(MonitorParseResultStep),
    ])
    .expect("monitor engine dag should be valid")
}
