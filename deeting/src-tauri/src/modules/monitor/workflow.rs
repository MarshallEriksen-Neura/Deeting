use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::modules::desktop_runtime::local_orchestrator::{
    LocalOrchestrationEngine, LocalWorkflowStep, StepResult, StepResultContext,
};

use super::agent_runtime::{
    build_monitor_task_agent_message_with_tools, effective_monitor_tool_names,
    execute_monitor_task_agent,
};
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
            monitor_status_summary(code, meta.as_ref())
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
            execution_id: ctx.execution_id,
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
            let profile = ctx
                .agent_profile
                .as_ref()
                .ok_or_else(|| "monitor task agent missing".to_string())?;
            let effective_tools = effective_monitor_tool_names(profile, &ctx.task.allowed_tools);
            let prompt = build_monitor_task_agent_message_with_tools(&ctx.task, &effective_tools);
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

            let response = execute_monitor_task_agent(
                &app_handle,
                &app_state,
                &profile,
                &ctx.task,
                ctx.execution_id.as_str(),
                &prompt,
            )
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
            // Emit monitor result as runtime-transition correlation evidence.
            // classification=Unknown — monitor observation is not by itself a
            // judgment. Monitor signals MUST NOT influence task_policy_priors;
            // they only land in evolution_signals for inspection. monitor_log_id
            // is unavailable at parse time (the log row is written later by
            // record_execution_success); leave it None.
            if let Some(mcp_store) = ctx.state.shared.mcp_store.as_ref() {
                use crate::modules::desktop_runtime::runtime::evolution::{
                    submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
                    EvolutionSignalSource,
                };
                use crate::modules::desktop_runtime::runtime::runtime_transition::projection::{
                    monitor_checkpoint_correlation_signal_payload, MonitorCheckpointProjectionInput,
                };
                let draft = EvolutionSignalDraft {
                    source: EvolutionSignalSource::MonitorObservation,
                    classification: EvolutionSignalClassification::Unknown,
                    session_id: None,
                    trace_id: None,
                    run_id: None,
                    monitor_task_id: Some(ctx.task.id.clone()),
                    monitor_log_id: None,
                    fingerprint_key: None,
                    confidence: 0.0,
                    payload_json: {
                        let observation_evidence = ctx
                            .observations
                            .as_ref()
                            .map(|value| match value {
                                Value::Array(items) => items
                                    .iter()
                                    .filter_map(|item| {
                                        item.as_str()
                                            .map(str::to_string)
                                            .or_else(|| (!item.is_null()).then(|| item.to_string()))
                                    })
                                    .collect::<Vec<_>>(),
                                Value::Null => Vec::new(),
                                other => vec![other.to_string()],
                            })
                            .unwrap_or_default();
                        let projection_input = MonitorCheckpointProjectionInput {
                            monitor_task_id: ctx.task.id.as_str(),
                            monitor_execution_id: ctx.execution_id.as_str(),
                            strategy_tag: ctx.strategy_tag.as_deref(),
                            observations: &observation_evidence,
                        };
                        let mut payload =
                            monitor_checkpoint_correlation_signal_payload(projection_input);
                        if let Some(object) = payload.as_object_mut() {
                            object.insert("strategy_tag".to_string(), json!(ctx.strategy_tag));
                            object.insert("observations".to_string(), json!(ctx.observations));
                            object.insert(
                                "is_significant_change".to_string(),
                                json!(ctx.is_significant_change),
                            );
                            object.insert("change_summary".to_string(), json!(ctx.change_summary));
                            object.insert("monitor_task_id".to_string(), json!(ctx.task.id));
                            object.insert(
                                "monitor_execution_id".to_string(),
                                json!(ctx.execution_id),
                            );
                        }
                        payload
                    },
                    note: None,
                };
                if let Err(err) = submit_evolution_signal(mcp_store.as_ref(), draft).await {
                    log::warn!(
                        "monitor observation evolution signal submission failed task_id={} err={}",
                        ctx.task.id,
                        err
                    );
                }
            }
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

fn monitor_status_summary(code: &str, meta: Option<&Value>) -> String {
    match code {
        "monitor.agent.resolving" => "正在确认执行 Agent".to_string(),
        "monitor.agent.resolved" => {
            let assistant_name = meta
                .and_then(|value| value.get("assistant_name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match assistant_name {
                Some(name) => format!("已选择执行 Agent: {}", name),
                None => "已选择执行 Agent".to_string(),
            }
        }
        "monitor.prompt.building" => "正在整理巡猎目标和工具上下文".to_string(),
        "monitor.prompt.built" => "已整理巡猎上下文".to_string(),
        "monitor.agent.executing" => "正在执行巡猎分析".to_string(),
        "monitor.agent.error" => meta
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|message| format!("巡猎分析执行失败: {}", message))
            .unwrap_or_else(|| "巡猎分析执行失败".to_string()),
        "monitor.response.empty" => "模型返回内容为空".to_string(),
        "monitor.response.received" => "已收到巡猎分析结果".to_string(),
        "monitor.analysis.done" => {
            let is_significant_change = meta
                .and_then(|value| value.get("is_significant_change"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if is_significant_change {
                "已完成变化判断: 检测到显著变化".to_string()
            } else {
                "已完成变化判断: 未检测到显著变化".to_string()
            }
        }
        _ => code.to_string(),
    }
}
