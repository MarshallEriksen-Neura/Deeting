use super::super::super::user_input::latest_contiguous_user_messages;
use super::super::super::LocalExecutionRequest;
use super::super::phase_step::{phase_step_for_strategy, phase_step_type_name};
use super::frame_bootstrap;
use crate::modules::ai_upstream::ReasoningRequestConfig;
use crate::modules::desktop_runtime::runtime::chat_completion::request_provider_structured_tool_arguments_with_failover;
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::{
    apply_world_model_update_to_frame, ProposedPhase, WorldModelUpdate,
};
use crate::modules::desktop_runtime::runtime::control_plane::LocalExecutionPolicy;
use crate::modules::desktop_runtime::runtime::prompt_plan::render_local_structured_control_prelude;
use crate::modules::desktop_runtime::runtime::task_learning::ACTION_VERIFICATION_STRONGER_CHECKS;
use crate::modules::mcp::store::McpStore;
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;
use desktop_runtime_core::{
    ConfidenceLevel, EventStore, FrameArtifactGenerator, FrameBootstrapOutput, FrameProvenance,
    FrameRefreshArtifact, FrameRefreshRequest, FrameValidation, InterruptionChannel, PhaseProposal,
    PhaseProposalGenerator, PhaseStepType, PlanArtifact, RuntimeCoreError, RuntimeCoreResult,
    RuntimeEvent, Tier2Validator, UserInput, UserInterruption, WorldModelFrame,
    WorldModelFrameStatus,
};
#[cfg(test)]
use desktop_runtime_core::{Unknown, VerificationTarget};
use mcp_core::types::LocalChatInputMessage;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const TIER2_VALIDATION_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const TIER2_VALIDATION_CACHE_MAX_ENTRIES: usize = 256;
const TIER2_VALIDATION_AUXILIARY_TEMPERATURE: f32 = 0.1;
const TIER2_VALIDATION_MAX_TOKENS: u32 = 512;
const WORLD_MODEL_REFRESH_TEMPERATURE: f32 = 0.1;
const TIER2_VALIDATION_TOOL_NAME: &str = "submit_frame_validation";
const WORLD_MODEL_REFRESH_TOOL_NAME: &str = "submit_world_model_update";
const TIER2_VALIDATION_PROMPT_TEMPLATE_ZH: &str = r#"
你是一个廉价的 frame 新鲜度判定器。

请判断这个 frame 是否仍然新鲜、与目标和已观察一致。

必须调用 submit_frame_validation 工具一次。不要用正文回答。
工具参数必须符合：
{
  "is_valid": true | false,
  "reason": "...",
  "contradiction_signal": "none" | "stale_facts" | "goal_drift" | "missing_assumption"
}

判断标准：
- is_valid=true 表示 frame 仍然可用、新鲜、与当前目标一致。
- is_valid=false 表示 frame 已失效、过期、被观察推翻，或需要重生成。
- contradiction_signal 只写最主要的信号。

frame.goal:
{goal}

frame.assumptions:
{assumptions}

frame.unknowns:
{unknowns}

frame.verification_targets:
{verification_targets}

plan.committed_phases:
{committed_phases}

已知 status:
{status}

请基于这个 frame 是否仍然新鲜、与目标和已观察一致进行判定。
"#;
const TIER2_VALIDATION_PROMPT_TEMPLATE_EN: &str = r#"
You are a cheap frame freshness judge.

Decide whether this frame is still fresh and consistent with the goal and observed state.

Call the submit_frame_validation tool exactly once. Do not answer in text.
The tool arguments must use this shape:
{
  "is_valid": true | false,
  "reason": "...",
  "contradiction_signal": "none" | "stale_facts" | "goal_drift" | "missing_assumption"
}

Decision rules:
- is_valid=true means the frame is still usable, fresh, and aligned with the current goal.
- is_valid=false means the frame is stale, contradicted, or needs regeneration.
- contradiction_signal should contain only the primary signal.

frame.goal:
{goal}

frame.assumptions:
{assumptions}

frame.unknowns:
{unknowns}

frame.verification_targets:
{verification_targets}

plan.committed_phases:
{committed_phases}

known status:
{status}

Judge whether this frame is still fresh and consistent with the goal and observed state.
"#;

#[derive(Debug, Clone)]
struct CachedValidation {
    validation: FrameValidation,
    cached_at: Instant,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SecretaryValidationDecision {
    is_valid: bool,
    reason: String,
    contradiction_signal: SecretaryContradictionSignal,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum SecretaryContradictionSignal {
    None,
    StaleFacts,
    GoalDrift,
    MissingAssumption,
}

impl SecretaryContradictionSignal {
    fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::StaleFacts => "stale_facts",
            Self::GoalDrift => "goal_drift",
            Self::MissingAssumption => "missing_assumption",
        }
    }
}

static TIER2_VALIDATION_CACHE: OnceLock<Mutex<HashMap<String, CachedValidation>>> = OnceLock::new();
static TIER2_VALIDATION_CACHE_ORDER: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn tier2_validation_cache() -> &'static Mutex<HashMap<String, CachedValidation>> {
    TIER2_VALIDATION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn tier2_validation_cache_order() -> &'static Mutex<VecDeque<String>> {
    TIER2_VALIDATION_CACHE_ORDER.get_or_init(|| Mutex::new(VecDeque::new()))
}
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn task_id_from_request(
    request: &LocalExecutionRequest,
) -> String {
    request
        .root_execution_id
        .as_deref()
        .or(request.request_id.as_deref())
        .or(request.trace_id.as_deref())
        .unwrap_or("local-runtime-task")
        .to_string()
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn user_input_from_request(
    request: &LocalExecutionRequest,
    task_id: String,
) -> UserInput {
    UserInput {
        session_id: request.session_id.clone(),
        task_id,
        content: latest_contiguous_user_messages(&request.messages).unwrap_or_default(),
        source: request.task_input_source.clone(),
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingBootstrapPrompt
{
    request: LocalExecutionRequest,
    task_id: String,
    store: Arc<McpStore>,
}

impl DeetingBootstrapPrompt {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        request: LocalExecutionRequest,
        task_id: String,
        store: Arc<McpStore>,
    ) -> Self {
        Self {
            request,
            task_id,
            store,
        }
    }
}

impl desktop_runtime_core::BootstrapPrompt for DeetingBootstrapPrompt {
    fn bootstrap_frame(&mut self, _input: &UserInput) -> RuntimeCoreResult<FrameBootstrapOutput> {
        let output = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(
                frame_bootstrap::build_bootstrap_frame_with_priors(
                    &self.request,
                    self.task_id.as_str(),
                    self.store.as_ref(),
                ),
            )
        });
        Ok(output)
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingTier2Validator
{
    runtime_request: Option<LocalExecutionRequest>,
    app_state: Option<AppState>,
    execution_policy: LocalExecutionPolicy,
}

impl DeetingTier2Validator {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        app_state: AppState,
        execution_policy: LocalExecutionPolicy,
    ) -> Self {
        Self {
            runtime_request: None,
            app_state: Some(app_state),
            execution_policy,
        }
    }

    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn with_runtime_request(
        runtime_request: LocalExecutionRequest,
    ) -> Self {
        let app_state = runtime_request.app_state.clone();
        let execution_policy = runtime_request.execution_policy.clone();
        Self {
            runtime_request: Some(runtime_request),
            app_state: Some(app_state),
            execution_policy,
        }
    }

    fn local_prior_validation(
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
        reason_prefix: Option<&str>,
    ) -> FrameValidation {
        let has_stronger_checks_prior = frame.memory_priors.iter().any(|prior| {
            prior.id == ACTION_VERIFICATION_STRONGER_CHECKS
                && matches!(prior.confidence, ConfidenceLevel::High)
        });
        let plan_has_verification = plan.is_some_and(|plan| {
            plan.committed_phases
                .iter()
                .any(|phase| matches!(phase.step_type, PhaseStepType::VerifyFinal))
        });
        if has_stronger_checks_prior && !plan_has_verification {
            return FrameValidation {
                is_valid: false,
                reason: reason_prefix
                    .map(|prefix| {
                        format!(
                            "{prefix}; stronger_checks prior cached but no VerifyFinal phase planned"
                        )
                    })
                    .unwrap_or_else(|| {
                        "stronger_checks prior cached but no VerifyFinal phase planned".to_string()
                    }),
            };
        }

        FrameValidation {
            is_valid: true,
            reason: reason_prefix
                .map(|prefix| format!("{prefix}; local runtime frame accepted"))
                .unwrap_or_else(|| "local runtime frame accepted".to_string()),
        }
    }

    fn format_json_lines<T: serde::Serialize>(value: &T) -> String {
        serde_json::to_string_pretty(value).unwrap_or_else(|_| "null".to_string())
    }

    fn build_plan_summary(plan: Option<&PlanArtifact>) -> String {
        plan.map(|plan| {
            let phases = plan
                .committed_phases
                .iter()
                .map(|phase| {
                    format!(
                        "{}:{}",
                        phase.phase_id,
                        phase_step_type_name(phase.step_type)
                    )
                })
                .collect::<Vec<_>>();
            serde_json::to_string(&phases).unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string())
    }

    fn build_prompt(
        execution_policy: &LocalExecutionPolicy,
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
    ) -> String {
        let structured_prelude =
            render_local_structured_control_prelude(Some(execution_policy), None);
        let template = if frame.goal.chars().any(|ch| ch.is_ascii_alphabetic()) {
            TIER2_VALIDATION_PROMPT_TEMPLATE_EN
        } else {
            TIER2_VALIDATION_PROMPT_TEMPLATE_ZH
        };
        let prompt = template
            .replace("{goal}", &frame.goal)
            .replace(
                "{assumptions}",
                &Self::format_json_lines(&frame.assumptions),
            )
            .replace("{unknowns}", &Self::format_json_lines(&frame.unknowns))
            .replace(
                "{verification_targets}",
                &Self::format_json_lines(&frame.verification_targets),
            )
            .replace("{committed_phases}", &Self::build_plan_summary(plan))
            .replace("{status}", &format!("{:?}", frame.status));
        format!(
            "{structured_prelude}\n\n<frame_validation_schema_instruction>\n{prompt}\n</frame_validation_schema_instruction>"
        )
    }

    fn cache_get(frame_version_id: &str) -> Option<FrameValidation> {
        let mut cache = tier2_validation_cache().lock().ok()?;
        let cached = cache.get(frame_version_id)?;
        if cached.cached_at.elapsed() > TIER2_VALIDATION_CACHE_TTL {
            cache.remove(frame_version_id);
            return None;
        }
        Some(cached.validation.clone())
    }

    fn cache_put(frame_version_id: String, validation: FrameValidation) {
        let Ok(mut cache) = tier2_validation_cache().lock() else {
            return;
        };
        let Ok(mut order) = tier2_validation_cache_order().lock() else {
            return;
        };

        if !cache.contains_key(&frame_version_id) {
            order.push_back(frame_version_id.clone());
        }
        cache.insert(
            frame_version_id.clone(),
            CachedValidation {
                validation,
                cached_at: Instant::now(),
            },
        );

        while cache.len() > TIER2_VALIDATION_CACHE_MAX_ENTRIES {
            let Some(evicted) = order.pop_front() else {
                break;
            };
            cache.remove(&evicted);
        }
    }

    fn validation_from_secretary_decision(
        decision: SecretaryValidationDecision,
    ) -> FrameValidation {
        FrameValidation {
            is_valid: decision.is_valid,
            reason: format!(
                "secretary signal={}; {}",
                decision.contradiction_signal.as_str(),
                decision.reason.trim()
            ),
        }
    }

    fn parse_secretary_validation_response(
        response: &serde_json::Value,
    ) -> Option<SecretaryValidationDecision> {
        serde_json::from_value::<SecretaryValidationDecision>(response.clone()).ok()
    }

    fn emit_validation_status(&self, state: &str, code: &str, meta: serde_json::Value) {
        let Some(runtime_request) = self.runtime_request.as_ref() else {
            return;
        };
        emit_world_model_frame_status(runtime_request, state, code, meta);
    }

    async fn validate_frame_async(
        &self,
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
    ) -> FrameValidation {
        if matches!(
            frame.status,
            WorldModelFrameStatus::Stale | WorldModelFrameStatus::Contradicted
        ) {
            return FrameValidation {
                is_valid: true,
                reason:
                    "tier1 already marked frame stale or contradicted; tier2 trusts that signal"
                        .to_string(),
            };
        }

        if let Some(validation) = Self::cache_get(&frame.frame_version_id) {
            return validation;
        }

        #[cfg(test)]
        if let Some(result) = invoke_test_secretary_validation(frame, plan) {
            let validation = match result {
                Ok(response) => Self::parse_secretary_validation_response(&response)
                    .map(Self::validation_from_secretary_decision)
                    .unwrap_or_else(|| {
                        Self::local_prior_validation(frame, plan, Some("secretary_parse_failed"))
                    }),
                Err(err) => Self::local_prior_validation(
                    frame,
                    plan,
                    Some(&format!("secretary_call_failed: {err}")),
                ),
            };
            Self::cache_put(frame.frame_version_id.clone(), validation.clone());
            return validation;
        }

        let Some(app_state) = self.app_state.as_ref() else {
            let validation = Self::local_prior_validation(
                frame,
                plan,
                Some("secretary_unavailable: app_state unavailable"),
            );
            self.emit_validation_status(
                "failed",
                "world_model.frame_validation.failed",
                json!({
                    "frame_id": frame.frame_version_id.as_str(),
                    "model_role": "secretary",
                    "error_code": "SECRETARY_UNAVAILABLE",
                    "error_kind": "app_state_unavailable",
                    "fallback": "local_prior_validation",
                }),
            );
            Self::cache_put(frame.frame_version_id.clone(), validation.clone());
            return validation;
        };

        let model_connection = match resolve_local_secretary_model_connection(app_state).await {
            Ok(connection) => connection,
            Err(err) => {
                let validation = Self::local_prior_validation(
                    frame,
                    plan,
                    Some(&format!("secretary_unavailable: {err}")),
                );
                self.emit_validation_status(
                    "failed",
                    "world_model.frame_validation.failed",
                    json!({
                        "frame_id": frame.frame_version_id.as_str(),
                        "model_role": "secretary",
                        "error_code": "SECRETARY_UNAVAILABLE",
                        "error_kind": "secretary_model_unavailable",
                        "error": err.to_string(),
                        "fallback": "local_prior_validation",
                    }),
                );
                Self::cache_put(frame.frame_version_id.clone(), validation.clone());
                return validation;
            }
        };

        let prompt = Self::build_prompt(&self.execution_policy, frame, plan);
        self.emit_validation_status(
            "running",
            "world_model.frame_validation.request",
            json!({
                "frame_id": frame.frame_version_id.as_str(),
                "model_role": "secretary",
                "provider_model_id": model_connection.provider_model_id.as_str(),
                "model_id": model_connection.model_id.as_str(),
            }),
        );
        let response = request_provider_structured_tool_arguments_with_failover(
            app_state,
            &model_connection.provider_model_id,
            &model_connection.model_id,
            vec![LocalChatInputMessage {
                role: "user".to_string(),
                content: prompt,
                reasoning_content: None,
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            }],
            TIER2_VALIDATION_TOOL_NAME,
            "Submit whether the world-model frame is still fresh and usable.",
            tier2_validation_tool_schema(),
            Some(TIER2_VALIDATION_AUXILIARY_TEMPERATURE),
            Some(TIER2_VALIDATION_MAX_TOKENS),
            crate::modules::ai_upstream::ReasoningRequestConfig::default(),
            None,
            Some(&frame.session_id),
            None,
            model_connection.failover_pool_key.as_deref(),
        )
        .await;

        let validation = match response {
            Ok(response) => match Self::parse_secretary_validation_response(&response) {
                Some(decision) => {
                    let validation = Self::validation_from_secretary_decision(decision);
                    self.emit_validation_status(
                        "success",
                        "world_model.frame_validation.validated",
                        json!({
                            "frame_id": frame.frame_version_id.as_str(),
                            "model_role": "secretary",
                            "provider_model_id": model_connection.provider_model_id.as_str(),
                            "model_id": model_connection.model_id.as_str(),
                            "is_valid": validation.is_valid,
                        }),
                    );
                    validation
                }
                None => {
                    self.emit_validation_status(
                        "failed",
                        "world_model.frame_validation.failed",
                        json!({
                            "frame_id": frame.frame_version_id.as_str(),
                            "model_role": "secretary",
                            "provider_model_id": model_connection.provider_model_id.as_str(),
                            "model_id": model_connection.model_id.as_str(),
                            "error_code": "SECRETARY_PARSE_FAILED",
                            "error_kind": "structured_response_parse_failed",
                            "fallback": "local_prior_validation",
                        }),
                    );
                    Self::local_prior_validation(frame, plan, Some("secretary_parse_failed"))
                }
            },
            Err(err) => {
                self.emit_validation_status(
                    "failed",
                    "world_model.frame_validation.failed",
                    json!({
                        "frame_id": frame.frame_version_id.as_str(),
                        "model_role": "secretary",
                        "provider_model_id": model_connection.provider_model_id.as_str(),
                        "model_id": model_connection.model_id.as_str(),
                        "error_code": "SECRETARY_CALL_FAILED",
                        "error_kind": "upstream_request_failed",
                        "error": err.to_string(),
                        "fallback": "local_prior_validation",
                    }),
                );
                Self::local_prior_validation(
                    frame,
                    plan,
                    Some(&format!("secretary_call_failed: {err}")),
                )
            }
        };

        Self::cache_put(frame.frame_version_id.clone(), validation.clone());
        validation
    }
}

fn tier2_validation_tool_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "is_valid": { "type": "boolean" },
            "reason": { "type": "string" },
            "contradiction_signal": {
                "type": "string",
                "enum": ["none", "stale_facts", "goal_drift", "missing_assumption"]
            }
        },
        "required": ["is_valid", "reason", "contradiction_signal"]
    })
}

#[cfg(test)]
type TestSecretaryValidationHook = dyn Fn(&WorldModelFrame, Option<&PlanArtifact>) -> Result<serde_json::Value, String>
    + Send
    + Sync
    + 'static;

#[cfg(test)]
static TEST_SECRETARY_VALIDATION_HOOK: OnceLock<Mutex<Option<Arc<TestSecretaryValidationHook>>>> =
    OnceLock::new();

#[cfg(test)]
fn test_secretary_validation_hook() -> &'static Mutex<Option<Arc<TestSecretaryValidationHook>>> {
    TEST_SECRETARY_VALIDATION_HOOK.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn set_test_secretary_validation_hook(hook: Option<Arc<TestSecretaryValidationHook>>) {
    if let Ok(mut slot) = test_secretary_validation_hook().lock() {
        *slot = hook;
    }
}

#[cfg(test)]
fn invoke_test_secretary_validation(
    frame: &WorldModelFrame,
    plan: Option<&PlanArtifact>,
) -> Option<Result<serde_json::Value, String>> {
    let hook = test_secretary_validation_hook().lock().ok()?.clone()?;
    Some(hook(frame, plan))
}

impl Tier2Validator for DeetingTier2Validator {
    fn validate_frame(
        &mut self,
        frame: &WorldModelFrame,
        plan: Option<&PlanArtifact>,
    ) -> RuntimeCoreResult<FrameValidation> {
        let output = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(self.validate_frame_async(frame, plan))
        });
        Ok(output)
    }
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingFrameArtifactGenerator
{
    request: Option<LocalExecutionRequest>,
}

impl DeetingFrameArtifactGenerator {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        request: LocalExecutionRequest,
    ) -> Self {
        Self {
            request: Some(request),
        }
    }

    fn refreshed_frame_base(
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> WorldModelFrame {
        let mut refreshed = current_frame.clone();
        refreshed.parent_frame_id = Some(current_frame.frame_version_id.clone());
        refreshed.frame_version_id = format!(
            "{}:{}",
            current_frame.frame_version_id,
            frame_refresh_suffix(request.artifact)
        );
        refreshed.status = WorldModelFrameStatus::Fresh;
        refreshed.provenance = FrameProvenance {
            produced_by: "deeting_runtime_composition".to_string(),
            reason: request.reason.clone(),
            evidence_refs: vec![format!(
                "frame_refresh_artifact:{}",
                frame_refresh_artifact_name(request.artifact)
            )],
        };
        refreshed
    }

    fn resolve_world_model_update(
        &self,
        current_frame: &WorldModelFrame,
        current_plan: Option<&PlanArtifact>,
        request: &FrameRefreshRequest,
    ) -> Option<WorldModelUpdate> {
        #[cfg(test)]
        if let Some(result) = invoke_test_world_model_refresh(current_frame, request) {
            return result.ok();
        }

        let runtime_request = self.request.as_ref()?;
        let output = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(request_world_model_update(
                runtime_request,
                current_frame,
                current_plan,
                request,
            ))
        });
        match output {
            Ok(update) => update,
            Err(err) => {
                log::warn!("world_model_update refresh request failed: {err}");
                None
            }
        }
    }
}

impl FrameArtifactGenerator for DeetingFrameArtifactGenerator {
    fn refresh_frame(
        &mut self,
        current_frame: &WorldModelFrame,
        current_plan: Option<&PlanArtifact>,
        request: &FrameRefreshRequest,
    ) -> RuntimeCoreResult<WorldModelFrame> {
        let mut refreshed = Self::refreshed_frame_base(current_frame, request);
        if matches!(
            request.artifact,
            Some(FrameRefreshArtifact::WorldModelFrameRefresh)
                | Some(FrameRefreshArtifact::WorldModelFrameRevision)
        ) {
            let update = self
                .resolve_world_model_update(current_frame, current_plan, request)
                .ok_or_else(|| {
                    RuntimeCoreError::RequiredArtifactMissing("world_model_update".to_string())
                })?;
            refreshed = apply_world_model_update_to_frame(refreshed, Some(&update));
            refreshed.provenance.evidence_refs.push(format!(
                "world_model_update:facts={},assumptions={},verification_targets={},rules={}",
                update.facts.len(),
                update.assumptions.len(),
                update.verification_targets.len(),
                update.rules.len()
            ));
        }
        Ok(refreshed)
    }
}

fn frame_refresh_suffix(artifact: Option<FrameRefreshArtifact>) -> &'static str {
    match artifact {
        Some(FrameRefreshArtifact::WorldModelFrameRevision) => "revision",
        Some(FrameRefreshArtifact::WorldModelFrameRefresh) | None => "refresh",
    }
}

fn frame_refresh_artifact_name(artifact: Option<FrameRefreshArtifact>) -> &'static str {
    match artifact {
        Some(FrameRefreshArtifact::WorldModelFrameRevision) => "world_model_frame_revision",
        Some(FrameRefreshArtifact::WorldModelFrameRefresh) => "world_model_frame_refresh",
        None => "unspecified",
    }
}

fn emit_world_model_frame_status(
    runtime_request: &LocalExecutionRequest,
    state: &str,
    code: &str,
    meta: serde_json::Value,
) {
    if !runtime_request.status_stream {
        return;
    }
    let Some(tx) = runtime_request.event_tx.as_ref() else {
        return;
    };

    let mut payload = json!({
        "type": "status",
        "stage": "evolve",
        "step": "world_model_frame",
        "state": state,
        "code": code,
        "meta": meta,
    });
    if let Some(object) = payload.as_object_mut() {
        if let Some(trace_id) = runtime_request
            .trace_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            object.insert("trace_id".to_string(), json!(trace_id));
        }
        if let Some(request_id) = runtime_request
            .request_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            object.insert("request_id".to_string(), json!(request_id));
        }
    }
    let _ = tx.send(payload.to_string());
}

async fn request_world_model_update(
    runtime_request: &LocalExecutionRequest,
    current_frame: &WorldModelFrame,
    current_plan: Option<&PlanArtifact>,
    refresh_request: &FrameRefreshRequest,
) -> Result<Option<WorldModelUpdate>, String> {
    let prompt = build_world_model_update_refresh_prompt(
        current_frame,
        current_plan,
        refresh_request,
        runtime_request,
    );
    let model_connection =
        match resolve_local_secretary_model_connection(&runtime_request.app_state).await {
            Ok(connection) => connection,
            Err(err) => {
                emit_world_model_frame_status(
                    runtime_request,
                    "failed",
                    "world_model.frame_refresh.failed",
                    json!({
                        "artifact": frame_refresh_artifact_name(refresh_request.artifact),
                        "frame_id": current_frame.frame_version_id.as_str(),
                        "parent_frame_id": current_frame.parent_frame_id.as_deref(),
                        "model_role": "secretary",
                        "error_kind": "secretary_model_unavailable",
                    }),
                );
                return Err(err);
            }
        };
    emit_world_model_frame_status(
        runtime_request,
        "running",
        "world_model.frame_refresh.request",
        json!({
            "artifact": frame_refresh_artifact_name(refresh_request.artifact),
            "frame_id": current_frame.frame_version_id.as_str(),
            "parent_frame_id": current_frame.parent_frame_id.as_deref(),
            "model_role": "secretary",
            "provider_model_id": model_connection.provider_model_id.as_str(),
            "model_id": model_connection.model_id.as_str(),
        }),
    );
    let response = match request_provider_structured_tool_arguments_with_failover(
        &runtime_request.app_state,
        &model_connection.provider_model_id,
        &model_connection.model_id,
        vec![LocalChatInputMessage {
            role: "user".to_string(),
            content: prompt,
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }],
        WORLD_MODEL_REFRESH_TOOL_NAME,
        "Submit a world-model frame update for the runtime refresh.",
        world_model_update_tool_schema(),
        Some(WORLD_MODEL_REFRESH_TEMPERATURE),
        None,
        ReasoningRequestConfig {
            enabled: runtime_request.reasoning_enabled,
            effort: runtime_request.reasoning_effort.clone(),
        },
        runtime_request.trace_id.as_deref(),
        Some(&runtime_request.session_id),
        Some(json!({
            "type": "function",
            "function": { "name": WORLD_MODEL_REFRESH_TOOL_NAME }
        })),
        model_connection.failover_pool_key.as_deref(),
    )
    .await
    {
        Ok(response) => response,
        Err(err) => {
            emit_world_model_frame_status(
                runtime_request,
                "failed",
                "world_model.frame_refresh.failed",
                json!({
                    "artifact": frame_refresh_artifact_name(refresh_request.artifact),
                    "frame_id": current_frame.frame_version_id.as_str(),
                    "parent_frame_id": current_frame.parent_frame_id.as_deref(),
                    "model_role": "secretary",
                    "provider_model_id": model_connection.provider_model_id.as_str(),
                    "model_id": model_connection.model_id.as_str(),
                    "error_kind": "upstream_request_failed",
                    "error": err.to_string(),
                }),
            );
            return Err(err.to_string());
        }
    };

    match parse_secretary_world_model_update_response(&response) {
        Ok(update) => {
            let goal = current_frame.goal.clone();
            fn truncate_ellipsis(s: &str, max_chars: usize) -> String {
                if s.chars().count() <= max_chars { return s.to_string(); }
                let truncated: String = s.chars().take(max_chars).collect();
                format!("{truncated}…")
            }
            let update_facts: Vec<String> = update.facts.iter().take(3)
                .map(|s| truncate_ellipsis(s, 80)).collect();
            let update_assumptions: Vec<String> = update.assumptions.iter().take(3)
                .map(|s| truncate_ellipsis(s, 80)).collect();
            let update_unknowns: Vec<String> = update.new_unknowns.iter().take(3)
                .map(|s| truncate_ellipsis(s, 80)).collect();
            let update_vts: Vec<String> = update.verification_targets.iter().take(3)
                .map(|s| truncate_ellipsis(s, 80)).collect();
            emit_world_model_frame_status(
                runtime_request,
                "success",
                "world_model.frame_refresh.updated",
                json!({
                    "artifact": frame_refresh_artifact_name(refresh_request.artifact),
                    "frame_id": current_frame.frame_version_id.as_str(),
                    "parent_frame_id": current_frame.parent_frame_id.as_deref(),
                    "model_role": "secretary",
                    "provider_model_id": model_connection.provider_model_id.as_str(),
                    "model_id": model_connection.model_id.as_str(),
                    "facts": update.facts.len(),
                    "assumptions": update.assumptions.len(),
                    "verification_targets": update.verification_targets.len(),
                    "rules": update.rules.len(),
                    "goal": goal,
                    "update_facts": update_facts,
                    "update_assumptions": update_assumptions,
                    "update_unknowns": update_unknowns,
                    "update_verification_targets": update_vts,
                    "resolved_unknowns": update.resolved_unknowns.len(),
                }),
            );
            Ok(Some(update))
        }
        Err(err) => {
            emit_world_model_frame_status(
                runtime_request,
                "failed",
                "world_model.frame_refresh.failed",
                json!({
                    "artifact": frame_refresh_artifact_name(refresh_request.artifact),
                    "frame_id": current_frame.frame_version_id.as_str(),
                    "parent_frame_id": current_frame.parent_frame_id.as_deref(),
                    "model_role": "secretary",
                    "provider_model_id": model_connection.provider_model_id.as_str(),
                    "model_id": model_connection.model_id.as_str(),
                    "error_kind": "structured_response_parse_failed",
                    "error": err.as_str(),
                }),
            );
            Err(format!("secretary_world_model_update_parse_failed: {err}"))
        }
    }
}

fn parse_secretary_world_model_update_response(
    response: &serde_json::Value,
) -> Result<WorldModelUpdate, String> {
    let update = response
        .get("world_model_update")
        .ok_or_else(|| "missing world_model_update field".to_string())?;
    serde_json::from_value::<WorldModelUpdate>(update.clone()).map_err(|err| err.to_string())
}

fn world_model_update_tool_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "world_model_update": {
                "type": "object",
                "properties": {
                    "intent": { "type": "string" },
                    "facts": { "type": "array", "items": { "type": "string" } },
                    "assumptions": { "type": "array", "items": { "type": "string" } },
                    "resolved_unknowns": { "type": "array", "items": { "type": "string" } },
                    "new_unknowns": { "type": "array", "items": { "type": "string" } },
                    "verification_targets": { "type": "array", "items": { "type": "string" } },
                    "rules": { "type": "array", "items": { "type": "string" } },
                    "execution_strategy": {
                        "type": "string",
                        "enum": ["direct_iteration", "delegated_workflow", "delegated_agent", "hybrid"]
                    },
                    "proposed_next_phase": {
                        "type": "object",
                        "properties": {
                            "step_type": { "type": "string" },
                            "rationale": { "type": "string" },
                            "verification_target_refs": {
                                "type": "array",
                                "items": { "type": "string" }
                            }
                        },
                        "required": ["step_type", "rationale"]
                    }
                },
                "required": [
                    "facts",
                    "assumptions",
                    "resolved_unknowns",
                    "new_unknowns",
                    "verification_targets",
                    "rules"
                ]
            }
        },
        "required": ["world_model_update"]
    })
}

fn build_world_model_update_refresh_prompt(
    current_frame: &WorldModelFrame,
    current_plan: Option<&PlanArtifact>,
    refresh_request: &FrameRefreshRequest,
    runtime_request: &LocalExecutionRequest,
) -> String {
    let structured_prelude = render_local_structured_control_prelude(
        Some(&runtime_request.execution_policy),
        None,
    );
    let frame_json =
        serde_json::to_string_pretty(current_frame).unwrap_or_else(|_| "{}".to_string());
    let interruption = refresh_request
        .interruption
        .as_ref()
        .map(|interruption| interruption.content.as_str())
        .unwrap_or("");

    let plan_summary = current_plan
        .map(render_plan_summary)
        .unwrap_or_else(|| "(no plan yet)".to_string());

    format!(
        concat!(
            "{structured_prelude}\n\n",
            "<frame_schema_instruction>\n",
            "You are refreshing a world-model frame — a structured record of what the system ",
            "knows, assumes, and still needs to verify about the current task.\n\n",
            "REQUIRED ACTION: You MUST call the `{tool_name}` tool to submit your answer. ",
            "Do not reply with plain text, prose, or a markdown code block — the only ",
            "acceptable response is a `{tool_name}` tool call. A response without this tool ",
            "call is treated as a failure.\n\n",
            "Call `{tool_name}` with a single argument object matching this shape:\n",
            "{{\"world_model_update\":{{\n",
            "  \"intent\": \"one-sentence summary of the current goal\",\n",
            "  \"facts\": [\"confirmed facts\"],\n",
            "  \"assumptions\": [\"unverified beliefs\"],\n",
            "  \"resolved_unknowns\": [\"questions now answered\"],\n",
            "  \"new_unknowns\": [\"new questions discovered\"],\n",
            "  \"verification_targets\": [\"conditions that must be true when done\"],\n",
            "  \"rules\": [\"constraints to follow\"],\n",
            "  \"execution_strategy\": \"direct_iteration | delegated_workflow | delegated_agent | hybrid\",\n",
            "  \"proposed_next_phase\": {{ \"step_type\": \"...\", \"rationale\": \"...\" }}\n",
            "}}}}\n\n",
            "Field semantics:\n",
            "- facts: things confirmed through observation or tool results. Not guesses.\n",
            "- assumptions: things believed but not yet verified.\n",
            "- resolved_unknowns: previously open questions that are now answered.\n",
            "- new_unknowns: new questions that emerged from recent observations.\n",
            "- verification_targets: what must be true for the task to be considered complete.\n",
            "- rules: constraints or adaptation rules discovered during execution.\n",
            "- execution_strategy: choose delegated_workflow for multi-step work, ",
            "delegated_agent for single-worker tasks, direct_iteration for simple chat, ",
            "hybrid when both tool use and coordination are needed.\n",
            "- proposed_next_phase: the next concrete step to take, with step_type and rationale.\n\n",
            "Refresh reason:\n{reason}\n\n",
            "User interruption, if any:\n{interruption}\n\n",
            "Current plan:\n{plan_summary}\n\n",
            "Current frame:\n{frame_json}\n\n",
            "Remember: respond ONLY by calling the `{tool_name}` tool.\n",
            "</frame_schema_instruction>\n"
        ),
        structured_prelude = structured_prelude,
        tool_name = WORLD_MODEL_REFRESH_TOOL_NAME,
        reason = refresh_request.reason.as_str(),
        interruption = interruption,
        plan_summary = plan_summary,
        frame_json = frame_json
    )
}

fn render_plan_summary(plan: &PlanArtifact) -> String {
    use desktop_runtime_core::plan::PhaseStatus;

    let committed = if plan.committed_phases.is_empty() {
        "(none)".to_string()
    } else {
        plan.committed_phases
            .iter()
            .map(|p| {
                let status_icon = match p.status {
                    PhaseStatus::Done => "✓",
                    PhaseStatus::Failed => "✗",
                    PhaseStatus::Running => "→",
                    PhaseStatus::WaitingForExternal { .. } => "⏸",
                    PhaseStatus::Cancelled => "⊗",
                };
                format!(
                    "  {} [{:?}] {}",
                    status_icon,
                    p.step_type,
                    p.observation_ref.as_deref().unwrap_or("(no observation)")
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let proposed = if plan.proposed_phases.is_empty() {
        "(none)".to_string()
    } else {
        plan.proposed_phases
            .iter()
            .map(|p| format!("  - [{:?}] {}", p.step_type, p.rationale))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "### Committed Phases\n{}\n\n### Proposed Phases\n{}\n\n### Plan Status\n{:?}",
        committed, proposed, plan.plan_status
    )
}

#[cfg(test)]
type TestWorldModelRefreshHook = dyn Fn(&WorldModelFrame, &FrameRefreshRequest) -> Result<WorldModelUpdate, String>
    + Send
    + Sync
    + 'static;

#[cfg(test)]
static TEST_WORLD_MODEL_REFRESH_HOOK: OnceLock<Mutex<Option<Arc<TestWorldModelRefreshHook>>>> =
    OnceLock::new();

#[cfg(test)]
fn test_world_model_refresh_hook() -> &'static Mutex<Option<Arc<TestWorldModelRefreshHook>>> {
    TEST_WORLD_MODEL_REFRESH_HOOK.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn set_test_world_model_refresh_hook(hook: Option<Arc<TestWorldModelRefreshHook>>) {
    if let Ok(mut slot) = test_world_model_refresh_hook().lock() {
        *slot = hook;
    }
}

#[cfg(test)]
fn invoke_test_world_model_refresh(
    frame: &WorldModelFrame,
    request: &FrameRefreshRequest,
) -> Option<Result<WorldModelUpdate, String>> {
    let hook = test_world_model_refresh_hook().lock().ok()?.clone()?;
    Some(hook(frame, request))
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingPhaseProposalGenerator;

impl DeetingPhaseProposalGenerator {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new() -> Self
    {
        Self
    }
}

impl PhaseProposalGenerator for DeetingPhaseProposalGenerator {
    fn propose_next_phase(
        &mut self,
        frame: &WorldModelFrame,
        plan: &PlanArtifact,
        _input: &UserInput,
    ) -> RuntimeCoreResult<Option<PhaseProposal>> {
        if requires_user_intent_clarification(frame) {
            return Ok(Some(PhaseProposal {
                proposal_id: "proposal:clarify:user_intent".to_string(),
                step_type: PhaseStepType::DirectChat,
                payload: json!({
                    "source": "world_model_clarification_gate",
                    "clarification_required": true,
                    "clarification_kind": "user_intent",
                    "goal": frame.goal.clone(),
                    "unknowns": frame
                        .unknowns
                        .iter()
                        .map(|unknown| unknown.question.clone())
                        .collect::<Vec<_>>(),
                    "verification_targets": frame
                        .verification_targets
                        .iter()
                        .map(|target| target.description.clone())
                        .collect::<Vec<_>>(),
                }),
                rationale: "World-model frame requires user intent clarification before execution".to_string(),
                proposed_at_frame_version: frame.frame_version_id.clone(),
            }));
        }

        // 0. Check if all verification targets are met
        if all_verification_targets_met(frame, plan) {
            return Ok(Some(PhaseProposal {
                proposal_id: "proposal:verify_final".to_string(),
                step_type: PhaseStepType::VerifyFinal,
                payload: json!({
                    "source": "verification_targets_met",
                    "targets_count": frame.verification_targets.len(),
                }),
                rationale: "All verification targets have been satisfied".to_string(),
                proposed_at_frame_version: frame.frame_version_id.clone(),
            }));
        }

        // Protection: Check for repeated phase pattern
        if detect_repeated_phase_pattern(plan) {
            return Ok(Some(PhaseProposal {
                proposal_id: "proposal:terminate:repeated_pattern".to_string(),
                step_type: PhaseStepType::VerifyFinal,
                payload: json!({
                    "source": "protection:repeated_pattern",
                    "reason": "Detected repeated phase pattern, terminating to prevent infinite loop",
                }),
                rationale: "Repeated phase pattern detected - terminating execution".to_string(),
                proposed_at_frame_version: frame.frame_version_id.clone(),
            }));
        }

        // Protection: Check for lack of progress
        if !has_made_progress(plan) {
            return Ok(Some(PhaseProposal {
                proposal_id: "proposal:terminate:no_progress".to_string(),
                step_type: PhaseStepType::VerifyFinal,
                payload: json!({
                    "source": "protection:no_progress",
                    "reason": "No successful phases in recent history",
                }),
                rationale: "No progress detected - terminating execution".to_string(),
                proposed_at_frame_version: frame.frame_version_id.clone(),
            }));
        }

        // 1. Check if frame contains a proposed_next_phase from world_model_update
        if let Some(proposed_value) = &frame.proposed_next_phase {
            if let Ok(proposed) = serde_json::from_value::<ProposedPhase>(proposed_value.clone()) {
                let step_type =
                    parse_phase_step_type(&proposed.step_type).unwrap_or(PhaseStepType::ToolCall);
                return Ok(Some(PhaseProposal {
                    proposal_id: format!("proposal:world_model_update:{}", proposed.step_type),
                    step_type,
                    payload: json!({
                        "source": "world_model_update_proposal",
                        "verification_target_refs": proposed.verification_target_refs,
                        "frame_version": frame.frame_version_id.clone(),
                    }),
                    rationale: proposed.rationale.clone(),
                    proposed_at_frame_version: frame.frame_version_id.clone(),
                }));
            }
        }

        // 2. Fallback: deterministic mapping from execution_strategy
        let step_type = phase_step_for_strategy(frame.execution_strategy, PhaseStepType::ToolCall);
        Ok(Some(PhaseProposal {
            proposal_id: format!("proposal:fallback:{}", phase_step_type_name(step_type)),
            step_type,
            payload: json!({
                "source": "deterministic_fallback",
                "phase_step_type": phase_step_type_name(step_type),
                "frame_strategy": frame.execution_strategy,
                "goal": frame.goal.clone(),
            }),
            rationale: "phase derived from world model frame execution strategy (fallback)"
                .to_string(),
            proposed_at_frame_version: frame.frame_version_id.clone(),
        }))
    }
}

fn requires_user_intent_clarification(frame: &WorldModelFrame) -> bool {
    let goal = frame.goal.trim();
    let goal_is_deictic = matches!(
        goal,
        "继续" | "继续。" | "继续吧" | "接着" | "接着做" | "go on" | "continue"
    );
    let unknown_requires_intent = frame.unknowns.iter().any(|unknown| {
        let question = unknown.question.to_ascii_lowercase();
        question.contains("original task")
            || question.contains("user intent")
            || question.contains("goal remains ambiguous")
            || unknown.question.contains("用户意图")
            || unknown.question.contains("原始任务")
            || unknown.question.contains("目标不明确")
    });
    let target_requires_clarification = frame.verification_targets.iter().any(|target| {
        let description = target.description.to_ascii_lowercase();
        description.contains("user intent must be clarified")
            || description.contains("goal remains ambiguous")
            || target.description.contains("用户意图")
            || target.description.contains("需要澄清")
            || target.description.contains("目标不明确")
    });

    goal_is_deictic && (unknown_requires_intent || target_requires_clarification)
}

fn parse_phase_step_type(value: &str) -> Option<PhaseStepType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "direct_chat" | "directchat" => Some(PhaseStepType::DirectChat),
        "tool_call" | "toolcall" => Some(PhaseStepType::ToolCall),
        "delegated_worker" | "delegatedworker" | "worker" => Some(PhaseStepType::DelegatedWorker),
        "delegated_workflow" | "delegatedworkflow" | "workflow" => {
            Some(PhaseStepType::DelegatedWorkflow)
        }
        "capability_admit" | "capabilityadmit" => Some(PhaseStepType::CapabilityAdmit),
        "verify_final" | "verifyfinal" | "final" => Some(PhaseStepType::VerifyFinal),
        _ => None,
    }
}

fn all_verification_targets_met(frame: &WorldModelFrame, plan: &PlanArtifact) -> bool {
    if frame.verification_targets.is_empty() {
        // No verification targets means nothing to verify
        return false;
    }

    // Check if all verification targets have been addressed by committed phases
    for target in &frame.verification_targets {
        let target_met = plan.committed_phases.iter().any(|phase| {
            // Check if phase observation mentions this target
            if let Some(obs_ref) = &phase.observation_ref {
                obs_ref.contains(&target.id) || obs_ref.contains(&target.description)
            } else {
                false
            }
        }) || frame.world_observed.iter().any(|obs| {
            // Check if any observation in frame mentions this target
            obs.text.contains(&target.description)
        });

        if !target_met {
            return false;
        }
    }

    true
}

fn detect_repeated_phase_pattern(plan: &PlanArtifact) -> bool {
    const MAX_REPETITIONS: usize = 3;

    if plan.committed_phases.len() < MAX_REPETITIONS {
        return false;
    }

    // Check last N phases for identical step_type + rationale pattern
    let recent_phases: Vec<_> = plan
        .committed_phases
        .iter()
        .rev()
        .take(MAX_REPETITIONS)
        .collect();

    if recent_phases.len() < MAX_REPETITIONS {
        return false;
    }

    // Check if all recent phases have the same step_type
    let first_step_type = recent_phases[0].step_type;
    let all_same_type = recent_phases.iter().all(|p| p.step_type == first_step_type);

    all_same_type
}

fn has_made_progress(plan: &PlanArtifact) -> bool {
    const MIN_PHASES_FOR_CHECK: usize = 5;

    if plan.committed_phases.len() < MIN_PHASES_FOR_CHECK {
        return true; // Too early to judge
    }

    // Check if at least one phase in the last 3 completed successfully
    plan.committed_phases
        .iter()
        .rev()
        .take(3)
        .any(|p| matches!(p.status, desktop_runtime_core::plan::PhaseStatus::Done))
}

#[derive(Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingInterruptionChannel
{
    pending: Option<UserInterruption>,
}

impl DeetingInterruptionChannel {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        pending: Option<UserInterruption>,
    ) -> Self {
        Self { pending }
    }
}

impl InterruptionChannel for DeetingInterruptionChannel {
    fn next_interruption(&mut self) -> RuntimeCoreResult<Option<UserInterruption>> {
        Ok(self.pending.take())
    }
}

#[derive(Clone, Default)]
pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) struct DeetingRuntimeEventStore
{
    events: Arc<Mutex<Vec<RuntimeEvent>>>,
}

impl DeetingRuntimeEventStore {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn events(
        &self,
    ) -> Vec<RuntimeEvent> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }
}

impl EventStore for DeetingRuntimeEventStore {
    fn append_event(&mut self, event: RuntimeEvent) -> RuntimeCoreResult<()> {
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use desktop_runtime_core::{ExecutionStrategy, FrameProvenance, Prior};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_frame(frame_id: &str) -> WorldModelFrame {
        WorldModelFrame::new(
            frame_id,
            "session-1",
            "task-1",
            "verify the implementation",
            ExecutionStrategy::Hybrid,
            FrameProvenance::bootstrap("test"),
        )
    }

    fn validator_without_app_state() -> DeetingTier2Validator {
        DeetingTier2Validator {
            runtime_request: None,
            app_state: None,
            execution_policy: crate::modules::desktop_runtime::runtime::control_plane::build_default_local_execution_policy(),
        }
    }

    static TEST_VALIDATION_STATE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

    fn test_validation_state_lock() -> &'static tokio::sync::Mutex<()> {
        TEST_VALIDATION_STATE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    fn clear_test_validation_state() {
        set_test_secretary_validation_hook(None);
        if let Ok(mut cache) = tier2_validation_cache().lock() {
            cache.clear();
        }
        if let Ok(mut order) = tier2_validation_cache_order().lock() {
            order.clear();
        }
    }

    static TEST_WORLD_MODEL_REFRESH_STATE_LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

    fn test_world_model_refresh_state_lock() -> &'static std::sync::Mutex<()> {
        TEST_WORLD_MODEL_REFRESH_STATE_LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    fn clear_test_world_model_refresh_state() {
        set_test_world_model_refresh_hook(None);
    }
    #[test]
    fn runtime_event_store_clones_share_buffer() {
        let mut writer = DeetingRuntimeEventStore::default();
        let reader = writer.clone();

        writer
            .append_event(RuntimeEvent::FrameBootstrapped {
                frame_version_id: "frame-1".to_string(),
            })
            .expect("append runtime event");

        assert_eq!(
            reader.events(),
            vec![RuntimeEvent::FrameBootstrapped {
                frame_version_id: "frame-1".to_string(),
            }]
        );
    }
    #[tokio::test]
    async fn stronger_checks_prior_requires_verify_final_phase() {
        let _guard = test_validation_state_lock().lock().await;
        clear_test_validation_state();
        let mut frame = test_frame("frame-stronger-checks");
        frame.memory_priors.push(Prior {
            id: ACTION_VERIFICATION_STRONGER_CHECKS.to_string(),
            statement: "cached verification prior".to_string(),
            confidence: ConfidenceLevel::High,
        });
        let plan = PlanArtifact::from_frame("plan-stronger-checks", &frame);

        let validation = validator_without_app_state()
            .validate_frame_async(&frame, Some(&plan))
            .await;

        assert!(!validation.is_valid);
        assert!(validation.reason.contains("stronger_checks"));
    }

    #[tokio::test]
    async fn secretary_valid_response_accepts_frame() {
        let _guard = test_validation_state_lock().lock().await;
        clear_test_validation_state();
        set_test_secretary_validation_hook(Some(Arc::new(|_, _| {
            Ok(json!({
                "is_valid": true,
                "reason": "frame still matches the goal",
                "contradiction_signal": "none"
            }))
        })));

        let frame = test_frame("frame-secretary-valid");
        let validation = validator_without_app_state()
            .validate_frame_async(&frame, None)
            .await;

        assert!(validation.is_valid);
        assert!(validation.reason.contains("secretary signal=none"));
        assert!(validation.reason.contains("frame still matches"));
        clear_test_validation_state();
    }

    #[tokio::test]
    async fn secretary_invalid_response_rejects_frame_with_signal() {
        let _guard = test_validation_state_lock().lock().await;
        clear_test_validation_state();
        set_test_secretary_validation_hook(Some(Arc::new(|_, _| {
            Ok(json!({
                "is_valid": false,
                "reason": "goal changed after observation",
                "contradiction_signal": "goal_drift"
            }))
        })));

        let frame = test_frame("frame-secretary-invalid");
        let validation = validator_without_app_state()
            .validate_frame_async(&frame, None)
            .await;

        assert!(!validation.is_valid);
        assert!(validation.reason.contains("secretary signal=goal_drift"));
        assert!(validation.reason.contains("goal changed"));
        clear_test_validation_state();
    }

    #[tokio::test]
    async fn secretary_unavailable_falls_back_to_local_prior_check() {
        let _guard = test_validation_state_lock().lock().await;
        clear_test_validation_state();
        let mut frame = test_frame("frame-secretary-unavailable");
        frame.memory_priors.push(Prior {
            id: ACTION_VERIFICATION_STRONGER_CHECKS.to_string(),
            statement: "cached verification prior".to_string(),
            confidence: ConfidenceLevel::High,
        });
        let plan = PlanArtifact::from_frame("plan-secretary-unavailable", &frame);

        let validation = validator_without_app_state()
            .validate_frame_async(&frame, Some(&plan))
            .await;

        assert!(!validation.is_valid);
        assert!(validation.reason.contains("secretary_unavailable"));
        assert!(validation.reason.contains("stronger_checks"));
        clear_test_validation_state();
    }

    #[tokio::test]
    async fn cached_validation_skips_repeated_secretary_call() {
        let _guard = test_validation_state_lock().lock().await;
        clear_test_validation_state();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_hook = calls.clone();
        set_test_secretary_validation_hook(Some(Arc::new(move |_, _| {
            calls_for_hook.fetch_add(1, Ordering::SeqCst);
            Ok(json!({
                "is_valid": true,
                "reason": "cached after first call",
                "contradiction_signal": "none"
            }))
        })));

        let frame = test_frame("frame-secretary-cache");
        let first = validator_without_app_state()
            .validate_frame_async(&frame, None)
            .await;
        let second = validator_without_app_state()
            .validate_frame_async(&frame, None)
            .await;

        assert!(first.is_valid);
        assert_eq!(first, second);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        clear_test_validation_state();
    }
    #[test]
    fn phase_proposal_uses_frame_execution_strategy() {
        let cases = [
            (
                ExecutionStrategy::DirectIteration,
                PhaseStepType::DirectChat,
            ),
            (
                ExecutionStrategy::DelegatedWorkflow,
                PhaseStepType::DelegatedWorkflow,
            ),
            (
                ExecutionStrategy::DelegatedAgent,
                PhaseStepType::DelegatedWorker,
            ),
            (ExecutionStrategy::Hybrid, PhaseStepType::ToolCall),
        ];

        for (strategy, expected_step_type) in cases {
            let frame = WorldModelFrame::new(
                "frame-strategy",
                "session-1",
                "task-1",
                "execute task",
                strategy,
                FrameProvenance::bootstrap("test"),
            );
            let plan = PlanArtifact::from_frame("plan-strategy", &frame);
            let input = UserInput {
                session_id: "session-1".to_string(),
                task_id: "task-1".to_string(),
                content: "execute task".to_string(),
                source: Default::default(),
            };

            let proposal = DeetingPhaseProposalGenerator::new()
                .propose_next_phase(&frame, &plan, &input)
                .expect("proposal")
                .expect("some proposal");

            assert_eq!(proposal.step_type, expected_step_type);
        }
    }

    #[test]
    fn phase_proposal_requests_clarification_when_frame_says_user_intent_is_ambiguous() {
        let mut frame = WorldModelFrame::new(
            "frame-clarify",
            "session-1",
            "task-1",
            "继续",
            ExecutionStrategy::DirectIteration,
            FrameProvenance::bootstrap("test"),
        );
        frame.unknowns.push(Unknown {
            id: "unknown-original-task".to_string(),
            question: "What was the original task before it stalled?".to_string(),
        });
        frame.verification_targets.push(VerificationTarget {
            id: "verify-user-intent".to_string(),
            description: "User intent must be clarified if goal remains ambiguous".to_string(),
        });
        let plan = PlanArtifact::from_frame("plan-clarify", &frame);
        let input = UserInput {
            session_id: "session-1".to_string(),
            task_id: "task-1".to_string(),
            content: "继续".to_string(),
            source: Default::default(),
        };

        let proposal = DeetingPhaseProposalGenerator::new()
            .propose_next_phase(&frame, &plan, &input)
            .expect("proposal")
            .expect("some proposal");

        assert_eq!(proposal.step_type, PhaseStepType::DirectChat);
        assert_eq!(
            proposal
                .payload
                .get("clarification_required")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            proposal
                .payload
                .get("clarification_kind")
                .and_then(serde_json::Value::as_str),
            Some("user_intent")
        );
    }

    #[test]
    fn world_model_update_strategy_refresh_drives_next_phase_proposal() {
        let frame = apply_world_model_update_to_frame(
            WorldModelFrame::new(
                "frame-strategy-refresh",
                "session-1",
                "task-1",
                "update config after inspecting files",
                ExecutionStrategy::DirectIteration,
                FrameProvenance::bootstrap("test"),
            ),
            Some(&WorldModelUpdate {
                intent: Some("update config after inspecting files".to_string()),
                execution_strategy: Some(ExecutionStrategy::DelegatedWorkflow),
                facts: Vec::new(),
                assumptions: Vec::new(),
                resolved_unknowns: Vec::new(),
                new_unknowns: Vec::new(),
                verification_targets: Vec::new(),
                rules: Vec::new(),
                proposed_next_phase: None,
            }),
        );
        let plan = PlanArtifact::from_frame("plan-strategy-refresh", &frame);
        let input = UserInput {
            session_id: "session-1".to_string(),
            task_id: "task-1".to_string(),
            content: "update config after inspecting files".to_string(),
            source: Default::default(),
        };

        let proposal = DeetingPhaseProposalGenerator::new()
            .propose_next_phase(&frame, &plan, &input)
            .expect("proposal")
            .expect("some proposal");

        assert_eq!(
            frame.execution_strategy,
            ExecutionStrategy::DelegatedWorkflow
        );
        assert_eq!(proposal.step_type, PhaseStepType::DelegatedWorkflow);
    }

    #[test]
    fn secretary_world_model_update_parse_requires_structured_field() {
        let update = parse_secretary_world_model_update_response(&json!({
            "world_model_update": {
                "intent": "refresh frame",
                "facts": ["secretary returned structured JSON"],
                "execution_strategy": "delegated_workflow"
            }
        }))
        .expect("structured world model update");

        assert_eq!(update.intent.as_deref(), Some("refresh frame"));
        assert_eq!(
            update.execution_strategy,
            Some(ExecutionStrategy::DelegatedWorkflow)
        );
        assert_eq!(
            update.facts,
            vec!["secretary returned structured JSON".to_string()]
        );

        let text_wrapped = parse_secretary_world_model_update_response(&json!({
            "content": "{\"world_model_update\":{\"facts\":[\"do not parse text\"]}}"
        }));

        assert!(text_wrapped.is_err());
    }

    #[test]
    fn world_model_refresh_attaches_frame_metadata() {
        let _guard = test_world_model_refresh_state_lock()
            .lock()
            .expect("lock world model refresh state");
        clear_test_world_model_refresh_state();
        set_test_world_model_refresh_hook(Some(Arc::new(|_, _| {
            Ok(WorldModelUpdate {
                intent: Some("refresh frame".to_string()),
                execution_strategy: Some(ExecutionStrategy::DelegatedWorkflow),
                facts: vec!["The implementation needs a live owner patch".to_string()],
                assumptions: vec!["Assume existing runtime contracts stay stable".to_string()],
                resolved_unknowns: Vec::new(),
                new_unknowns: Vec::new(),
                verification_targets: vec!["Focused cargo tests pass".to_string()],
                rules: vec!["Keep the diff narrow".to_string()],
                proposed_next_phase: None,
            })
        })));

        let mut frame = test_frame("frame-world-model-refresh");
        frame.mark_stale();
        let mut generator = DeetingFrameArtifactGenerator { request: None };

        let refreshed = generator
            .refresh_frame(
                &frame,
                None,
                &FrameRefreshRequest {
                    reason: "hook requested world model update".to_string(),
                    interruption: None,
                    artifact: Some(FrameRefreshArtifact::WorldModelFrameRefresh),
                },
            )
            .expect("refresh frame");

        assert_eq!(
            refreshed.parent_frame_id.as_deref(),
            Some("frame-world-model-refresh")
        );
        assert_eq!(refreshed.status, WorldModelFrameStatus::Fresh);
        assert_eq!(
            refreshed.execution_strategy,
            ExecutionStrategy::DelegatedWorkflow
        );
        assert_eq!(
            refreshed
                .known_facts
                .first()
                .map(|fact| fact.source.as_str()),
            Some("world_model_update")
        );
        assert_eq!(
            refreshed
                .verification_targets
                .first()
                .map(|target| target.description.as_str()),
            Some("Focused cargo tests pass")
        );
        assert!(refreshed
            .provenance
            .evidence_refs
            .iter()
            .any(|item| item.contains("world_model_update")));
        clear_test_world_model_refresh_state();
    }

    #[test]
    fn normal_frame_refresh_uses_world_model_update() {
        let _guard = test_world_model_refresh_state_lock()
            .lock()
            .expect("lock world model refresh state");
        clear_test_world_model_refresh_state();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_hook = calls.clone();
        set_test_world_model_refresh_hook(Some(Arc::new(move |_, _| {
            calls_for_hook.fetch_add(1, Ordering::SeqCst);
            Ok(WorldModelUpdate::default())
        })));

        let mut frame = test_frame("frame-normal-refresh");
        frame.mark_stale();
        let mut generator = DeetingFrameArtifactGenerator { request: None };

        let refreshed = generator
            .refresh_frame(
                &frame,
                None,
                &FrameRefreshRequest {
                    reason: "tier2 invalid".to_string(),
                    interruption: None,
                    artifact: Some(FrameRefreshArtifact::WorldModelFrameRefresh),
                },
            )
            .expect("refresh frame");

        assert_eq!(refreshed.status, WorldModelFrameStatus::Fresh);
        assert_eq!(
            refreshed
                .known_facts
                .first()
                .map(|fact| fact.source.as_str()),
            Some("world_model_update")
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        clear_test_world_model_refresh_state();
    }
}
