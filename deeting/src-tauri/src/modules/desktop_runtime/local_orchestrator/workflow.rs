use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::desktop_runtime::runtime::{
    apply_desktop_execution_policy_overrides, build_local_control_plane_result,
    build_local_control_plane_status_meta, build_local_execution_policy,
    build_runtime_discovery_bundle_with_runtime_query_vector,
    maybe_override_route_with_custom_task_agent_query_vector, render_local_route_prompt,
    select_local_route_with_evidence, LocalControlPlaneResult, LocalExecutionPolicy,
    LocalRouteDecision, RuntimeDiscoveryBundle,
};
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;

use super::retrieval::{
    AssetRecallInjectionStep, ContextRetrievalPrefetchStep, PrefetchedRetrievals,
    SelectedKnowledgeInjectionStep, SemanticMemoryInjectionStep,
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

pub(super) fn render_skill_recipe_prompt(recipes: &[Value]) -> Option<String> {
    if recipes.is_empty() {
        return None;
    }

    let mut lines = vec![
        "## Installed Skills".to_string(),
        "These are installed skill bundles. Recipe entries are supporting guidance only; the current request allowlist plus `search_sdk` capability results are the source of truth for what is executable right now.".to_string(),
        "Read the recipe details when helpful, but if `search_sdk` surfaces a callable direct capability for this request you may call it directly.".to_string(),
        "If a recipe documents a CLI or terminal workflow and `search_sdk` exposes a callable host command tool such as `shell_execute`, use that executable path instead of treating the missing dedicated skill action as a blocker.".to_string(),
        "Do not stop at recipe guidance, refusal, or manual handoff until `search_sdk` has verified the executable capability set for this request.".to_string(),
    ];

    for recipe in recipes {
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
        lines.push(format!("- {} 鈥?{}", name, description));
        lines.push(format!("  - Status: action={}, reason={}", action, reason));
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
                lines.push(format!("  - Files: {}", docs.join(", ")));
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

pub(crate) trait StepResultContext {
    type Patch;

    fn apply_step_result(
        &mut self,
        step_name: &str,
        result: StepResult<Self::Patch>,
    ) -> Result<(), String>;
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

impl<C> LocalOrchestrationEngine<C> {
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
        for layer in &self.execution_layers {
            for name in layer {
                let step = self
                    .steps
                    .get(name)
                    .ok_or_else(|| format!("step '{}' not found in engine", name))?;
                let result = step.execute(ctx).await?;
                ctx.apply_step_result(name, result)?;
            }
        }
        Ok(())
    }

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
        Box::new(AssetRecallInjectionStep),
        Box::new(RouteSelectionStep),
        Box::new(SkillRecipeInjectionStep),
        Box::new(PromptVariantSelectionStep),
        Box::new(TemplateRenderStep),
    ])
}

#[derive(Debug, Clone)]

pub(super) struct LocalWorkflowContext {
    app_state: AppState,
    trace_id: String,
    request_id: Option<String>,
    session_id: String,
    input_model: String,
    stream: bool,
    status_stream: bool,
    started_at: Instant,
    event_tx: Option<UnboundedSender<String>>,
    capability_id: Option<String>,
    explicit_task_agent_id: Option<String>,
    summary_text: Option<String>,
    messages: Vec<LocalChatInputMessage>,
    system_messages: Vec<LocalChatInputMessage>,
    runtime_discovery: Option<RuntimeDiscoveryBundle>,
    route_decision: Option<LocalRouteDecision>,
    execution_policy: Option<LocalExecutionPolicy>,
    control_plane_result: Option<LocalControlPlaneResult>,
    // Bandit-selected prompt variant for `router:prompt` scene
    selected_prompt_variant: Option<String>,
    // last emitted status snapshot for de-duplication and richer payloads
    status_stage: Option<String>,
    status_step: Option<String>,
    status_state: Option<String>,
    status_code: Option<String>,
    status_meta: Option<Value>,
    selected_knowledge_file_ids: Vec<String>,
    latest_user_query: Option<String>,
    request_query_embedding: Option<Vec<f32>>,
    request_query_embedding_attempted: bool,
    prefetched_retrievals: PrefetchedRetrievals,
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
            latest_user_query,
            request_query_embedding: None,
            request_query_embedding_attempted: false,
            prefetched_retrievals: PrefetchedRetrievals::default(),
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

    fn enrich_payload(&self, payload: &mut Value) {
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
            let variants = [PROMPT_VARIANT_DETAILED, PROMPT_VARIANT_CONCISE];

            // Attempt epsilon-greedy selection from the bandit store
            let selected = match ctx
                .app_state
                .providers
                .store
                .list_bandit_arm_states(Some("router:prompt".to_string()))
                .await
            {
                Ok(arms) if !arms.is_empty() => {
                    let epsilon = arms.first().map(|a| a.epsilon).unwrap_or(0.1);
                    let roll: f64 = {
                        use std::collections::hash_map::DefaultHasher;
                        use std::hash::{Hash, Hasher};
                        let mut h = DefaultHasher::new();
                        ctx.trace_id.hash(&mut h);
                        (h.finish() % 1000) as f64 / 1000.0
                    };
                    if roll < epsilon {
                        // Explore: pick based on trace_id hash parity
                        let idx = (roll * 1000.0) as usize % variants.len();
                        variants[idx]
                    } else {
                        // Exploit: pick the variant with the highest success rate
                        let arm_map: std::collections::HashMap<
                            String,
                            &crate::modules::providers::types::BanditArmState,
                        > = arms
                            .iter()
                            .filter_map(|a| a.arm_id.as_ref().map(|id| (id.clone(), a)))
                            .collect();
                        let mut best = variants[0];
                        let mut best_rate = -1.0_f64;
                        for v in &variants {
                            let rate = arm_map
                                .get(*v)
                                .map(|a| {
                                    if a.total_trials > 0 {
                                        a.successes as f64 / a.total_trials as f64
                                    } else {
                                        0.0
                                    }
                                })
                                .unwrap_or(0.0);
                            if rate > best_rate {
                                best_rate = rate;
                                best = v;
                            }
                        }
                        best
                    }
                }
                _ => {
                    // No bandit data yet 鈥?default to "detailed"
                    PROMPT_VARIANT_DETAILED
                }
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

struct RouteSelectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for RouteSelectionStep {
    fn name(&self) -> &'static str {
        "route_selection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["asset_recall_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(query) = ctx.latest_user_query().map(str::to_string) else {
                return Ok(StepResult::skipped());
            };

            let (discovery_bundle, runtime_discovery_patch) =
                resolve_runtime_discovery_bundle(ctx, &query).await;
            let decision = maybe_override_route_with_custom_task_agent_query_vector(
                &ctx.app_state,
                ctx.explicit_task_agent_id.as_deref(),
                &query,
                ctx.request_query_embedding.clone(),
                select_local_route_with_evidence(&query, discovery_bundle.route_evidence.clone()),
            )
            .await?;
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
                .with_patch(ContextPatch::SetRouteDecision(Some(decision.clone())))
                .with_patch(ContextPatch::SetExecutionPolicy(Some(
                    execution_policy.clone(),
                )))
                .with_patch(status_patch(
                    "remember",
                    Some("route_selection"),
                    "success",
                    "runtime.route.selected",
                    Some(build_local_control_plane_status_meta(
                        &decision,
                        &execution_policy,
                    )),
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

            let (discovery_bundle, runtime_discovery_patch) =
                resolve_runtime_discovery_bundle(ctx, &query).await;
            let recipes = discovery_bundle.skill_recipes();

            let mut result = StepResult::success();
            if let Some(prompt) = render_skill_recipe_prompt(&recipes) {
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
                    Some(json!({ "count": recipes.len() })),
                ))
                .with_metrics(json!({ "recipe_count": recipes.len() })))
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
            );
            let prelude_messages = control_plane_result.prompt_plan.prelude_messages.clone();
            let local_context = control_plane_result.prompt_plan.local_context.clone();
            let response_language = control_plane_result.prompt_plan.response_language;
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


