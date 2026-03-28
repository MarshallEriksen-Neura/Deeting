use std::collections::HashSet;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::conversations::summary_generation::generate_local_conversation_title_with_secretary_model;
#[cfg(test)]
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::control_plane::select_custom_task_agent_candidate;
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::prompt_assets::PromptAssets;
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::prompt_plan::{
    build_local_prelude_messages, parse_router_prompt_local_context,
    render_local_router_base_prompt, render_local_runtime_system_prompt,
    router_prompt_default_local_context, router_prompt_response_language_for_locale_pref,
};
use crate::modules::desktop_runtime::runtime::resolve_local_model_connection;
#[cfg(test)]
use crate::modules::desktop_runtime::runtime::route_selector::{
    select_local_route, LocalRouteKind,
};
use crate::modules::desktop_runtime::runtime::{
    apply_desktop_execution_policy_overrides, build_default_local_execution_policy,
    build_local_control_plane_result, build_local_control_plane_status_meta,
    build_local_execution_policy, build_runtime_discovery_bundle_with_runtime,
    maybe_override_route_with_custom_task_agent, render_local_route_prompt,
    run_local_execution_plane, select_local_route_with_evidence, LocalControlPlaneResult,
    LocalExecutionPolicy, LocalExecutionRequest, LocalRouteDecision, RuntimeDiscoveryBundle,
};
use crate::modules::memory::types::{
    LocalMemoryItem, LocalMemoryListQuery, LocalMemorySearchItem, LocalMemorySearchQuery,
};
use crate::modules::providers::model_guard::ensure_required_local_models_configured;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use mcp_session::conversation::CreateConversationMessageRequest;
#[cfg(test)]
use std::collections::HashMap;

const LOCAL_DELTA_CHUNK_CHARS: usize = 64;
const DESKTOP_PERSONA_PROMPT_KEY: &str = "chat.persona_prompt";

fn latest_user_message(messages: &[LocalChatInputMessage]) -> Option<&str> {
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

async fn ensure_runtime_discovery_bundle(
    ctx: &mut LocalWorkflowContext,
    query: &str,
) -> RuntimeDiscoveryBundle {
    if let Some(bundle) = ctx.runtime_discovery.clone() {
        return bundle;
    }

    let bundle = build_runtime_discovery_bundle_with_runtime(
        ctx.app_state.mcp.store.as_ref(),
        &ctx.app_state.providers.embedding,
        ctx.app_state.memory.service.as_ref(),
        query,
        6,
    )
    .await;
    ctx.runtime_discovery = Some(bundle.clone());
    bundle
}

fn render_skill_recipe_prompt(recipes: &[Value]) -> Option<String> {
    if recipes.is_empty() {
        return None;
    }

    let mut lines = vec![
        "## Installed Skills".to_string(),
        "These are installed skill bundles. Recipe entries are supporting guidance only; the current request allowlist plus `search_sdk` capability results are the source of truth for what is executable right now.".to_string(),
        "Read the recipe details when helpful, but if `search_sdk` surfaces a callable direct capability for this request you may call it directly.".to_string(),
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
        lines.push(format!("- {} — {}", name, description));
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
            let ui = entry
                .get("ui")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if backend.is_some() || ui.is_some() {
                lines.push(format!(
                    "  - Bundle entry: backend={}, ui={}",
                    backend.unwrap_or("-"),
                    ui.unwrap_or("-")
                ));
            }
        }
    }

    Some(lines.join("\n"))
}

pub trait LocalWorkflowStep<C>: Send + Sync {
    fn name(&self) -> &'static str;

    fn depends_on(&self) -> &'static [&'static str] {
        &[]
    }

    fn execute<'a>(&'a self, ctx: &'a mut C) -> BoxFuture<'a, Result<(), String>>;
}

pub struct LocalOrchestrationEngine<C> {
    steps: std::collections::HashMap<String, Box<dyn LocalWorkflowStep<C>>>,
    execution_layers: Vec<Vec<String>>,
}

impl<C> LocalOrchestrationEngine<C> {
    pub fn new(steps: Vec<Box<dyn LocalWorkflowStep<C>>>) -> Result<Self, String> {
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

    pub async fn execute(&self, ctx: &mut C) -> Result<(), String> {
        for layer in &self.execution_layers {
            for name in layer {
                let step = self
                    .steps
                    .get(name)
                    .ok_or_else(|| format!("step '{}' not found in engine", name))?;
                step.execute(ctx).await?;
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn debug_layers(&self) -> &Vec<Vec<String>> {
        &self.execution_layers
    }
}
fn build_desktop_local_chat_engine(
) -> Result<LocalOrchestrationEngine<LocalWorkflowContext>, String> {
    LocalOrchestrationEngine::new(vec![
        Box::new(SummaryInjectionStep),
        Box::new(PersonaPromptInjectionStep),
        Box::new(SemanticMemoryInjectionStep),
        Box::new(SelectedKnowledgeInjectionStep),
        Box::new(RouteSelectionStep),
        Box::new(SkillRecipeInjectionStep),
        Box::new(ActiveCapabilityHintStep),
        Box::new(PromptVariantSelectionStep),
        Box::new(TemplateRenderStep),
    ])
}

#[derive(Debug, Clone)]
pub struct LocalOrchestratorInput {
    pub model: String,
    pub provider_model_id: Option<String>,
    pub explicit_task_agent_id: Option<String>,
    pub session_id: String,
    pub capability_id: Option<String>,
    pub regenerate: bool,
    pub compare_only: bool,
    pub user_content: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
    pub stream: bool,
    pub status_stream: bool,
    pub selected_knowledge_file_ids: Vec<String>,
}

struct LocalWorkflowContext {
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
}

impl LocalWorkflowContext {
    fn new(
        app_state: AppState,
        trace_id: String,
        request_id: Option<String>,
        input: &LocalOrchestratorInput,
        messages: Vec<LocalChatInputMessage>,
        capability_id: Option<String>,
        summary_text: Option<String>,
        event_tx: Option<UnboundedSender<String>>,
    ) -> Self {
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

    fn emit_status(
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

    fn emit_blocks(&self, blocks: Vec<Value>) {
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

    fn emit_stream_delta_chunks(&self, content: &str) {
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
}

struct SummaryInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for SummaryInjectionStep {
    fn name(&self) -> &'static str {
        "summary_injection"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let Some(summary_text) = ctx.summary_text.clone() else {
                ctx.emit_status(
                    "remember",
                    Some("summary_injection"),
                    "success",
                    "summary.empty",
                    None,
                );
                return Ok(());
            };

            ctx.push_system_message(format!("[SUMMARY]\n{}", summary_text));
            ctx.emit_status(
                "remember",
                Some("summary_injection"),
                "success",
                "summary.loaded",
                Some(json!({ "chars": summary_text.len() })),
            );
            Ok(())
        })
    }
}

struct PersonaPromptInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for PersonaPromptInjectionStep {
    fn name(&self) -> &'static str {
        "persona_prompt_injection"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
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
                return Ok(());
            }

            ctx.push_system_message(prompt.to_string());
            ctx.emit_status(
                "remember",
                Some("persona_prompt_injection"),
                "success",
                "persona.loaded",
                Some(json!({
                    "source": "desktop_config",
                    "key": DESKTOP_PERSONA_PROMPT_KEY,
                })),
            );
            Ok(())
        })
    }
}

struct SemanticMemoryInjectionStep;

#[derive(Debug, Clone)]
struct InjectedMemory {
    id: String,
    content: String,
    recall_when: Option<String>,
    memory_tier: Option<String>,
    is_core: bool,
    is_boot: bool,
}

const CORE_MEMORY_LIST_LIMIT: i64 = 20;
const FALLBACK_MEMORY_LIST_LIMIT: i64 = 5;
const SEMANTIC_MEMORY_SEARCH_LIMIT: usize = 5;

fn memory_meta_string(meta_info: &Option<Value>, key: &str) -> Option<String> {
    meta_info
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn memory_meta_bool(meta_info: &Option<Value>, key: &str) -> bool {
    meta_info
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn matches_recall_when(query: &str, recall_when: Option<&str>) -> bool {
    let hint = recall_when.unwrap_or("").trim().to_lowercase();
    if hint.is_empty() {
        return true;
    }
    let query_text = query.trim().to_lowercase();
    if query_text.is_empty() {
        return false;
    }
    if query_text.contains(&hint) || hint.contains(&query_text) {
        return true;
    }
    hint.replace([';', ',', '|'], " ")
        .split_whitespace()
        .filter(|token| token.len() > 1)
        .any(|token| query_text.contains(token))
}

fn build_global_semantic_memory_search_query(query: &str) -> LocalMemorySearchQuery {
    LocalMemorySearchQuery {
        query: query.to_string(),
        limit: Some(SEMANTIC_MEMORY_SEARCH_LIMIT),
        session_id: None,
        capability_id: None,
        category: None,
        source: None,
        tags: None,
    }
}

fn build_global_memory_list_query(limit: i64) -> LocalMemoryListQuery {
    LocalMemoryListQuery {
        cursor: None,
        limit: Some(limit),
        session_id: None,
        capability_id: None,
    }
}

fn build_scoped_memory_list_query(
    session_id: &str,
    capability_id: Option<&str>,
    limit: i64,
) -> LocalMemoryListQuery {
    LocalMemoryListQuery {
        cursor: None,
        limit: Some(limit),
        session_id: Some(session_id.to_string()),
        capability_id: capability_id.map(str::to_string),
    }
}

impl InjectedMemory {
    fn from_item(item: LocalMemoryItem) -> Self {
        let recall_when = memory_meta_string(&item.meta_info, "recall_when");
        let memory_tier = memory_meta_string(&item.meta_info, "memory_tier");
        let is_boot = memory_meta_bool(&item.meta_info, "is_boot");
        let is_core =
            memory_meta_bool(&item.meta_info, "is_core") || memory_tier.as_deref() == Some("core");
        Self {
            id: item.id,
            content: item.content,
            recall_when,
            memory_tier,
            is_core,
            is_boot,
        }
    }

    fn from_search_item(item: LocalMemorySearchItem) -> Self {
        let recall_when = memory_meta_string(&item.meta_info, "recall_when");
        let memory_tier = memory_meta_string(&item.meta_info, "memory_tier");
        let is_boot = memory_meta_bool(&item.meta_info, "is_boot");
        let is_core =
            memory_meta_bool(&item.meta_info, "is_core") || memory_tier.as_deref() == Some("core");
        Self {
            id: item.id,
            content: item.content,
            recall_when,
            memory_tier,
            is_core,
            is_boot,
        }
    }
}

impl LocalWorkflowStep<LocalWorkflowContext> for SemanticMemoryInjectionStep {
    fn name(&self) -> &'static str {
        "semantic_memory_injection"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            // Try vector search using the last user message
            let user_text = ctx
                .messages
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.clone());

            let query_text = user_text.unwrap_or_default();
            let core_memories = self.load_core_memories(ctx, &query_text).await?;
            let semantic_memories: Vec<InjectedMemory> = if !query_text.is_empty() {
                // Attempt semantic search
                let search_query = build_global_semantic_memory_search_query(&query_text);
                match ctx.app_state.memory.service.search(search_query).await {
                    Ok(result) if !result.items.is_empty() => result
                        .items
                        .into_iter()
                        .map(InjectedMemory::from_search_item)
                        .collect(),
                    Ok(_) | Err(_) => {
                        // Fallback to list (no embeddings yet or embedding service unavailable)
                        self.fallback_list(ctx).await?
                    }
                }
            } else {
                self.fallback_list(ctx).await?
            };

            let mut seen = HashSet::new();
            let mut core_lines = Vec::new();
            let mut semantic_lines = Vec::new();

            for memory in core_memories {
                if !seen.insert(memory.id.clone()) {
                    continue;
                }
                let text = memory.content.trim();
                if text.is_empty() {
                    continue;
                }
                core_lines.push(format!("- {}", text));
            }

            for memory in semantic_memories {
                if !seen.insert(memory.id.clone()) {
                    continue;
                }
                let text = memory.content.trim();
                if text.is_empty() {
                    continue;
                }
                semantic_lines.push(format!("- {}", text));
            }

            let total_count = core_lines.len() + semantic_lines.len();
            if total_count == 0 {
                ctx.emit_status(
                    "remember",
                    Some("semantic_memory_injection"),
                    "success",
                    "semantic.memory.loaded",
                    Some(json!({ "count": 0 })),
                );
                return Ok(());
            }

            if !core_lines.is_empty() {
                ctx.push_system_message(format!("## Core Memories\n{}", core_lines.join("\n")));
            }
            if !semantic_lines.is_empty() {
                ctx.push_system_message(format!(
                    "## Semantic Memories\n{}",
                    semantic_lines.join("\n")
                ));
            }

            ctx.emit_status(
                "remember",
                Some("semantic_memory_injection"),
                "success",
                "semantic.memory.loaded",
                Some(json!({ "count": total_count })),
            );
            Ok(())
        })
    }
}

impl SemanticMemoryInjectionStep {
    async fn load_core_memories(
        &self,
        ctx: &LocalWorkflowContext,
        query_text: &str,
    ) -> Result<Vec<InjectedMemory>, String> {
        let query = build_global_memory_list_query(CORE_MEMORY_LIST_LIMIT);
        let memories = ctx
            .app_state
            .memory
            .service
            .list(query)
            .await
            .map_err(|e| e.to_string())?;
        let mut items = memories
            .items
            .into_iter()
            .map(InjectedMemory::from_item)
            .filter(|item| {
                if item.is_boot {
                    return true;
                }
                if !(item.is_core || item.memory_tier.as_deref() == Some("core")) {
                    return false;
                }
                matches_recall_when(query_text, item.recall_when.as_deref())
            })
            .collect::<Vec<InjectedMemory>>();
        items.sort_by_key(|item| {
            (
                if item.is_boot { 0 } else { 1 },
                if item.is_core || item.memory_tier.as_deref() == Some("core") {
                    0
                } else {
                    1
                },
            )
        });
        Ok(items)
    }

    async fn fallback_list(
        &self,
        ctx: &LocalWorkflowContext,
    ) -> Result<Vec<InjectedMemory>, String> {
        let scoped_query = build_scoped_memory_list_query(
            &ctx.session_id,
            ctx.capability_id.as_deref(),
            FALLBACK_MEMORY_LIST_LIMIT,
        );
        let scoped_memories = ctx
            .app_state
            .memory
            .service
            .list(scoped_query)
            .await
            .map_err(|e| e.to_string())?;
        let scoped_items = scoped_memories
            .items
            .into_iter()
            .map(InjectedMemory::from_item)
            .collect::<Vec<_>>();
        if !scoped_items.is_empty() {
            return Ok(scoped_items);
        }

        let global_query = build_global_memory_list_query(FALLBACK_MEMORY_LIST_LIMIT);
        let global_memories = ctx
            .app_state
            .memory
            .service
            .list(global_query)
            .await
            .map_err(|e| e.to_string())?;
        Ok(global_memories
            .items
            .into_iter()
            .map(InjectedMemory::from_item)
            .collect())
    }
}

struct SelectedKnowledgeInjectionStep;

#[derive(Debug, Clone)]
struct SelectedKnowledgeDocumentContext {
    file_id: String,
    file_name: String,
    overview: Option<String>,
    leading_chunks: Vec<crate::modules::knowledge::types::LocalKnowledgeChunk>,
}

impl LocalWorkflowStep<LocalWorkflowContext> for SelectedKnowledgeInjectionStep {
    fn name(&self) -> &'static str {
        "selected_knowledge_injection"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if ctx.selected_knowledge_file_ids.is_empty() {
                return Ok(());
            }

            let query = latest_user_message(&ctx.messages)
                .and_then(normalize_knowledge_search_query)
                .unwrap_or_default();
            if query.is_empty() {
                ctx.emit_status(
                    "remember",
                    Some("selected_knowledge_injection"),
                    "success",
                    "knowledge.context.loaded",
                    Some(json!({
                        "selected_files": ctx.selected_knowledge_file_ids.len(),
                        "count": 0,
                        "query_empty": true,
                    })),
                );
                return Ok(());
            }

            ctx.emit_status(
                "remember",
                Some("selected_knowledge_injection"),
                "running",
                "knowledge.context.loading",
                Some(json!({
                    "selected_files": ctx.selected_knowledge_file_ids.len(),
                })),
            );

            let mut selected_ids = Vec::new();
            let mut selected_id_set = HashSet::new();
            for value in &ctx.selected_knowledge_file_ids {
                let normalized = value.trim().to_string();
                if normalized.is_empty() || !selected_id_set.insert(normalized.clone()) {
                    continue;
                }
                selected_ids.push(normalized);
            }
            if selected_ids.is_empty() {
                return Ok(());
            }

            let document_contexts =
                load_selected_knowledge_document_contexts(ctx, &selected_ids, 3).await;

            let mut lexical_search_failed = false;
            let mut selected_hits = Vec::new();
            if !query.is_empty() {
                let lexical_hits = match ctx
                    .app_state
                    .knowledge
                    .store
                    .search_local_knowledge_chunks(&query, Some(40))
                    .await
                {
                    Ok(value) => value,
                    Err(err) => {
                        lexical_search_failed = true;
                        log::warn!(
                            "selected_knowledge_injection: lexical search failed session={} err={}",
                            ctx.session_id,
                            err
                        );
                        Vec::new()
                    }
                };
                for hit in lexical_hits {
                    if !selected_id_set.contains(hit.file_id.as_str()) {
                        continue;
                    }
                    if looks_like_docx_field_artifact(&hit.content) {
                        continue;
                    }
                    selected_hits.push(hit);
                    if selected_hits.len() >= 4 {
                        break;
                    }
                }
            }

            let mut fallback_used = false;
            if selected_hits.is_empty() {
                fallback_used = true;
                selected_hits = build_selected_knowledge_fallback_hits(&document_contexts, 4);
            }

            let overview_lines = document_contexts
                .iter()
                .filter_map(|context| {
                    context
                        .overview
                        .as_ref()
                        .map(|overview| format!("- [{}] {}", context.file_name, overview))
                })
                .collect::<Vec<_>>();
            let excerpt_lines = selected_hits
                .iter()
                .map(|hit| {
                    let snippet = compact_knowledge_snippet(&hit.content, 260);
                    format!("- [{} #{}] {}", hit.file_name, hit.index + 1, snippet)
                })
                .collect::<Vec<_>>();

            if overview_lines.is_empty() && excerpt_lines.is_empty() {
                ctx.emit_status(
                    "remember",
                    Some("selected_knowledge_injection"),
                    "success",
                    "knowledge.context.loaded",
                    Some(json!({
                        "selected_files": selected_ids.len(),
                        "count": 0,
                        "overview_count": 0,
                        "fallback_used": fallback_used,
                        "search_error": lexical_search_failed,
                    })),
                );
                return Ok(());
            }

            let mut sections = Vec::new();
            if !overview_lines.is_empty() {
                sections.push(format!(
                    "## Selected Document Overviews\nThese are the user-selected local documents for this turn:\n{}",
                    overview_lines.join("\n")
                ));
            }
            if !excerpt_lines.is_empty() {
                sections.push(format!(
                    "## Selected Document Excerpts\nUse the following excerpts from the user-selected local documents when they are relevant:\n{}",
                    excerpt_lines.join("\n")
                ));
            }
            ctx.push_system_message(sections.join("\n\n"));

            ctx.emit_status(
                "remember",
                Some("selected_knowledge_injection"),
                "success",
                "knowledge.context.loaded",
                Some(json!({
                    "selected_files": selected_ids.len(),
                    "count": excerpt_lines.len(),
                    "overview_count": overview_lines.len(),
                    "fallback_used": fallback_used,
                    "search_error": lexical_search_failed,
                })),
            );
            Ok(())
        })
    }
}

async fn load_selected_knowledge_document_contexts(
    ctx: &LocalWorkflowContext,
    selected_ids: &[String],
    leading_chunk_limit: usize,
) -> Vec<SelectedKnowledgeDocumentContext> {
    let mut contexts = Vec::new();
    for file_id in selected_ids {
        let document = match ctx
            .app_state
            .knowledge
            .store
            .get_local_user_document(file_id)
            .await
        {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "selected_knowledge_injection: failed to load document session={} file_id={} err={}",
                    ctx.session_id,
                    file_id,
                    err
                );
                continue;
            }
        };
        let chunk_list = match ctx
            .app_state
            .knowledge
            .store
            .list_local_user_document_chunks(
                file_id,
                crate::modules::knowledge::types::LocalUserDocumentChunkListQuery {
                    offset: Some(0),
                    limit: Some(leading_chunk_limit as i64),
                },
            )
            .await
        {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "selected_knowledge_injection: chunk fallback failed session={} file_id={} err={}",
                    ctx.session_id,
                    file_id,
                    err
                );
                continue;
            }
        };
        let leading_chunks = chunk_list
            .items
            .into_iter()
            .filter(|chunk| !looks_like_docx_field_artifact(&chunk.content))
            .collect::<Vec<_>>();
        contexts.push(SelectedKnowledgeDocumentContext {
            file_id: document.id,
            file_name: document.name,
            overview: build_selected_document_overview(&leading_chunks),
            leading_chunks,
        });
    }
    contexts
}

fn build_selected_knowledge_fallback_hits(
    document_contexts: &[SelectedKnowledgeDocumentContext],
    limit: usize,
) -> Vec<crate::modules::knowledge::types::LocalKnowledgeSearchHit> {
    let mut hits = Vec::new();
    for context in document_contexts {
        for chunk in &context.leading_chunks {
            hits.push(crate::modules::knowledge::types::LocalKnowledgeSearchHit {
                chunk_id: chunk.id.clone(),
                file_id: context.file_id.clone(),
                file_name: context.file_name.clone(),
                index: chunk.index,
                content: chunk.content.clone(),
                token_count: chunk.token_count,
                score: 0.0,
            });
            if hits.len() >= limit {
                return hits;
            }
        }
    }
    hits
}

fn build_selected_document_overview(
    chunks: &[crate::modules::knowledge::types::LocalKnowledgeChunk],
) -> Option<String> {
    let preview = chunks
        .iter()
        .take(2)
        .map(|chunk| chunk.content.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let normalized = compact_knowledge_snippet(&preview, 220);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn looks_like_docx_field_artifact(content: &str) -> bool {
    let normalized = content.replace('\r', "").replace('\n', " ");
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.eq_ignore_ascii_case("\\h") {
        return true;
    }
    if trimmed.starts_with("\\h ") {
        return true;
    }
    if trimmed.starts_with("HYPERLINK \\l ") {
        return true;
    }
    if trimmed.contains("PAGEREF _Toc") {
        return true;
    }
    if trimmed.starts_with("TOC \\") {
        return true;
    }
    false
}

fn normalize_knowledge_search_query(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.starts_with('[') {
        return Some(trimmed.to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed).ok()?;
    let blocks = parsed.as_array()?;
    let mut text_parts = Vec::new();
    for block in blocks {
        let Some(block_type) = block.get("type").and_then(Value::as_str) else {
            continue;
        };
        if block_type != "text" {
            continue;
        }
        let text = block
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| block.get("content").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(value) = text {
            text_parts.push(value.to_string());
        }
    }
    if text_parts.is_empty() {
        return Some(trimmed.to_string());
    }
    Some(text_parts.join("\n"))
}

fn compact_knowledge_snippet(content: &str, max_chars: usize) -> String {
    let normalized = content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let compact = normalized.chars().take(max_chars).collect::<String>();
    format!("{}...", compact)
}

struct ActiveCapabilityHintStep;

impl LocalWorkflowStep<LocalWorkflowContext> for ActiveCapabilityHintStep {
    fn name(&self) -> &'static str {
        "active_capability_hint"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let latest_user_query = ctx
                .messages
                .iter()
                .rev()
                .find(|msg| msg.role.eq_ignore_ascii_case("user"))
                .map(|msg| msg.content.trim().to_string())
                .unwrap_or_default();
            if latest_user_query.is_empty() {
                return Ok(());
            }

            let vector = match ctx
                .app_state
                .providers
                .embedding
                .embed_text(&latest_user_query)
                .await
            {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };

            let hits = match ctx
                .app_state
                .memory
                .service
                .search_assets(vector, 6, Some("assistant"))
                .await
            {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };

            let current_capability_id = ctx.capability_id.clone().unwrap_or_default();
            let candidate = hits.into_iter().find(|hit| {
                let id = hit
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .trim();
                !id.is_empty() && id != current_capability_id
            });

            let Some(candidate) = candidate else {
                return Ok(());
            };

            let capability_name = candidate
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("capability")
                .to_string();
            let capability_desc = candidate
                .get("description")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            let capability_score = candidate.get("_distance").cloned().unwrap_or(Value::Null);

            let mut section = format!("## Active Capability Hint\nCapability: {}", capability_name);
            if !capability_desc.is_empty() {
                section.push_str(&format!("\nSummary: {}", capability_desc));
            }
            section.push_str(
                "\nUse this as domain capability guidance only. Do not change the fixed desktop persona or reply style.",
            );
            ctx.push_system_message(section);

            ctx.emit_status(
                "remember",
                Some("active_capability_hint"),
                "success",
                "semantic.capability.loaded",
                Some(json!({
                    "capability_name": capability_name,
                    "score": capability_score,
                })),
            );

            Ok(())
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

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
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
                    // No bandit data yet — default to "detailed"
                    PROMPT_VARIANT_DETAILED
                }
            };

            ctx.selected_prompt_variant = Some(selected.to_string());

            // Inject a style hint system message based on the selected variant
            let style_hint = match selected {
                PROMPT_VARIANT_CONCISE => "Respond concisely. Prefer short, direct answers.",
                _ => "Respond in detail. Provide thorough, comprehensive answers.",
            };
            ctx.push_system_message(format!("## Response Style\n{}", style_hint));

            ctx.emit_status(
                "remember",
                Some("prompt_variant_selection"),
                "success",
                "prompt.variant.selected",
                Some(json!({ "variant": selected })),
            );

            Ok(())
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
        &["semantic_memory_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let Some(query) = latest_user_message(&ctx.messages).map(str::to_string) else {
                return Ok(());
            };

            let discovery_bundle = ensure_runtime_discovery_bundle(ctx, &query).await;
            let decision = maybe_override_route_with_custom_task_agent(
                &ctx.app_state,
                ctx.explicit_task_agent_id.as_deref(),
                &query,
                select_local_route_with_evidence(&query, discovery_bundle.route_evidence.clone()),
            )
            .await?;
            let execution_policy = apply_desktop_execution_policy_overrides(
                ctx.app_state.mcp.store.as_ref(),
                build_local_execution_policy(&decision),
            )
            .await;

            ctx.push_system_message(render_local_route_prompt(&decision));
            ctx.runtime_discovery = Some(discovery_bundle);
            ctx.route_decision = Some(decision.clone());
            ctx.execution_policy = Some(execution_policy.clone());
            ctx.emit_status(
                "remember",
                Some("route_selection"),
                "success",
                "runtime.route.selected",
                Some(build_local_control_plane_status_meta(
                    &decision,
                    &execution_policy,
                )),
            );
            Ok(())
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
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let Some(query) = latest_user_message(&ctx.messages).map(str::to_string) else {
                return Ok(());
            };

            let discovery_bundle = ensure_runtime_discovery_bundle(ctx, &query).await;
            let recipes = discovery_bundle.skill_recipes();

            if let Some(prompt) = render_skill_recipe_prompt(&recipes) {
                ctx.push_system_message(prompt);
            }

            ctx.emit_status(
                "remember",
                Some("skill_recipe_injection"),
                "success",
                "skills.recipes.injected",
                Some(json!({ "count": recipes.len() })),
            );

            Ok(())
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
            "active_capability_hint",
            "prompt_variant_selection",
        ]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let control_plane_result = build_local_control_plane_result(
                &ctx.system_messages,
                ctx.runtime_discovery.clone(),
                ctx.route_decision.clone(),
                ctx.execution_policy.clone(),
            );
            let prelude_messages = control_plane_result.prompt_plan.prelude_messages.clone();
            if !prelude_messages.is_empty() {
                let mut merged_messages = prelude_messages;
                merged_messages.extend(ctx.messages.clone());
                ctx.messages = merged_messages;
            }
            let local_context = control_plane_result.prompt_plan.local_context.clone();
            let response_language = control_plane_result.prompt_plan.response_language;
            ctx.execution_policy = Some(control_plane_result.execution_policy.clone());
            ctx.control_plane_result = Some(control_plane_result);

            ctx.emit_status(
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
            );

            Ok(())
        })
    }
}

pub async fn execute_local_orchestrated_chat(
    app_handle: &AppHandle,
    app_state: &AppState,
    input: LocalOrchestratorInput,
    trace_id: String,
    event_tx: Option<UnboundedSender<String>>,
) -> Result<Value, String> {
    let session_id = input.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required for desktop local chat".to_string());
    }

    ensure_required_local_models_configured(app_state).await?;

    let store = &app_state.mcp.store;
    let (capability_id, summary_text, messages) = if input.compare_only {
        let runtime_window = store
            .load_local_conversation_runtime_window(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let capability_id = input
            .capability_id
            .clone()
            .or(runtime_window.assistant_id.clone());
        let summary_text = extract_summary_text(runtime_window.summary.as_ref());
        let messages = build_compare_only_messages(runtime_window.messages)?;
        (capability_id, summary_text, messages)
    } else if input.regenerate {
        let regenerate_ctx = store
            .prepare_local_conversation_regenerate(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let runtime_window = store
            .load_local_conversation_runtime_window(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let capability_id = input
            .capability_id
            .clone()
            .or(regenerate_ctx.assistant_id)
            .or(runtime_window.assistant_id.clone());
        let summary_text = extract_summary_text(runtime_window.summary.as_ref());
        let messages = runtime_window
            .messages
            .into_iter()
            .map(convert_history_message_to_chat_input)
            .collect();
        (capability_id, summary_text, messages)
    } else {
        let user_content = input
            .user_content
            .clone()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "missing user message content".to_string())?;

        store
            .ensure_local_conversation_for_session_id(&session_id)
            .await
            .map_err(|e| {
                format!(
                    "chat step=ensure_conversation session={} err={}",
                    session_id, e
                )
            })?;

        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "user".to_string(),
                content: user_content,
                name: None,
                meta_info: None,
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .map_err(|e| {
                format!(
                    "chat step=append_user_message session={} err={}",
                    session_id, e
                )
            })?;

        let runtime_window = store
            .load_local_conversation_runtime_window(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let capability_id = input
            .capability_id
            .clone()
            .or(runtime_window.assistant_id.clone());
        let summary_text = extract_summary_text(runtime_window.summary.as_ref());
        let messages = runtime_window
            .messages
            .into_iter()
            .map(convert_history_message_to_chat_input)
            .collect();
        (capability_id, summary_text, messages)
    };

    let mut ctx = LocalWorkflowContext::new(
        app_state.clone(),
        trace_id.clone(),
        input.request_id.clone(),
        &input,
        messages,
        capability_id.clone(),
        summary_text.clone(),
        event_tx,
    );
    ctx.emit_status(
        "remember",
        Some("conversation_load"),
        "success",
        "context.loaded",
        Some(json!({
            "count": ctx.messages.len(),
            "capability_id": capability_id,
            "has_summary": summary_text.is_some(),
        })),
    );

    let model_connection =
        resolve_local_model_connection(app_state, &input.model, input.provider_model_id.as_deref())
            .await?;
    let provider_model_id = model_connection.provider_model_id.clone();
    let model_id = model_connection.model_id.clone();
    if !input.compare_only {
        if let Err(err) = store
            .update_local_conversation_model_context(
                &session_id,
                Some(model_id.as_str()),
                Some(provider_model_id.as_str()),
            )
            .await
        {
            log::warn!(
                "update_local_conversation_model_context failed session={} err={}",
                session_id,
                err
            );
        }
    }
    ctx.emit_status(
        "remember",
        Some("routing"),
        "success",
        "routing.selected",
        Some(json!({
            "provider_model_id": provider_model_id,
            "model_id": model_id,
            "candidates": 1,
        })),
    );

    let engine = build_desktop_local_chat_engine()?;
    engine.execute(&mut ctx).await?;

    let execution_policy = ctx
        .control_plane_result
        .as_ref()
        .map(|result| result.execution_policy.clone())
        .or_else(|| ctx.execution_policy.clone())
        .clone()
        .unwrap_or_else(build_default_local_execution_policy);
    let execution_outcome = run_local_execution_plane(
        LocalExecutionRequest {
            app_handle: app_handle.clone(),
            app_state: app_state.clone(),
            model_connection: model_connection.clone(),
            session_id: session_id.clone(),
            capability_id: capability_id.clone(),
            explicit_task_agent_id: input.explicit_task_agent_id.clone(),
            messages: ctx.messages.clone(),
            execution_policy: execution_policy.clone(),
            temperature: input.temperature,
            max_tokens: input.max_tokens,
            event_tx: ctx.event_tx.clone(),
            trace_id: Some(trace_id.clone()),
            request_id: input.request_id.clone(),
        },
        |stage, step, state, code, meta| {
            ctx.emit_status(stage, step, state, code, meta);
        },
    )
    .await?;
    let delegated_worker = execution_outcome.delegated_worker;
    let response_json = execution_outcome.response_json;

    let mut response_text = response_json
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let mut response_text_was_synthesized_from_error = false;
    ctx.emit_status(
        "render",
        Some("upstream_call"),
        "streaming",
        "upstream.streaming",
        None,
    );

    let mut assistant_blocks = Vec::<Value>::new();
    let tool_trace_streamed = response_json
        .get("tool_trace_streamed")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if let Some(execution) = delegated_worker.as_ref() {
        if !execution.trace_blocks.is_empty() {
            ctx.emit_blocks(execution.trace_blocks.clone());
            assistant_blocks.extend(execution.trace_blocks.clone());
        }
    }
    if let Some(tool_trace_blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(|value| value.as_array())
        .filter(|value| !value.is_empty())
    {
        let trace_blocks = tool_trace_blocks.to_vec();
        if !tool_trace_streamed {
            ctx.emit_blocks(trace_blocks.clone());
        }
        assistant_blocks.extend(trace_blocks);
    }

    if response_text.trim().is_empty() {
        if let Some(summary) = latest_tool_error_summary(
            &assistant_blocks,
            fallback_prefers_chinese(ctx.control_plane_result.as_ref()),
        ) {
            response_text = summary;
            response_text_was_synthesized_from_error = true;
        }
    }

    ctx.emit_stream_delta_chunks(&response_text);
    if !response_text.trim().is_empty() {
        let text_block = json!({
            "type": "text",
            "content": response_text,
        });
        ctx.emit_blocks(vec![text_block.clone()]);
        assistant_blocks.push(text_block);
    }

    let total_latency_ms = ctx.started_at.elapsed().as_millis() as i64;
    let (upstream_latency_ms, ttft_ms, upstream_calls) =
        extract_response_runtime_metrics(&response_json);
    let orchestrator_latency_ms = upstream_latency_ms
        .map(|value| total_latency_ms.saturating_sub(value))
        .unwrap_or(total_latency_ms);
    let mut upstream_response_meta = serde_json::Map::new();
    upstream_response_meta.insert("latency_ms".to_string(), json!(total_latency_ms));
    upstream_response_meta.insert("total_latency_ms".to_string(), json!(total_latency_ms));
    upstream_response_meta.insert(
        "orchestrator_latency_ms".to_string(),
        json!(orchestrator_latency_ms),
    );
    if let Some(value) = upstream_latency_ms.filter(|value| *value > 0) {
        upstream_response_meta.insert("upstream_latency_ms".to_string(), json!(value));
    }
    if let Some(value) = ttft_ms.filter(|value| *value > 0) {
        upstream_response_meta.insert("ttft_ms".to_string(), json!(value));
    }
    if let Some(value) = upstream_calls.filter(|value| *value > 0) {
        upstream_response_meta.insert("upstream_calls".to_string(), json!(value));
    }
    let runtime_metrics_value = Value::Object(upstream_response_meta.clone());
    ctx.emit_status(
        "render",
        Some("upstream_call"),
        "success",
        "upstream.response",
        Some(runtime_metrics_value.clone()),
    );

    let assistant_meta = build_assistant_meta(
        assistant_blocks,
        &model_id,
        &provider_model_id,
        Some(runtime_metrics_value),
        if input.compare_only {
            AssistantMetaMode::CompareCandidate
        } else {
            AssistantMetaMode::Canonical
        },
    );
    if !input.compare_only {
        store
            .append_local_conversation_message(CreateConversationMessageRequest {
                session_id: session_id.clone(),
                role: "assistant".to_string(),
                content: response_text.clone(),
                name: None,
                meta_info: assistant_meta.clone(),
                is_truncated: Some(false),
                parent_message_id: None,
            })
            .await
            .map_err(|e| {
                format!(
                    "chat step=append_assistant_message session={} err={}",
                    session_id, e
                )
            })?;

        let title_app_state = app_state.clone();
        let title_session_id = session_id.clone();
        tauri::async_runtime::spawn(async move {
            let title_context = match title_app_state
                .mcp
                .store
                .get_local_conversation_title_context(&title_session_id)
                .await
            {
                Ok(value) => value,
                Err(err) => {
                    log::warn!(
                        "get_local_conversation_title_context failed session={} err={}",
                        title_session_id,
                        err
                    );
                    return;
                }
            };

            if title_context
                .title
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
            {
                return;
            }
            if title_context.message_count > 2 {
                return;
            }

            let Some(first_user_message) = title_context.first_user_message.as_deref() else {
                return;
            };

            match generate_local_conversation_title_with_secretary_model(
                &title_app_state,
                first_user_message,
                Some(title_session_id.as_str()),
            )
            .await
            {
                Ok(Some(title)) => {
                    if let Err(err) = title_app_state
                        .mcp
                        .store
                        .update_local_conversation_title_if_empty(&title_session_id, &title)
                        .await
                    {
                        log::warn!(
                            "update_local_conversation_title_if_empty failed session={} err={}",
                            title_session_id,
                            err
                        );
                    }
                }
                Ok(None) => {}
                Err(err) => {
                    log::warn!(
                        "generate_local_conversation_title_with_secretary_model failed session={} err={}",
                        title_session_id,
                        err
                    );
                }
            }
        });

        if let Some(variant) = ctx.selected_prompt_variant.clone() {
            let bandit_store = app_state.providers.store.clone();
            let prompt_success = !response_text.trim().is_empty();
            let prompt_latency = ctx.started_at.elapsed().as_millis() as f64;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bandit_store
                    .record_feedback_simple(
                        "router:prompt",
                        &variant,
                        prompt_success,
                        Some(prompt_latency),
                    )
                    .await
                {
                    log::warn!("bandit feedback failed for router:prompt: {}", e);
                }
            });
        }
    }

    let created = unix_seconds();
    let mut message = json!({
        "role": "assistant",
        "content": response_text,
    });
    if let Some(meta_info) = assistant_meta {
        if let Some(object) = message.as_object_mut() {
            object.insert("meta_info".to_string(), meta_info);
        }
    }

    let mut response = json!({
        "id": format!("chatcmpl-local-{}", Uuid::new_v4()),
        "object": "chat.completion",
        "created": created,
        "model": model_connection.model_id.clone(),
        "session_id": session_id,
        "trace_id": trace_id,
        "choices": [{
            "index": 0,
            "finish_reason": derive_local_finish_reason(response_text_was_synthesized_from_error),
            "message": message,
        }],
    });
    ctx.enrich_payload(&mut response);
    Ok(response)
}

fn extract_summary_text(summary: Option<&Value>) -> Option<String> {
    summary
        .and_then(|value| value.get("summary_text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_response_runtime_metrics(response: &Value) -> (Option<i64>, Option<i64>, Option<i64>) {
    let metrics = response
        .get("runtime_metrics")
        .and_then(|value| value.as_object());
    let upstream_latency_ms = metrics
        .and_then(|value| value.get("upstream_latency_ms"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    let ttft_ms = metrics
        .and_then(|value| value.get("ttft_ms"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    let upstream_calls = metrics
        .and_then(|value| value.get("upstream_calls"))
        .and_then(|value| value.as_i64())
        .filter(|value| *value > 0);
    (upstream_latency_ms, ttft_ms, upstream_calls)
}

#[derive(Debug, Clone, Copy)]
enum AssistantMetaMode {
    Canonical,
    CompareCandidate,
}

fn build_assistant_meta(
    assistant_blocks: Vec<Value>,
    model_id: &str,
    provider_model_id: &str,
    runtime_metrics: Option<Value>,
    mode: AssistantMetaMode,
) -> Option<Value> {
    let mut meta = serde_json::Map::new();
    if !assistant_blocks.is_empty() {
        meta.insert("blocks".to_string(), Value::Array(assistant_blocks));
    }
    meta.insert("model_id".to_string(), Value::String(model_id.to_string()));
    meta.insert(
        "provider_model_id".to_string(),
        Value::String(provider_model_id.to_string()),
    );
    if let Some(runtime_metrics) = runtime_metrics {
        meta.insert("runtime_metrics".to_string(), runtime_metrics);
    }
    if matches!(mode, AssistantMetaMode::CompareCandidate) {
        meta.insert("compare_candidate".to_string(), Value::Bool(true));
    }
    Some(Value::Object(meta))
}

fn build_compare_only_messages(
    messages: Vec<mcp_session::conversation::LocalConversationHistoryMessage>,
) -> Result<Vec<LocalChatInputMessage>, String> {
    let mut last_user_index = None;
    let mut last_assistant_index = None;

    for (index, message) in messages.iter().enumerate() {
        if message.role.eq_ignore_ascii_case("user") {
            last_user_index = Some(index);
            last_assistant_index = None;
            continue;
        }

        if message.role.eq_ignore_ascii_case("assistant")
            && last_user_index.is_some()
            && last_assistant_index.is_none()
        {
            last_assistant_index = Some(index);
        }
    }

    let last_user_index =
        last_user_index.ok_or_else(|| "compare_only requires an existing user turn".to_string())?;
    let last_assistant_index = last_assistant_index.ok_or_else(|| {
        "compare_only requires a latest assistant answer to compare against".to_string()
    })?;

    if last_assistant_index <= last_user_index {
        return Err(
            "compare_only requires a latest assistant answer to compare against".to_string(),
        );
    }

    Ok(messages
        .into_iter()
        .enumerate()
        .filter_map(|(index, message)| {
            if index == last_assistant_index {
                return None;
            }
            Some(convert_history_message_to_chat_input(message))
        })
        .collect())
}

fn convert_history_message_to_chat_input(
    message: mcp_session::conversation::LocalConversationHistoryMessage,
) -> LocalChatInputMessage {
    let content = message
        .content
        .as_ref()
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                Some(text.to_string())
            } else {
                serde_json::to_string(value).ok()
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    LocalChatInputMessage {
        role: message.role,
        content,
        tool_calls: vec![],
        tool_call_id: None,
        name: None,
    }
}

pub fn extract_user_text_from_messages(messages: &[Value]) -> Option<String> {
    for message in messages.iter().rev() {
        let Some(object) = message.as_object() else {
            continue;
        };
        let role = object
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if !role.eq_ignore_ascii_case("user") {
            continue;
        }

        let content = object.get("content").cloned().unwrap_or(Value::Null);
        let parsed = extract_content_text(content);
        if !parsed.trim().is_empty() {
            return Some(parsed);
        }
    }
    None
}

fn has_non_text_blocks(items: &[Value]) -> bool {
    items.iter().any(|item| {
        item.as_object()
            .and_then(|obj| obj.get("type").and_then(|v| v.as_str()))
            .map(|t| t != "text")
            .unwrap_or(false)
    })
}

fn strip_data_urls_from_blocks(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|item| {
            let Some(obj) = item.as_object() else {
                return Some(item);
            };
            let block_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            if block_type != "image_url" {
                return Some(item);
            }
            let image_url = obj.get("image_url");
            let url_str = image_url
                .and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()))
                })
                .unwrap_or_default();
            if url_str.starts_with("data:") {
                return None;
            }
            Some(item)
        })
        .collect()
}

fn extract_content_text(content: Value) -> String {
    match content {
        Value::String(text) => text,
        Value::Array(items) => {
            if has_non_text_blocks(&items) {
                let cleaned = strip_data_urls_from_blocks(items);
                if cleaned.is_empty() {
                    return String::new();
                }
                return serde_json::to_string(&cleaned).unwrap_or_default();
            }
            let mut out = Vec::new();
            for item in items {
                if let Some(obj) = item.as_object() {
                    let text = obj
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| obj.get("content").and_then(|value| value.as_str()));
                    if let Some(value) = text
                        .map(|value| value.trim())
                        .filter(|value| !value.is_empty())
                    {
                        out.push(value.to_string());
                    }
                }
            }
            if out.is_empty() {
                String::new()
            } else {
                out.join("\n")
            }
        }
        Value::Object(obj) => obj
            .get("text")
            .and_then(|value| value.as_str())
            .or_else(|| obj.get("content").and_then(|value| value.as_str()))
            .map(|value| value.to_string())
            .unwrap_or_else(|| serde_json::to_string(&Value::Object(obj)).unwrap_or_default()),
        Value::Null => String::new(),
        other => serde_json::to_string(&other).unwrap_or_default(),
    }
}

fn fallback_prefers_chinese(control_plane_result: Option<&LocalControlPlaneResult>) -> bool {
    control_plane_result
        .map(|result| result.prompt_plan.response_language)
        .map(|value| value.to_ascii_lowercase().contains("zh"))
        .unwrap_or_else(crate::tray::desktop_prefers_zh)
}

fn decorate_tool_error_message(error_message: &str, prefers_chinese: bool) -> String {
    let trimmed = error_message.trim();
    let lower = trimmed.to_ascii_lowercase();
    let is_output_encoding_failure = lower.contains("unicodeencodeerror")
        || lower.contains("codec can't encode character")
        || lower.contains("skill_output_encoding_error");

    if !is_output_encoding_failure {
        return trimmed.to_string();
    }

    if prefers_chinese {
        format!("本地技能输出编码失败：{}", trimmed)
    } else {
        format!("Local skill output encoding failed: {}", trimmed)
    }
}

fn latest_tool_error_summary(tool_trace_blocks: &[Value], prefers_chinese: bool) -> Option<String> {
    let error_block = tool_trace_blocks.iter().rev().find(|block| {
        block.get("type").and_then(Value::as_str) == Some("tool_result")
            && block.get("status").and_then(Value::as_str) == Some("error")
    })?;

    let tool_name = error_block
        .get("toolName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown_tool");
    let error_code = error_block
        .pointer("/result/error_code")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let error_message = error_block
        .pointer("/result/error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tool call failed");
    let error_message = decorate_tool_error_message(error_message, prefers_chinese);

    Some(if prefers_chinese {
        match error_code {
            Some(code) => format!(
                "工具调用失败：{}。原因：{}（错误码：{}）",
                tool_name, error_message, code
            ),
            None => format!("工具调用失败：{}。原因：{}", tool_name, error_message),
        }
    } else {
        match error_code {
            Some(code) => format!(
                "Tool call failed: {}. Reason: {} (error code: {})",
                tool_name, error_message, code
            ),
            None => format!("Tool call failed: {}. Reason: {}", tool_name, error_message),
        }
    })
}

fn derive_local_finish_reason(response_text_was_synthesized_from_error: bool) -> &'static str {
    if response_text_was_synthesized_from_error {
        "error"
    } else {
        "stop"
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "local_orchestrator/tests.rs"]
mod tests;
