use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::{try_join_all, BoxFuture};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::desktop_runtime::runtime::{
    apply_desktop_execution_policy_overrides, build_local_control_plane_result,
    build_local_control_plane_status_meta, build_local_execution_policy,
    build_runtime_discovery_bundle_with_runtime_query_vector, build_task_fingerprint,
    maybe_override_route_with_custom_task_agent_query_vector, render_local_route_prompt,
    route_hint_status_meta, select_local_route_with_evidence,
    sovereign::{DecisionLocus, Self_},
    LocalControlPlaneResult, LocalExecutionPolicy, LocalRouteDecision, RuntimeDiscoveryBundle,
    TaskFingerprint,
};
use crate::modules::mcp::store::LocalSkillInstallDetail;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_transport::gateway::GeneratedArtifactContext;

use super::retrieval::{
    ContextRetrievalPrefetchStep, PrefetchedRetrievals, SelectedKnowledgeInjectionStep,
    SemanticMemoryInjectionStep,
};
use super::LocalOrchestratorInput;

const LOCAL_DELTA_CHUNK_CHARS: usize = 64;
const DESKTOP_PERSONA_PROMPT_KEY: &str = "chat.persona_prompt";

pub(super) fn latest_user_message(messages: &[LocalChatInputMessage]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| {
            let trimmed = message.content.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
}

pub(super) fn extract_explicit_skill_mentions(text: &str) -> Vec<String> {
    let sanitized = strip_code_spans_for_skill_mentions(text);
    let mut mentions = Vec::new();
    let chars = sanitized.char_indices().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let (_, ch) = chars[index];
        if ch != '$' {
            index += 1;
            continue;
        }

        let mut end = index + 1;
        let mut token = String::new();
        while end < chars.len() {
            let (_, next) = chars[end];
            if next.is_ascii_alphanumeric() || matches!(next, '_' | '-' | '.' | '/') {
                token.push(next);
                end += 1;
            } else {
                break;
            }
        }

        let normalized = normalize_skill_mention(&token);
        if !normalized.is_empty()
            && normalized.chars().any(|ch| ch.is_ascii_alphabetic())
            && !looks_like_env_token(&token, &normalized)
            && !mentions.iter().any(|existing| existing == &normalized)
        {
            mentions.push(normalized);
        }
        index = end.max(index + 1);
    }
    mentions
}

fn strip_code_spans_for_skill_mentions(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_inline_code = false;
    let mut in_fenced_code = false;

    while let Some(ch) = chars.next() {
        if ch == '`' {
            let mut tick_count = 1;
            while matches!(chars.peek(), Some('`')) {
                chars.next();
                tick_count += 1;
            }

            if tick_count >= 3 {
                in_fenced_code = !in_fenced_code;
            } else if !in_fenced_code {
                in_inline_code = !in_inline_code;
            }

            for _ in 0..tick_count {
                output.push(' ');
            }
            continue;
        }

        if in_inline_code || in_fenced_code {
            output.push(if ch == '\n' || ch == '\r' { ch } else { ' ' });
        } else {
            output.push(ch);
        }
    }

    output
}

fn normalize_skill_mention(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('$')
        .trim_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']' | '}'))
        .to_ascii_lowercase()
}

fn looks_like_env_token(raw: &str, normalized: &str) -> bool {
    if normalized.is_empty() {
        return true;
    }
    if normalized == "env" {
        return true;
    }
    raw.chars()
        .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
}

fn query_with_explicit_skill_mentions(query: &str) -> String {
    let mentions = extract_explicit_skill_mentions(query);
    if mentions.is_empty() {
        return query.to_string();
    }
    let display = mentions
        .iter()
        .map(|mention| format!("${mention}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{query}\nExplicit skill mention(s): {display}. Prefer installed skill packages whose skill_id, package id, or display name matches these mentions."
    )
}

fn install_matches_explicit_skill_mention(
    install: &LocalSkillInstallDetail,
    mention: &str,
) -> bool {
    if mention.trim().is_empty() {
        return false;
    }
    let mention = normalize_skill_mention(mention);
    if mention.is_empty() {
        return false;
    }

    let manifest = serde_json::from_str::<Value>(&install.manifest_json).unwrap_or(Value::Null);
    let mut identifiers = vec![normalize_skill_mention(&install.skill_id)];
    if let Some(name) = manifest.get("name").and_then(Value::as_str) {
        let normalized = normalize_skill_mention(name);
        if !normalized.is_empty() {
            identifiers.push(normalized);
        }
    }
    if let Some(display_name) = manifest.get("displayName").and_then(Value::as_str) {
        let normalized = normalize_skill_mention(display_name);
        if !normalized.is_empty() {
            identifiers.push(normalized);
        }
    }

    identifiers.iter().any(|identifier| {
        identifier == &mention
            || identifier
                .rsplit(|ch| matches!(ch, '.' | '/' | '-'))
                .next()
                .is_some_and(|tail| tail == mention)
    })
}

fn build_pinned_skill_recipe_from_install(install: &LocalSkillInstallDetail) -> Value {
    let manifest = serde_json::from_str::<Value>(&install.manifest_json).unwrap_or(Value::Null);
    let name = manifest
        .get("name")
        .or_else(|| manifest.get("displayName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(install.skill_id.as_str())
        .to_string();
    let description = manifest
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string();

    json!({
        "name": name,
        "description": description,
        "skill_id": install.skill_id,
        "recipe_kind": "skill",
        "recommended_path": "activate_skill",
        "recommended_next_tool": "activate_skill",
        "activation_available": install.is_enabled,
        "status": {
            "recommended_action": if install.is_enabled { "activate_skill" } else { "review" },
            "reason": if install.is_enabled {
                "explicit_skill_mention_exact_match"
            } else {
                "explicit_skill_mention_disabled"
            }
        },
        "pinned_reason": "exact_skill_mention_match"
    })
}

async fn resolve_pinned_skill_recipes(
    ctx: &LocalWorkflowContext,
    explicit_mentions: &[String],
) -> Vec<Value> {
    if explicit_mentions.is_empty() {
        return Vec::new();
    }

    let installs = match ctx
        .app_state
        .mcp
        .store
        .list_local_skill_install_details()
        .await
    {
        Ok(installs) => installs,
        Err(_) => return Vec::new(),
    };

    installs
        .into_iter()
        .filter(|install| {
            explicit_mentions
                .iter()
                .any(|mention| install_matches_explicit_skill_mention(install, mention))
        })
        .map(|install| build_pinned_skill_recipe_from_install(&install))
        .collect()
}

fn merge_pinned_skill_recipes(pinned: &[Value], discovered: &[Value]) -> Vec<Value> {
    let mut merged = Vec::with_capacity(pinned.len() + discovered.len());
    let mut seen = Vec::<String>::new();

    for recipe in pinned.iter().chain(discovered.iter()) {
        let key = recipe
            .get("skill_id")
            .or_else(|| recipe.get("id"))
            .or_else(|| recipe.get("pkg_name"))
            .or_else(|| recipe.get("name"))
            .and_then(Value::as_str)
            .map(normalize_skill_mention)
            .unwrap_or_default();
        if key.is_empty() || seen.iter().any(|existing| existing == &key) {
            continue;
        }
        seen.push(key);
        merged.push(recipe.clone());
    }

    merged
}

async fn resolve_runtime_discovery_bundle(
    ctx: &LocalWorkflowContext,
    query: &str,
) -> (RuntimeDiscoveryBundle, Option<ContextPatch>) {
    if let Some(bundle) = ctx.runtime_discovery.clone() {
        return (bundle, None);
    }

    let bundle = build_runtime_discovery_bundle_with_runtime_query_vector(
        ctx.app_state.mcp.store.as_ref(),
        &ctx.app_state.providers.embedding,
        ctx.app_state.memory.service.as_ref(),
        query,
        ctx.request_query_embedding.clone(),
        6,
    )
    .await;
    (
        bundle.clone(),
        Some(ContextPatch::SetRuntimeDiscovery(Some(bundle))),
    )
}

pub(super) fn render_skill_recipe_prompt(
    recipes: &[Value],
    explicit_mentions: &[String],
) -> Option<String> {
    if recipes.is_empty() {
        return None;
    }

    let mut lines = vec![
        "## Installed Skills".to_string(),
        "These are candidate skill packages discovered for this request. A recipe preview is not the full skill.".to_string(),
        "When a listed skill is relevant, call `activate_skill` with its stable `skill_id` before relying on package-specific procedures.".to_string(),
        "After activation, call `read_skill_resource` only for package-local references, examples, templates, or script source named by `SKILL.md`.".to_string(),
        "Use registered skill actions for callable skill tools, and use `shell_execute` only for actual host command execution when it is allowed.".to_string(),
    ];
    if !explicit_mentions.is_empty() {
        lines.push(format!(
            "Explicit user skill mentions in this request: {}. Prefer matching entries, but still activate by stable `skill_id`.",
            explicit_mentions
                .iter()
                .map(|mention| format!("${mention}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let mut ordered_recipes = recipes.iter().collect::<Vec<_>>();
    ordered_recipes
        .sort_by_key(|recipe| !recipe_matches_explicit_skill_mentions(recipe, explicit_mentions));

    for recipe in ordered_recipes {
        let name = recipe
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Unknown Skill");
        let description = recipe
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let action = recipe
            .pointer("/status/recommended_action")
            .and_then(Value::as_str)
            .unwrap_or("review");
        let reason = recipe
            .pointer("/status/reason")
            .and_then(Value::as_str)
            .unwrap_or("skill_available");
        let skill_id = recipe
            .get("skill_id")
            .or_else(|| recipe.get("id"))
            .or_else(|| recipe.get("pkg_name"))
            .and_then(Value::as_str)
            .unwrap_or(name);
        lines.push(format!("- {} - {}", name, description));
        lines.push(format!("  - skill_id: {}", skill_id));
        if recipe.get("pinned_reason").and_then(Value::as_str) == Some("exact_skill_mention_match")
        {
            lines.push("  - Pinned exact match: true".to_string());
        }
        if recipe_matches_explicit_skill_mentions(recipe, explicit_mentions) {
            lines.push("  - Explicit mention match: true".to_string());
        }
        lines.push(format!("  - Status: action={}, reason={}", action, reason));
        lines.push(format!(
            "  - Next: activate_skill(skill_id=\"{}\")",
            skill_id
        ));
        if let Some(excerpt) = recipe
            .get("docs_excerpt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            lines.push(format!("  - Docs: {}", excerpt));
        }
        if let Some(paths) = recipe.get("docs_paths").and_then(Value::as_array) {
            let docs = paths
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .take(3)
                .collect::<Vec<_>>();
            if !docs.is_empty() {
                lines.push(format!("  - Resource hints: {}", docs.join(", ")));
            }
        }
        if let Some(entry) = recipe.get("entry").and_then(Value::as_object) {
            let backend = entry
                .get("backend")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(backend) = backend {
                lines.push(format!("  - Bundle backend: {}", backend));
            }
        }
    }

    Some(lines.join("\n"))
}

fn recipe_matches_explicit_skill_mentions(recipe: &Value, explicit_mentions: &[String]) -> bool {
    if explicit_mentions.is_empty() {
        return false;
    }
    let identifiers = recipe_skill_identifiers(recipe);
    explicit_mentions.iter().any(|mention| {
        identifiers.iter().any(|identifier| {
            identifier == mention
                || identifier
                    .rsplit(|ch| matches!(ch, '.' | '/' | '-'))
                    .next()
                    .is_some_and(|tail| tail == mention)
        })
    })
}

fn recipe_skill_identifiers(recipe: &Value) -> Vec<String> {
    ["skill_id", "id", "pkg_name", "name"]
        .into_iter()
        .filter_map(|key| recipe.get(key).and_then(Value::as_str))
        .map(normalize_skill_mention)
        .filter(|value| !value.is_empty())
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StepStatus {
    Success,
    Skipped,
}

impl StepStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayerExecutionMode {
    Sequential,
    Parallel,
}

impl LayerExecutionMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Sequential => "sequential",
            Self::Parallel => "parallel",
        }
    }
}

pub(super) struct StatusPatch {
    pub(crate) stage: String,
    pub(crate) step: Option<String>,
    pub(crate) state: String,
    pub(crate) code: String,
    pub(crate) meta: Option<Value>,
}

pub(crate) enum ContextPatch {
    PrependMessages(Vec<LocalChatInputMessage>),
    SetRuntimeDiscovery(Option<RuntimeDiscoveryBundle>),
    SetRouteDecision(Option<LocalRouteDecision>),
    SetExecutionPolicy(Option<LocalExecutionPolicy>),
    SetControlPlaneResult(Option<LocalControlPlaneResult>),
    SetSelectedPromptVariant(Option<String>),
    SetTaskFingerprint(Option<TaskFingerprint>),
    SetRequestQueryEmbedding {
        embedding: Option<Vec<f32>>,
        attempted: bool,
    },
    SetPrefetchedRetrievals(PrefetchedRetrievals),
    EmitStatus(StatusPatch),
}

pub(crate) type LocalStepResult = StepResult<ContextPatch>;

pub(crate) struct StepResult<P> {
    pub(crate) status: StepStatus,
    pub(crate) system_messages: Vec<String>,
    pub(crate) patches: Vec<P>,
    pub(crate) events: Vec<Value>,
    pub(crate) metrics: Option<Value>,
}

impl<P> StepResult<P> {
    pub(crate) fn success() -> Self {
        Self {
            status: StepStatus::Success,
            system_messages: Vec::new(),
            patches: Vec::new(),
            events: Vec::new(),
            metrics: None,
        }
    }

    pub(crate) fn skipped() -> Self {
        Self {
            status: StepStatus::Skipped,
            ..Self::success()
        }
    }

    pub(crate) fn with_system_message(mut self, content: impl Into<String>) -> Self {
        self.system_messages.push(content.into());
        self
    }

    pub(crate) fn with_patch(mut self, patch: P) -> Self {
        self.patches.push(patch);
        self
    }

    pub(crate) fn with_metrics(mut self, metrics: Value) -> Self {
        self.metrics = Some(metrics);
        self
    }
}

pub(crate) fn status_patch(
    stage: &str,
    step: Option<&str>,
    state: &str,
    code: &str,
    meta: Option<Value>,
) -> ContextPatch {
    ContextPatch::EmitStatus(StatusPatch {
        stage: stage.to_string(),
        step: step.map(str::to_string),
        state: state.to_string(),
        code: code.to_string(),
        meta,
    })
}

pub(crate) struct LayerStepResult<P> {
    pub(crate) step_name: String,
    pub(crate) result: StepResult<P>,
}

pub(crate) trait StepResultContext: Sized {
    type Patch;

    fn apply_step_result(
        &mut self,
        step_name: &str,
        result: StepResult<Self::Patch>,
    ) -> Result<(), String>;

    fn before_layer_execution(
        &mut self,
        _layer_index: usize,
        _layer_steps: &[String],
        _mode: LayerExecutionMode,
    ) -> Result<(), String> {
        Ok(())
    }

    fn validate_layer_results(
        &self,
        _layer_index: usize,
        _layer_steps: &[String],
        _results: &[LayerStepResult<Self::Patch>],
    ) -> Result<(), String> {
        Ok(())
    }

    fn after_layer_execution(
        &mut self,
        _layer_index: usize,
        _layer_steps: &[String],
        _mode: LayerExecutionMode,
    ) -> Result<(), String> {
        Ok(())
    }

    fn supports_parallel_snapshot(&self) -> bool {
        false
    }

    fn clone_for_parallel(&self) -> Result<Self, String> {
        Err("parallel snapshot is not supported for this workflow context".to_string())
    }
}

pub(crate) trait LocalWorkflowStep<C: StepResultContext>: Send + Sync {
    fn name(&self) -> &'static str;

    fn depends_on(&self) -> &'static [&'static str] {
        &[]
    }

    fn execute<'a>(&'a self, ctx: &'a mut C)
        -> BoxFuture<'a, Result<StepResult<C::Patch>, String>>;
}

pub(crate) struct LocalOrchestrationEngine<C> {
    steps: std::collections::HashMap<String, Box<dyn LocalWorkflowStep<C>>>,
    execution_layers: Vec<Vec<String>>,
}

impl<C: StepResultContext> LocalOrchestrationEngine<C> {
    pub(crate) fn new(steps: Vec<Box<dyn LocalWorkflowStep<C>>>) -> Result<Self, String> {
        use std::collections::{HashMap, HashSet};

        let mut step_map = HashMap::new();
        for step in steps {
            let name = step.name().to_string();
            if step_map.contains_key(&name) {
                return Err(format!("duplicate step name: {}", name));
            }
            step_map.insert(name, step);
        }

        // build dependency graph
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();
        for name in step_map.keys() {
            in_degree.entry(name.clone()).or_insert(0);
        }
        for (name, step) in step_map.iter() {
            for dep in step.depends_on() {
                let dep_str = dep.to_string();
                if !step_map.contains_key(&dep_str) {
                    return Err(format!("step '{}' depends on unknown step '{}'", name, dep));
                }
                *in_degree.entry(name.clone()).or_insert(0) += 1;
                dependents.entry(dep_str).or_default().push(name.clone());
            }
        }

        // Kahn topo sort, grouping by layers
        let mut layers: Vec<Vec<String>> = Vec::new();
        let mut queue: Vec<String> = in_degree
            .iter()
            .filter_map(|(name, &deg)| if deg == 0 { Some(name.clone()) } else { None })
            .collect();

        let mut visited: HashSet<String> = HashSet::new();
        while !queue.is_empty() {
            let current_layer = queue.clone();
            layers.push(current_layer.clone());
            queue.clear();

            for node in current_layer {
                visited.insert(node.clone());
                if let Some(children) = dependents.get(&node) {
                    for child in children {
                        if let Some(entry) = in_degree.get_mut(child) {
                            if *entry > 0 {
                                *entry -= 1;
                                if *entry == 0 {
                                    queue.push(child.clone());
                                }
                            }
                        }
                    }
                }
            }
        }

        if visited.len() != step_map.len() {
            return Err("local orchestration engine detected cyclic dependencies".to_string());
        }

        Ok(Self {
            steps: step_map,
            execution_layers: layers,
        })
    }
}

impl<C: StepResultContext> LocalOrchestrationEngine<C> {
    pub(crate) async fn execute(&self, ctx: &mut C) -> Result<(), String> {
        for (layer_index, layer) in self.execution_layers.iter().enumerate() {
            let mode = if layer.len() > 1 && ctx.supports_parallel_snapshot() {
                LayerExecutionMode::Parallel
            } else {
                LayerExecutionMode::Sequential
            };
            ctx.before_layer_execution(layer_index, layer, mode)?;

            let layer_results = match mode {
                LayerExecutionMode::Sequential => {
                    let Some(step_name) = layer.first() else {
                        ctx.after_layer_execution(layer_index, layer, mode)?;
                        continue;
                    };
                    let step = self
                        .steps
                        .get(step_name)
                        .ok_or_else(|| format!("step '{}' not found in engine", step_name))?;
                    let result = step.execute(ctx).await?;
                    vec![LayerStepResult {
                        step_name: step_name.clone(),
                        result,
                    }]
                }
                LayerExecutionMode::Parallel => {
                    let mut futures = Vec::with_capacity(layer.len());
                    for step_name in layer {
                        let step = self
                            .steps
                            .get(step_name)
                            .ok_or_else(|| format!("step '{}' not found in engine", step_name))?;
                        let step_name = step_name.clone();
                        let mut step_ctx = ctx.clone_for_parallel().map_err(|err| {
                            format!(
                                "failed to clone parallel snapshot for step '{}': {}",
                                step_name, err
                            )
                        })?;
                        futures.push(async move {
                            let result = step.execute(&mut step_ctx).await?;
                            Ok::<LayerStepResult<C::Patch>, String>(LayerStepResult {
                                step_name,
                                result,
                            })
                        });
                    }
                    try_join_all(futures).await?
                }
            };

            ctx.validate_layer_results(layer_index, layer, &layer_results)?;
            for layer_result in layer_results {
                ctx.apply_step_result(&layer_result.step_name, layer_result.result)?;
            }
            ctx.after_layer_execution(layer_index, layer, mode)?;
        }
        Ok(())
    }
}

impl<C: StepResultContext> LocalOrchestrationEngine<C> {
    #[cfg(test)]
    pub(crate) fn debug_layers(&self) -> &Vec<Vec<String>> {
        &self.execution_layers
    }
}
pub(super) fn build_desktop_local_chat_engine(
) -> Result<LocalOrchestrationEngine<LocalWorkflowContext>, String> {
    LocalOrchestrationEngine::new(vec![
        Box::new(SummaryInjectionStep),
        Box::new(PersonaPromptInjectionStep),
        Box::new(ContextRetrievalPrefetchStep),
        Box::new(SemanticMemoryInjectionStep),
        Box::new(SelectedKnowledgeInjectionStep),
        Box::new(GeneratedArtifactContextInjectionStep),
        Box::new(RouteSelectionStep),
        Box::new(SkillRecipeInjectionStep),
        Box::new(PromptVariantSelectionStep),
        Box::new(TemplateRenderStep),
    ])
}

#[derive(Clone)]

pub(super) struct LocalWorkflowContext {
    pub(super) app_state: AppState,
    pub(super) trace_id: String,
    pub(super) request_id: Option<String>,
    pub(super) session_id: String,
    pub(super) input_model: String,
    pub(super) stream: bool,
    pub(super) status_stream: bool,
    pub(super) started_at: Instant,
    pub(super) event_tx: Option<UnboundedSender<String>>,
    pub(super) capability_id: Option<String>,
    pub(super) explicit_task_agent_id: Option<String>,
    pub(super) summary_text: Option<String>,
    pub(super) messages: Vec<LocalChatInputMessage>,
    pub(super) system_messages: Vec<LocalChatInputMessage>,
    pub(super) runtime_discovery: Option<RuntimeDiscoveryBundle>,
    pub(super) route_decision: Option<LocalRouteDecision>,
    pub(super) execution_policy: Option<LocalExecutionPolicy>,
    pub(super) control_plane_result: Option<LocalControlPlaneResult>,
    // Bandit-selected prompt variant for `router:prompt` scene
    pub(super) selected_prompt_variant: Option<String>,
    // last emitted status snapshot for de-duplication and richer payloads
    pub(super) status_stage: Option<String>,
    pub(super) status_step: Option<String>,
    pub(super) status_state: Option<String>,
    pub(super) status_code: Option<String>,
    pub(super) status_meta: Option<Value>,
    pub(super) selected_knowledge_file_ids: Vec<String>,
    pub(super) generated_artifact_context: Option<GeneratedArtifactContext>,
    pub(super) latest_user_query: Option<String>,
    pub(super) task_fingerprint: Option<TaskFingerprint>,
    pub(super) request_query_embedding: Option<Vec<f32>>,
    pub(super) request_query_embedding_attempted: bool,
    pub(super) prefetched_retrievals: PrefetchedRetrievals,
    pub(super) locale: Option<String>,
}

impl LocalWorkflowContext {
    pub(super) fn new(
        app_state: AppState,
        trace_id: String,
        request_id: Option<String>,
        input: &LocalOrchestratorInput,
        messages: Vec<LocalChatInputMessage>,
        capability_id: Option<String>,
        summary_text: Option<String>,
        event_tx: Option<UnboundedSender<String>>,
    ) -> Self {
        let latest_user_query = latest_user_message(&messages).map(str::to_string);
        Self {
            app_state,
            trace_id,
            request_id,
            session_id: input.session_id.clone(),
            input_model: input.model.clone(),
            stream: input.stream,
            status_stream: input.status_stream,
            started_at: Instant::now(),
            event_tx,
            capability_id,
            explicit_task_agent_id: input.explicit_task_agent_id.clone(),
            summary_text,
            messages,
            system_messages: Vec::new(),
            runtime_discovery: None,
            route_decision: None,
            execution_policy: None,
            control_plane_result: None,
            selected_prompt_variant: None,
            status_stage: None,
            status_step: None,
            status_state: None,
            status_code: None,
            status_meta: None,
            selected_knowledge_file_ids: input.selected_knowledge_file_ids.clone(),
            generated_artifact_context: input.generated_artifact_context.clone(),
            latest_user_query,
            task_fingerprint: None,
            request_query_embedding: None,
            request_query_embedding_attempted: false,
            prefetched_retrievals: PrefetchedRetrievals::default(),
            locale: input.locale.clone(),
        }
    }

    pub(super) fn latest_user_query(&self) -> Option<&str> {
        self.latest_user_query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    pub(super) async fn resolve_request_query_embedding(
        &self,
    ) -> (Option<Vec<f32>>, Option<ContextPatch>) {
        if self.request_query_embedding_attempted {
            return (self.request_query_embedding.clone(), None);
        }

        let Some(query) = self.latest_user_query().map(str::to_string) else {
            return (None, None);
        };
        match self.app_state.providers.embedding.embed_text(&query).await {
            Ok(vector) => {
                let embedding = Some(vector.clone());
                (
                    embedding.clone(),
                    Some(ContextPatch::SetRequestQueryEmbedding {
                        embedding,
                        attempted: true,
                    }),
                )
            }
            Err(err) => {
                log::warn!(
                    "local_orchestrator: request query embedding failed session={} err={}",
                    self.session_id,
                    err
                );
                (
                    None,
                    Some(ContextPatch::SetRequestQueryEmbedding {
                        embedding: None,
                        attempted: true,
                    }),
                )
            }
        }
    }

    fn push_system_message(&mut self, content: impl Into<String>) {
        let content = content.into();
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return;
        }
        self.system_messages.push(LocalChatInputMessage {
            role: "system".to_string(),
            content: trimmed.to_string(),
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        });
    }

    pub(super) fn enrich_payload(&self, payload: &mut Value) {
        if let Some(object) = payload.as_object_mut() {
            object.insert("trace_id".to_string(), json!(self.trace_id));
            if let Some(request_id) = self
                .request_id
                .as_ref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
            {
                object.insert("request_id".to_string(), json!(request_id));
            }
        }
    }

    fn emit_json(&self, payload: Value) {
        let Some(tx) = &self.event_tx else {
            return;
        };
        let serialized = match serde_json::to_string(&payload) {
            Ok(value) => value,
            Err(_) => return,
        };
        let _ = tx.send(serialized);
    }

    pub(super) fn emit_status(
        &mut self,
        stage: &str,
        step: Option<&str>,
        state: &str,
        code: &str,
        meta: Option<Value>,
    ) {
        if !self.status_stream {
            return;
        }

        // Avoid emitting identical consecutive status events
        let is_same_as_last = self.status_stage.as_deref() == Some(stage)
            && self.status_step.as_deref() == step
            && self.status_state.as_deref() == Some(state)
            && self.status_code.as_deref() == Some(code)
            && self.status_meta.as_ref() == meta.as_ref();
        if is_same_as_last {
            return;
        }

        self.status_stage = Some(stage.to_string());
        self.status_step = step.map(|s| s.to_string());
        self.status_state = Some(state.to_string());
        self.status_code = Some(code.to_string());
        self.status_meta = meta.clone();

        let mut payload = json!({
            "type": "status",
            "stage": stage,
            "step": step,
            "state": state,
            "code": code,
            "meta": meta,
        });
        self.enrich_payload(&mut payload);
        self.emit_json(payload);
    }

    pub(super) fn emit_blocks(&self, blocks: Vec<Value>) {
        if blocks.is_empty() {
            return;
        }
        let mut payload = json!({
            "type": "blocks",
            "blocks": blocks,
        });
        self.enrich_payload(&mut payload);
        self.emit_json(payload);
    }

    pub(super) fn emit_stream_delta_chunks(&self, content: &str) {
        if !self.stream || content.trim().is_empty() {
            return;
        }

        let created = unix_seconds();
        let mut chunk = String::new();
        let mut chunk_chars = 0usize;

        for ch in content.chars() {
            chunk.push(ch);
            chunk_chars += 1;
            if chunk_chars >= LOCAL_DELTA_CHUNK_CHARS {
                let mut payload = json!({
                    "id": format!("chatcmpl-local-{}", Uuid::new_v4()),
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": self.input_model,
                    "choices": [{
                        "index": 0,
                        "delta": {"content": chunk},
                    }],
                });
                self.enrich_payload(&mut payload);
                self.emit_json(payload);
                chunk = String::new();
                chunk_chars = 0;
            }
        }

        if !chunk.is_empty() {
            let mut payload = json!({
                "id": format!("chatcmpl-local-{}", Uuid::new_v4()),
                "object": "chat.completion.chunk",
                "created": created,
                "model": self.input_model,
                "choices": [{
                    "index": 0,
                    "delta": {"content": chunk},
                }],
            });
            self.enrich_payload(&mut payload);
            self.emit_json(payload);
        }
    }

    fn apply_context_patch(&mut self, patch: ContextPatch) {
        match patch {
            ContextPatch::PrependMessages(messages) => {
                if messages.is_empty() {
                    return;
                }
                let mut merged = messages;
                merged.extend(self.messages.clone());
                self.messages = merged;
            }
            ContextPatch::SetRuntimeDiscovery(runtime_discovery) => {
                self.runtime_discovery = runtime_discovery;
            }
            ContextPatch::SetRouteDecision(route_decision) => {
                self.route_decision = route_decision;
            }
            ContextPatch::SetExecutionPolicy(execution_policy) => {
                self.execution_policy = execution_policy;
            }
            ContextPatch::SetControlPlaneResult(control_plane_result) => {
                self.control_plane_result = control_plane_result;
            }
            ContextPatch::SetSelectedPromptVariant(selected_prompt_variant) => {
                self.selected_prompt_variant = selected_prompt_variant;
            }
            ContextPatch::SetTaskFingerprint(task_fingerprint) => {
                self.task_fingerprint = task_fingerprint;
            }
            ContextPatch::SetRequestQueryEmbedding {
                embedding,
                attempted,
            } => {
                self.request_query_embedding = embedding;
                self.request_query_embedding_attempted = attempted;
            }
            ContextPatch::SetPrefetchedRetrievals(prefetched_retrievals) => {
                self.prefetched_retrievals = prefetched_retrievals;
            }
            ContextPatch::EmitStatus(status) => {
                self.emit_status(
                    &status.stage,
                    status.step.as_deref(),
                    &status.state,
                    &status.code,
                    status.meta,
                );
            }
        }
    }
}

impl StepResultContext for LocalWorkflowContext {
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
            events,
            metrics,
        } = result;

        for message in system_messages {
            self.push_system_message(message);
        }
        for patch in patches {
            self.apply_context_patch(patch);
        }
        for mut event in events {
            self.enrich_payload(&mut event);
            self.emit_json(event);
        }
        if let Some(metrics) = metrics {
            log::debug!(
                "local_orchestrator: step_result step={} status={} metrics={}",
                step_name,
                status.as_str(),
                metrics
            );
        } else {
            log::debug!(
                "local_orchestrator: step_result step={} status={}",
                step_name,
                status.as_str()
            );
        }
        Ok(())
    }

    fn before_layer_execution(
        &mut self,
        layer_index: usize,
        layer_steps: &[String],
        mode: LayerExecutionMode,
    ) -> Result<(), String> {
        self.emit_status(
            "orchestrate",
            Some("layer"),
            "running",
            "orchestrator.layer.started",
            Some(json!({
                "layer_index": layer_index + 1,
                "step_count": layer_steps.len(),
                "steps": layer_steps,
                "mode": mode.as_str(),
            })),
        );
        Ok(())
    }

    fn validate_layer_results(
        &self,
        layer_index: usize,
        _layer_steps: &[String],
        results: &[LayerStepResult<Self::Patch>],
    ) -> Result<(), String> {
        if results.len() <= 1 {
            return Ok(());
        }
        let mut owners = std::collections::HashMap::<&'static str, &str>::new();
        for layer_result in results {
            let step_name = layer_result.step_name.as_str();
            for patch in &layer_result.result.patches {
                let Some(key) = context_patch_conflict_key(patch) else {
                    continue;
                };
                if let Some(previous_owner) = owners.insert(key, step_name) {
                    if previous_owner != step_name {
                        return Err(format!(
                            "local orchestrator layer {} has conflicting '{}' patches from steps '{}' and '{}'",
                            layer_index + 1,
                            key,
                            previous_owner,
                            step_name
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn after_layer_execution(
        &mut self,
        layer_index: usize,
        layer_steps: &[String],
        mode: LayerExecutionMode,
    ) -> Result<(), String> {
        self.emit_status(
            "orchestrate",
            Some("layer"),
            "success",
            "orchestrator.layer.finished",
            Some(json!({
                "layer_index": layer_index + 1,
                "step_count": layer_steps.len(),
                "steps": layer_steps,
                "mode": mode.as_str(),
            })),
        );
        Ok(())
    }

    fn supports_parallel_snapshot(&self) -> bool {
        true
    }

    fn clone_for_parallel(&self) -> Result<Self, String> {
        Ok(self.clone())
    }
}

fn context_patch_conflict_key(patch: &ContextPatch) -> Option<&'static str> {
    match patch {
        ContextPatch::SetRuntimeDiscovery(_) => Some("set_runtime_discovery"),
        ContextPatch::SetRouteDecision(_) => Some("set_route_decision"),
        ContextPatch::SetExecutionPolicy(_) => Some("set_execution_policy"),
        ContextPatch::SetControlPlaneResult(_) => Some("set_control_plane_result"),
        ContextPatch::SetSelectedPromptVariant(_) => Some("set_selected_prompt_variant"),
        ContextPatch::SetTaskFingerprint(_) => Some("set_task_fingerprint"),
        ContextPatch::SetRequestQueryEmbedding { .. } => Some("set_request_query_embedding"),
        ContextPatch::SetPrefetchedRetrievals(_) => Some("set_prefetched_retrievals"),
        ContextPatch::PrependMessages(_) | ContextPatch::EmitStatus(_) => None,
    }
}

struct SummaryInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for SummaryInjectionStep {
    fn name(&self) -> &'static str {
        "summary_injection"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(summary_text) = ctx.summary_text.clone() else {
                return Ok(StepResult::skipped().with_patch(status_patch(
                    "remember",
                    Some("summary_injection"),
                    "success",
                    "summary.empty",
                    None,
                )));
            };

            Ok(StepResult::success()
                .with_system_message(format!("[SUMMARY]\n{}", summary_text))
                .with_patch(status_patch(
                    "remember",
                    Some("summary_injection"),
                    "success",
                    "summary.loaded",
                    Some(json!({ "chars": summary_text.len() })),
                )))
        })
    }
}

struct PersonaPromptInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for PersonaPromptInjectionStep {
    fn name(&self) -> &'static str {
        "persona_prompt_injection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["summary_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let prompt = ctx
                .app_state
                .mcp
                .store
                .get_desktop_config(DESKTOP_PERSONA_PROMPT_KEY)
                .await
                .map_err(|e| e.to_string())?;
            let prompt = prompt.unwrap_or_default();
            let prompt = prompt.trim();
            if prompt.is_empty() {
                return Ok(StepResult::skipped());
            }

            Ok(StepResult::success()
                .with_system_message(prompt.to_string())
                .with_patch(status_patch(
                    "remember",
                    Some("persona_prompt_injection"),
                    "success",
                    "persona.loaded",
                    Some(json!({
                        "source": "desktop_config",
                        "key": DESKTOP_PERSONA_PROMPT_KEY,
                    })),
                )))
        })
    }
}

struct PromptVariantSelectionStep;

/// Prompt variant identifiers for the `router:prompt` bandit scene.
const PROMPT_VARIANT_DETAILED: &str = "detailed";
const PROMPT_VARIANT_CONCISE: &str = "concise";

impl LocalWorkflowStep<LocalWorkflowContext> for PromptVariantSelectionStep {
    fn name(&self) -> &'static str {
        "prompt_variant_selection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["skill_recipe_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            use crate::modules::providers::bandit_selector::{
                select_arm, BanditConfig, BanditStrategy,
            };
            use crate::modules::providers::store::BANDIT_DEFAULT_STRATEGY;

            let variants: Vec<&'static str> = vec![PROMPT_VARIANT_DETAILED, PROMPT_VARIANT_CONCISE];

            let now_rfc3339 = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default();

            let selected = match ctx
                .app_state
                .providers
                .store
                .list_bandit_arm_states(Some("router:prompt".to_string()))
                .await
            {
                Ok(arms) if !arms.is_empty() => {
                    let arm_map: std::collections::HashMap<
                        String,
                        &crate::modules::providers::types::BanditArmState,
                    > = arms
                        .iter()
                        .filter_map(|a| a.arm_id.as_ref().map(|id| (id.clone(), a)))
                        .collect();
                    let default_strategy = BanditStrategy::parse(BANDIT_DEFAULT_STRATEGY)
                        .unwrap_or(BanditStrategy::Thompson);
                    let strategy = arms
                        .first()
                        .map(|a| BanditStrategy::parse_or(&a.strategy, default_strategy))
                        .unwrap_or(default_strategy);
                    let cfg = BanditConfig {
                        epsilon: arms.first().map(|a| a.epsilon).unwrap_or(0.1),
                        ..BanditConfig::default()
                    };
                    select_arm(
                        &variants,
                        |v| v.to_string(),
                        &arm_map,
                        strategy,
                        &cfg,
                        &now_rfc3339,
                    )
                    .copied()
                    .unwrap_or(PROMPT_VARIANT_DETAILED)
                }
                _ => PROMPT_VARIANT_DETAILED,
            };

            // Inject a style hint system message based on the selected variant
            let style_hint = match selected {
                PROMPT_VARIANT_CONCISE => "Respond concisely. Prefer short, direct answers.",
                _ => "Respond in detail. Provide thorough, comprehensive answers.",
            };
            Ok(StepResult::success()
                .with_system_message(format!("## Response Style\n{}", style_hint))
                .with_patch(ContextPatch::SetSelectedPromptVariant(Some(
                    selected.to_string(),
                )))
                .with_patch(status_patch(
                    "remember",
                    Some("prompt_variant_selection"),
                    "success",
                    "prompt.variant.selected",
                    Some(json!({ "variant": selected })),
                ))
                .with_metrics(json!({ "variant": selected })))
        })
    }
}

struct SkillRecipeInjectionStep;

struct GeneratedArtifactContextInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for GeneratedArtifactContextInjectionStep {
    fn name(&self) -> &'static str {
        "generated_artifact_context_injection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["selected_knowledge_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(context) = ctx.generated_artifact_context.clone() else {
                return Ok(StepResult::skipped());
            };

            Ok(StepResult::success()
                .with_system_message(render_generated_artifact_context_prompt(&context))
                .with_patch(status_patch(
                    "remember",
                    Some("generated_artifact_context_injection"),
                    "success",
                    "generated_artifact.context.loaded",
                    Some(json!({
                        "artifact_id": context.artifact_id,
                        "revision_id": context.revision_id,
                        "revision_number": context.revision_number,
                        "file_id": context.file_id,
                        "kind": context.kind,
                    })),
                )))
        })
    }
}

fn render_generated_artifact_context_prompt(context: &GeneratedArtifactContext) -> String {
    let mut lines = vec![
        "## Active Generated Artifact".to_string(),
        "The user selected an existing desktop-local generated Office artifact for this turn. Treat follow-up requests as edits to this artifact unless the user explicitly asks for a new file.".to_string(),
        format!("- artifact_id: {}", context.artifact_id),
    ];
    if let Some(revision_id) = context.revision_id.as_deref() {
        lines.push(format!("- revision_id: {revision_id}"));
    }
    if let Some(revision_number) = context.revision_number {
        lines.push(format!("- revision_number: {revision_number}"));
    }
    if let Some(file_id) = context.file_id.as_deref() {
        lines.push(format!("- file_id: {file_id}"));
    }
    if let Some(kind) = context.kind.as_deref() {
        lines.push(format!("- kind: {kind}"));
    }
    if let Some(name) = context.name.as_deref() {
        lines.push(format!("- name: {name}"));
    }
    if let Some(content_type) = context.content_type.as_deref() {
        lines.push(format!("- content_type: {content_type}"));
    }
    lines.push("Use inspect_generated_artifact with artifact_id/revision_id/file_id before modifying when you need the current structure. For focused edits, prefer patch_generated_artifact with artifact_id, base_revision_id, operations, and a concise change_summary. Use write_docx/write_pptx with artifact_id only when the change requires rewriting the full source. Preserve existing content; do not regenerate from scratch or drop existing sections/slides unless requested.".to_string());
    lines.join("\n")
}

struct RouteSelectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for RouteSelectionStep {
    fn name(&self) -> &'static str {
        "route_selection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["generated_artifact_context_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(query) = ctx.latest_user_query().map(str::to_string) else {
                return Ok(StepResult::skipped());
            };
            let task_fingerprint = build_task_fingerprint(&query);
            let discovery_query = query_with_explicit_skill_mentions(&query);

            let (discovery_bundle, runtime_discovery_patch) =
                resolve_runtime_discovery_bundle(ctx, &discovery_query).await;
            let base_decision = maybe_override_route_with_custom_task_agent_query_vector(
                &ctx.app_state,
                ctx.explicit_task_agent_id.as_deref(),
                &query,
                ctx.request_query_embedding.clone(),
                select_local_route_with_evidence(&query, discovery_bundle.route_evidence.clone()),
            )
            .await?;
            let route_hint = Self_::consult(
                ctx.app_state.mcp.store.as_ref(),
                DecisionLocus::Route,
                &query,
                4,
            )
            .await
            .as_raw()
            .clone();
            let route_bandit_scores =
                crate::modules::desktop_runtime::runtime::compute_route_bandit_scores(
                    ctx.app_state.providers.store.as_ref(),
                )
                .await;
            let route_prior_application =
                crate::modules::desktop_runtime::runtime::apply_route_prior(
                    base_decision,
                    route_hint,
                    route_bandit_scores,
                );
            let decision = route_prior_application.decision.clone();
            let execution_policy = apply_desktop_execution_policy_overrides(
                ctx.app_state.mcp.store.as_ref(),
                build_local_execution_policy(&decision),
            )
            .await;

            let mut result =
                StepResult::success().with_system_message(render_local_route_prompt(&decision));
            if let Some(patch) = runtime_discovery_patch {
                result = result.with_patch(patch);
            }
            Ok(result
                .with_patch(ContextPatch::SetTaskFingerprint(Some(task_fingerprint)))
                .with_patch(ContextPatch::SetRouteDecision(Some(decision.clone())))
                .with_patch(ContextPatch::SetExecutionPolicy(Some(
                    execution_policy.clone(),
                )))
                .with_patch(status_patch(
                    "remember",
                    Some("route_selection"),
                    "success",
                    "runtime.route.selected",
                    Some(serde_json::json!({
                        "route_status": build_local_control_plane_status_meta(
                            &decision,
                            &execution_policy,
                        ),
                        "task_learning": route_hint_status_meta(&route_prior_application),
                    })),
                )))
        })
    }
}

impl LocalWorkflowStep<LocalWorkflowContext> for SkillRecipeInjectionStep {
    fn name(&self) -> &'static str {
        "skill_recipe_injection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["route_selection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(query) = ctx.latest_user_query().map(str::to_string) else {
                return Ok(StepResult::skipped());
            };

            let explicit_skill_mentions = extract_explicit_skill_mentions(&query);
            let discovery_query = query_with_explicit_skill_mentions(&query);
            let (discovery_bundle, runtime_discovery_patch) =
                resolve_runtime_discovery_bundle(ctx, &discovery_query).await;
            let pinned_skill_recipes =
                resolve_pinned_skill_recipes(ctx, &explicit_skill_mentions).await;
            let recipes =
                merge_pinned_skill_recipes(&pinned_skill_recipes, discovery_bundle.skill_recipes());

            let mut result = StepResult::success();
            if let Some(prompt) = render_skill_recipe_prompt(&recipes, &explicit_skill_mentions) {
                result = result.with_system_message(prompt);
            }
            if let Some(patch) = runtime_discovery_patch {
                result = result.with_patch(patch);
            }

            Ok(result
                .with_patch(status_patch(
                    "remember",
                    Some("skill_recipe_injection"),
                    "success",
                    "skills.recipes.injected",
                    Some(json!({
                        "count": recipes.len(),
                        "pinned_skill_recipe_count": pinned_skill_recipes.len(),
                        "explicit_skill_mentions": explicit_skill_mentions.clone(),
                    })),
                ))
                .with_metrics(json!({
                    "recipe_count": recipes.len(),
                    "pinned_skill_recipe_count": pinned_skill_recipes.len(),
                    "explicit_skill_mention_count": explicit_skill_mentions.len(),
                })))
        })
    }
}

struct TemplateRenderStep;

impl LocalWorkflowStep<LocalWorkflowContext> for TemplateRenderStep {
    fn name(&self) -> &'static str {
        "template_render"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &[
            "summary_injection",
            "persona_prompt_injection",
            "semantic_memory_injection",
            "route_selection",
            "skill_recipe_injection",
            "prompt_variant_selection",
        ]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let control_plane_result = build_local_control_plane_result(
                &ctx.system_messages,
                ctx.runtime_discovery.clone(),
                ctx.route_decision.clone(),
                ctx.execution_policy.clone(),
                ctx.locale.as_deref(),
            );
            let prelude_messages = control_plane_result.prompt_plan.prelude_messages.clone();
            let local_context = control_plane_result.prompt_plan.local_context.clone();
            let response_language = control_plane_result.prompt_plan.response_language.clone();
            let mut result = StepResult::success()
                .with_patch(ContextPatch::SetExecutionPolicy(Some(
                    control_plane_result.execution_policy.clone(),
                )))
                .with_patch(ContextPatch::SetControlPlaneResult(Some(
                    control_plane_result,
                )))
                .with_patch(status_patch(
                    "evolve",
                    Some("template_render"),
                    "success",
                    "template.rendered",
                    Some(json!({
                        "engine": "desktop_local_orchestrator",
                        "current_date": local_context.current_date,
                        "timezone": local_context.timezone,
                        "response_language": response_language,
                    })),
                ))
                .with_metrics(json!({
                    "response_language": response_language,
                    "prelude_messages": prelude_messages.len(),
                }));
            if !prelude_messages.is_empty() {
                result = result.with_patch(ContextPatch::PrependMessages(prelude_messages));
            }
            Ok(result)
        })
    }
}

pub(super) fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
