use super::super::super::user_input::latest_user_message;
use super::super::super::LocalExecutionRequest;
use super::super::phase_step::{phase_step_for_strategy, phase_step_type_name};
use super::frame_bootstrap;
use crate::modules::ai_upstream::ReasoningRequestConfig;
use crate::modules::desktop_runtime::runtime::chat_completion::request_provider_chat_completion;
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::{
    inject_diting_think_tool, parse_diting_think_arguments, DitingThinkExtract,
    DITING_THINK_TOOL_NAME,
};
use crate::modules::desktop_runtime::runtime::extract_chat_tool_calls;
use crate::modules::desktop_runtime::runtime::task_learning::ACTION_VERIFICATION_STRONGER_CHECKS;
use crate::modules::mcp::store::McpStore;
use crate::modules::providers::model_guard::resolve_local_secretary_model_connection;
use crate::state::AppState;
use desktop_runtime_core::{
    Assumption, ConfidenceLevel, EventStore, Fact, FrameArtifactGenerator, FrameBootstrapOutput,
    FrameProvenance, FrameRefreshArtifact, FrameRefreshRequest, FrameValidation,
    InterruptionChannel, PhaseProposal, PhaseProposalGenerator, PhaseStepType, PlanArtifact, Rule,
    RuntimeCoreError, RuntimeCoreResult, RuntimeEvent, Tier2Validator, UserInput, UserInterruption,
    VerificationTarget, WorldModelFrame, WorldModelFrameStatus,
};
use mcp_core::types::LocalChatInputMessage;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const TIER2_VALIDATION_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const TIER2_VALIDATION_CACHE_MAX_ENTRIES: usize = 256;
const TIER2_VALIDATION_AUXILIARY_TEMPERATURE: f32 = 0.1;
const TIER2_VALIDATION_MAX_TOKENS: u32 = 240;
const DITING_FRAME_REFRESH_TEMPERATURE: f32 = 0.1;
const DITING_FRAME_REFRESH_MAX_TOKENS: u32 = 520;
const TIER2_VALIDATION_PROMPT_TEMPLATE_ZH: &str = r#"
你是一个廉价的 frame 新鲜度判定器。

请判断这个 frame 是否仍然新鲜、与目标和已观察一致。

输出必须是严格 JSON，不要加解释，不要加代码块：
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

Return STRICT JSON only, no explanation, no code fences:
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
        content: latest_user_message(&request.messages).unwrap_or_default(),
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
    app_state: Option<AppState>,
}

impl DeetingTier2Validator {
    pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn new(
        app_state: AppState,
    ) -> Self {
        Self {
            app_state: Some(app_state),
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

    fn build_prompt(frame: &WorldModelFrame, plan: Option<&PlanArtifact>) -> String {
        let template = if frame.goal.chars().any(|ch| ch.is_ascii_alphabetic()) {
            TIER2_VALIDATION_PROMPT_TEMPLATE_EN
        } else {
            TIER2_VALIDATION_PROMPT_TEMPLATE_ZH
        };
        template
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
            .replace("{status}", &format!("{:?}", frame.status))
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
        serde_json::from_value::<SecretaryValidationDecision>(response.clone()).ok().or_else(|| {
            crate::modules::conversations::text_utils::extract_text_from_chat_completion_response(
                response,
            )
            .and_then(|text| parse_secretary_validation_text(&text))
        })
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
                Self::cache_put(frame.frame_version_id.clone(), validation.clone());
                return validation;
            }
        };

        let prompt = Self::build_prompt(frame, plan);
        let response = request_provider_chat_completion(
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
            None,
            Some(TIER2_VALIDATION_AUXILIARY_TEMPERATURE),
            Some(TIER2_VALIDATION_MAX_TOKENS),
            crate::modules::ai_upstream::ReasoningRequestConfig::default(),
            None,
            Some(&frame.session_id),
        )
        .await;

        let validation = match response {
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
        validation
    }
}

fn parse_secretary_validation_text(raw: &str) -> Option<SecretaryValidationDecision> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    serde_json::from_str::<SecretaryValidationDecision>(text)
        .ok()
        .or_else(|| {
            strip_markdown_json_block(text).and_then(|stripped| {
                serde_json::from_str::<SecretaryValidationDecision>(stripped).ok()
            })
        })
        .or_else(|| {
            extract_json_object_substring(text)
                .and_then(|json| serde_json::from_str::<SecretaryValidationDecision>(json).ok())
        })
}

fn strip_markdown_json_block(raw: &str) -> Option<&str> {
    let text = raw.trim();
    if !text.starts_with("```") || !text.ends_with("```") {
        return None;
    }
    Some(
        text.trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim(),
    )
    .filter(|value| !value.is_empty())
}

fn extract_json_object_substring(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match ch {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth = depth.saturating_add(1),
            '}' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                if depth == 0 {
                    let end = start + index + ch.len_utf8();
                    return Some(&raw[start..end]);
                }
            }
            _ => {}
        }
    }

    None
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

    fn resolve_diting_think_extract(
        &self,
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> Option<DitingThinkExtract> {
        #[cfg(test)]
        if let Some(result) = invoke_test_diting_frame_refresh(current_frame, request) {
            return result.ok();
        }

        let runtime_request = self.request.as_ref()?;
        let output = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(request_diting_think_frame_extract(
                runtime_request,
                current_frame,
                request,
            ))
        });
        output.ok().flatten()
    }
}

impl FrameArtifactGenerator for DeetingFrameArtifactGenerator {
    fn refresh_frame(
        &mut self,
        current_frame: &WorldModelFrame,
        request: &FrameRefreshRequest,
    ) -> RuntimeCoreResult<WorldModelFrame> {
        let mut refreshed = Self::refreshed_frame_base(current_frame, request);
        if matches!(
            request.artifact,
            Some(FrameRefreshArtifact::DitingThinkPreflight)
        ) {
            let extract = self
                .resolve_diting_think_extract(current_frame, request)
                .ok_or_else(|| {
                    RuntimeCoreError::RequiredArtifactMissing("diting_think_preflight".to_string())
                })?;
            refreshed = apply_diting_think_extract_to_frame(refreshed, Some(&extract));
            refreshed.provenance.evidence_refs.push(format!(
                "diting_think_extract:facts={},assumptions={},verification_targets={},rules={}",
                extract.facts.len(),
                extract.assumptions.len(),
                extract.verification_targets.len(),
                extract.rules.len()
            ));
        }
        Ok(refreshed)
    }
}

fn frame_refresh_suffix(artifact: Option<FrameRefreshArtifact>) -> &'static str {
    match artifact {
        Some(FrameRefreshArtifact::WorldModelFrameRevision) => "revision",
        Some(FrameRefreshArtifact::DitingThinkPreflight) => "diting-think",
        Some(FrameRefreshArtifact::WorldModelFrameRefresh) | None => "refresh",
    }
}

fn frame_refresh_artifact_name(artifact: Option<FrameRefreshArtifact>) -> &'static str {
    match artifact {
        Some(FrameRefreshArtifact::WorldModelFrameRevision) => "world_model_frame_revision",
        Some(FrameRefreshArtifact::DitingThinkPreflight) => "diting_think_preflight",
        Some(FrameRefreshArtifact::WorldModelFrameRefresh) => "world_model_frame_refresh",
        None => "unspecified",
    }
}

async fn request_diting_think_frame_extract(
    runtime_request: &LocalExecutionRequest,
    current_frame: &WorldModelFrame,
    refresh_request: &FrameRefreshRequest,
) -> Result<Option<DitingThinkExtract>, String> {
    let prompt = build_diting_think_frame_refresh_prompt(current_frame, refresh_request);
    let response = request_provider_chat_completion(
        &runtime_request.app_state,
        &runtime_request.model_connection.provider_model_id,
        &runtime_request.model_connection.model_id,
        vec![LocalChatInputMessage {
            role: "user".to_string(),
            content: prompt,
            reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }],
        inject_diting_think_tool(None),
        Some(DITING_FRAME_REFRESH_TEMPERATURE),
        Some(DITING_FRAME_REFRESH_MAX_TOKENS),
        ReasoningRequestConfig {
            enabled: runtime_request.reasoning_enabled,
            effort: runtime_request.reasoning_effort.clone(),
        },
        runtime_request.trace_id.as_deref(),
        Some(&runtime_request.session_id),
    )
    .await
    .map_err(|err| err.to_string())?;

    Ok(extract_chat_tool_calls(&response)
        .into_iter()
        .find(|call| {
            call.name
                .trim()
                .eq_ignore_ascii_case(DITING_THINK_TOOL_NAME)
        })
        .map(|call| parse_diting_think_arguments(&call.arguments)))
}

fn build_diting_think_frame_refresh_prompt(
    current_frame: &WorldModelFrame,
    refresh_request: &FrameRefreshRequest,
) -> String {
    let frame_json =
        serde_json::to_string_pretty(current_frame).unwrap_or_else(|_| "{}".to_string());
    let interruption = refresh_request
        .interruption
        .as_ref()
        .map(|interruption| interruption.content.as_str())
        .unwrap_or("");
    format!(
        concat!(
            "Call the `diting_think` tool exactly once to refresh the world-model frame metadata.\n",
            "Do not answer in normal text. Use the tool call arguments to summarize intent, choose execution_strategy, facts, assumptions, verification targets, and constraints.\n\n",
            "Choose execution_strategy from direct_iteration, delegated_workflow, delegated_agent, or hybrid.\n",
            "Use delegated_workflow for non-trivial multi-step work that should not stay on DirectIteration.\n\n",
            "Refresh reason:\n{reason}\n\n",
            "User interruption, if any:\n{interruption}\n\n",
            "Current frame JSON:\n{frame_json}\n"
        ),
        reason = refresh_request.reason.as_str(),
        interruption = interruption,
        frame_json = frame_json
    )
}

pub(in crate::modules::desktop_runtime::runtime::execution_plane::composition) fn apply_diting_think_extract_to_frame(
    mut frame: WorldModelFrame,
    extract: Option<&DitingThinkExtract>,
) -> WorldModelFrame {
    let Some(extract) = extract else {
        return frame;
    };

    if let Some(strategy) = extract.execution_strategy {
        frame.execution_strategy = strategy;
    }

    for statement in &extract.facts {
        if frame
            .known_facts
            .iter()
            .any(|fact| fact.source == "diting_think" && fact.statement == statement.as_str())
        {
            continue;
        }
        let index = frame.known_facts.len();
        frame.known_facts.push(Fact {
            id: format!("diting-fact-{index}"),
            statement: statement.clone(),
            source: "diting_think".to_string(),
        });
    }
    if !frame
        .known_facts
        .iter()
        .any(|fact| fact.source == "diting_think")
    {
        let index = frame.known_facts.len();
        frame.known_facts.push(Fact {
            id: format!("diting-fact-{index}"),
            statement: extract
                .intent
                .clone()
                .unwrap_or_else(|| "diting_think preflight captured frame metadata".to_string()),
            source: "diting_think".to_string(),
        });
    }
    for statement in &extract.assumptions {
        if frame
            .assumptions
            .iter()
            .any(|assumption| assumption.statement == statement.as_str())
        {
            continue;
        }
        let index = frame.assumptions.len();
        frame.assumptions.push(Assumption {
            id: format!("diting-assumption-{index}"),
            statement: statement.clone(),
        });
    }
    for description in &extract.verification_targets {
        if frame
            .verification_targets
            .iter()
            .any(|target| target.description == description.as_str())
        {
            continue;
        }
        let index = frame.verification_targets.len();
        frame.verification_targets.push(VerificationTarget {
            id: format!("diting-vt-{index}"),
            description: description.clone(),
        });
    }
    for instruction in &extract.rules {
        if frame
            .adaptation_rules
            .iter()
            .any(|rule| rule.instruction == instruction.as_str())
        {
            continue;
        }
        let index = frame.adaptation_rules.len();
        frame.adaptation_rules.push(Rule {
            id: format!("diting-rule-{index}"),
            instruction: instruction.clone(),
        });
    }
    frame
}

#[cfg(test)]
type TestDitingFrameRefreshHook = dyn Fn(&WorldModelFrame, &FrameRefreshRequest) -> Result<DitingThinkExtract, String>
    + Send
    + Sync
    + 'static;

#[cfg(test)]
static TEST_DITING_FRAME_REFRESH_HOOK: OnceLock<Mutex<Option<Arc<TestDitingFrameRefreshHook>>>> =
    OnceLock::new();

#[cfg(test)]
fn test_diting_frame_refresh_hook() -> &'static Mutex<Option<Arc<TestDitingFrameRefreshHook>>> {
    TEST_DITING_FRAME_REFRESH_HOOK.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn set_test_diting_frame_refresh_hook(hook: Option<Arc<TestDitingFrameRefreshHook>>) {
    if let Ok(mut slot) = test_diting_frame_refresh_hook().lock() {
        *slot = hook;
    }
}

#[cfg(test)]
fn invoke_test_diting_frame_refresh(
    frame: &WorldModelFrame,
    request: &FrameRefreshRequest,
) -> Option<Result<DitingThinkExtract, String>> {
    let hook = test_diting_frame_refresh_hook().lock().ok()?.clone()?;
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
        _plan: &PlanArtifact,
        _input: &UserInput,
    ) -> RuntimeCoreResult<Option<PhaseProposal>> {
        let step_type = phase_step_for_strategy(frame.execution_strategy, PhaseStepType::ToolCall);
        Ok(Some(PhaseProposal {
            proposal_id: format!("proposal:{}", phase_step_type_name(step_type)),
            step_type,
            payload: json!({
                "source": "deeting_runtime_composition",
                "phase_step_type": phase_step_type_name(step_type),
                "frame_strategy": frame.execution_strategy,
                "goal": frame.goal.clone(),
            }),
            rationale: "phase derived from world model frame execution strategy".to_string(),
            proposed_at_frame_version: frame.frame_version_id.clone(),
        }))
    }
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
        DeetingTier2Validator { app_state: None }
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

    static TEST_DITING_REFRESH_STATE_LOCK: OnceLock<std::sync::Mutex<()>> = OnceLock::new();

    fn test_diting_refresh_state_lock() -> &'static std::sync::Mutex<()> {
        TEST_DITING_REFRESH_STATE_LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    fn clear_test_diting_refresh_state() {
        set_test_diting_frame_refresh_hook(None);
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
                "content": "{\"is_valid\":true,\"reason\":\"frame still matches the goal\",\"contradiction_signal\":\"none\"}"
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
                "content": "{\"is_valid\":false,\"reason\":\"goal changed after observation\",\"contradiction_signal\":\"goal_drift\"}"
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
                "content": "{\"is_valid\":true,\"reason\":\"cached after first call\",\"contradiction_signal\":\"none\"}"
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
    fn diting_strategy_refresh_drives_next_phase_proposal() {
        let frame = apply_diting_think_extract_to_frame(
            WorldModelFrame::new(
                "frame-strategy-refresh",
                "session-1",
                "task-1",
                "update config after inspecting files",
                ExecutionStrategy::DirectIteration,
                FrameProvenance::bootstrap("test"),
            ),
            Some(&DitingThinkExtract {
                intent: Some("update config after inspecting files".to_string()),
                execution_strategy: Some(ExecutionStrategy::DelegatedWorkflow),
                facts: Vec::new(),
                assumptions: Vec::new(),
                verification_targets: Vec::new(),
                rules: Vec::new(),
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
    fn diting_preflight_refresh_attaches_frame_metadata() {
        let _guard = test_diting_refresh_state_lock()
            .lock()
            .expect("lock diting refresh state");
        clear_test_diting_refresh_state();
        set_test_diting_frame_refresh_hook(Some(Arc::new(|_, _| {
            Ok(DitingThinkExtract {
                intent: Some("refresh frame".to_string()),
                execution_strategy: Some(ExecutionStrategy::DelegatedWorkflow),
                facts: vec!["The implementation needs a live owner patch".to_string()],
                assumptions: vec!["Assume existing runtime contracts stay stable".to_string()],
                verification_targets: vec!["Focused cargo tests pass".to_string()],
                rules: vec!["Keep the diff narrow".to_string()],
            })
        })));

        let mut frame = test_frame("frame-diting-refresh");
        frame.mark_stale();
        let mut generator = DeetingFrameArtifactGenerator { request: None };

        let refreshed = generator
            .refresh_frame(
                &frame,
                &FrameRefreshRequest {
                    reason: "hook requested diting_think".to_string(),
                    interruption: None,
                    artifact: Some(FrameRefreshArtifact::DitingThinkPreflight),
                },
            )
            .expect("refresh frame");

        assert_eq!(
            refreshed.parent_frame_id.as_deref(),
            Some("frame-diting-refresh")
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
            Some("diting_think")
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
            .any(|item| item.contains("diting_think_extract")));
        clear_test_diting_refresh_state();
    }

    #[test]
    fn normal_frame_refresh_does_not_require_diting_extract() {
        let _guard = test_diting_refresh_state_lock()
            .lock()
            .expect("lock diting refresh state");
        clear_test_diting_refresh_state();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_for_hook = calls.clone();
        set_test_diting_frame_refresh_hook(Some(Arc::new(move |_, _| {
            calls_for_hook.fetch_add(1, Ordering::SeqCst);
            Ok(DitingThinkExtract::default())
        })));

        let mut frame = test_frame("frame-normal-refresh");
        frame.mark_stale();
        let mut generator = DeetingFrameArtifactGenerator { request: None };

        let refreshed = generator
            .refresh_frame(
                &frame,
                &FrameRefreshRequest {
                    reason: "tier2 invalid".to_string(),
                    interruption: None,
                    artifact: Some(FrameRefreshArtifact::WorldModelFrameRefresh),
                },
            )
            .expect("refresh frame");

        assert_eq!(refreshed.status, WorldModelFrameStatus::Fresh);
        assert!(refreshed.known_facts.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        clear_test_diting_refresh_state();
    }
}
