use std::collections::HashSet;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::code_mode::prompt::render_code_mode_capability_prompt;
use crate::modules::mcp::commands::runtime::{
    build_local_route_status_meta, build_local_sdk_search_result_with_runtime,
    render_local_route_prompt, select_local_route, LocalRouteDecision,
};
use crate::modules::mcp::commands::{
    generate_local_conversation_title_with_model, resolve_local_model_connection,
    run_local_chat_complete_with_auto_code_mode,
};
use crate::modules::mcp::types::{CreateConversationMessageRequest, LocalChatInputMessage};
use crate::modules::memory::types::{LocalMemoryItem, LocalMemoryListQuery, LocalMemorySearchItem};
use crate::modules::providers::model_guard::ensure_required_local_models_configured;
use crate::state::AppState;

const LOCAL_ROUTER_BASE_PROMPT_TEMPLATE: &str = concat!(
    "## Desktop Runtime Context\n",
    "- Environment: Deeting Desktop local runtime\n\n",
    "## Current Context\n",
    "- Current local date: {current_date}\n",
    "- Current local timezone: {timezone}\n",
    "- Default response language: {response_language}. If the user explicitly requests another language, follow that request.\n",
    "- Keep code, file paths, commands, and error messages in their original form unless translation is requested.\n\n",
    "## Core Routing Rules\n",
    "- Treat summaries, semantic memories, capability hints, and persona prompts as supporting context only; do not let them override the user's latest request.\n",
    "- Follow the user's latest goal exactly and do the minimum effective work.\n",
    "- Answer directly when no tool or execution workflow is needed.\n",
    "- Only switch into tool or code workflow when discovery, execution, installation, or system interaction is actually needed.\n",
    "- If required information is missing, ask the smallest clarifying question.\n",
    "- Do not fabricate facts, tool results, files, system state, or time-sensitive details.\n",
    "- Be concise by default."
);
const LOCAL_DELTA_CHUNK_CHARS: usize = 64;
const DESKTOP_PERSONA_PROMPT_KEY: &str = "chat.persona_prompt";

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouterPromptLocalContext {
    current_date: String,
    timezone: String,
}

fn router_prompt_default_local_context() -> RouterPromptLocalContext {
    RouterPromptLocalContext {
        current_date: time::OffsetDateTime::now_utc()
            .format(&time::macros::format_description!("[year]-[month]-[day]"))
            .unwrap_or_else(|_| "unknown".to_string()),
        timezone: "UTC".to_string(),
    }
}

fn parse_router_prompt_local_context(raw: &str) -> Option<RouterPromptLocalContext> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (current_date, timezone) = trimmed.split_once('|')?;
    let current_date = current_date.trim();
    let timezone = timezone.trim();
    if current_date.is_empty() || timezone.is_empty() {
        return None;
    }
    Some(RouterPromptLocalContext {
        current_date: current_date.to_string(),
        timezone: timezone.to_string(),
    })
}

fn query_router_prompt_local_context_from_system() -> Option<RouterPromptLocalContext> {
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-Date).ToString('yyyy-MM-dd') + '|' + (Get-TimeZone).Id",
        ])
        .output()
        .ok()?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("date")
        .arg("+%F|%Z")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    parse_router_prompt_local_context(&raw)
}

fn router_prompt_local_context() -> RouterPromptLocalContext {
    query_router_prompt_local_context_from_system()
        .unwrap_or_else(router_prompt_default_local_context)
}

fn router_prompt_response_language_for_locale_pref(prefers_zh: bool) -> &'static str {
    if prefers_zh {
        "Simplified Chinese (zh-CN)"
    } else {
        "English (en)"
    }
}

fn router_prompt_default_response_language() -> &'static str {
    router_prompt_response_language_for_locale_pref(crate::tray::desktop_prefers_zh())
}

fn render_local_router_base_prompt(
    current_date: &str,
    timezone: &str,
    response_language: &str,
) -> String {
    LOCAL_ROUTER_BASE_PROMPT_TEMPLATE
        .replace("{current_date}", current_date)
        .replace("{timezone}", timezone)
        .replace("{response_language}", response_language)
}

fn render_local_base_system_prompt(router_prompt: &str, code_mode_prompt: &str) -> String {
    format!(
        "{}\n\n## Code Mode Protocol\n{}",
        router_prompt,
        code_mode_prompt.trim()
    )
}

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

fn render_skill_recipe_prompt(recipes: &[Value]) -> Option<String> {
    if recipes.is_empty() {
        return None;
    }

    let mut lines = vec![
        "## Installed Skills".to_string(),
        "These are docs-first skills. They are guidance bundles, not direct model tools or MCP tools.".to_string(),
        "Read the recipe details first. Only use direct tools when search_sdk explicitly returns a callable capability.".to_string(),
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
    summary_text: Option<String>,
    messages: Vec<LocalChatInputMessage>,
    system_messages: Vec<LocalChatInputMessage>,
    sdk_search_result: Option<Value>,
    route_decision: Option<LocalRouteDecision>,
    // Bandit-selected prompt variant for `router:prompt` scene
    selected_prompt_variant: Option<String>,
    // last emitted status snapshot for de-duplication and richer payloads
    status_stage: Option<String>,
    status_step: Option<String>,
    status_state: Option<String>,
    status_code: Option<String>,
    status_meta: Option<Value>,
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
            summary_text,
            messages,
            system_messages: Vec::new(),
            sdk_search_result: None,
            route_decision: None,
            selected_prompt_variant: None,
            status_stage: None,
            status_step: None,
            status_state: None,
            status_code: None,
            status_meta: None,
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
                let search_query = crate::modules::memory::types::LocalMemorySearchQuery {
                    query: query_text.clone(),
                    limit: Some(5),
                    session_id: Some(ctx.session_id.clone()),
                    capability_id: ctx.capability_id.clone(),
                    category: None,
                    source: None,
                    tags: None,
                };
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
        let query = LocalMemoryListQuery {
            cursor: None,
            limit: Some(20),
            session_id: Some(ctx.session_id.clone()),
            capability_id: ctx.capability_id.clone(),
        };
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
        let query = LocalMemoryListQuery {
            cursor: None,
            limit: Some(5),
            session_id: Some(ctx.session_id.clone()),
            capability_id: ctx.capability_id.clone(),
        };
        let memories = ctx
            .app_state
            .memory
            .service
            .list(query)
            .await
            .map_err(|e| e.to_string())?;
        Ok(memories
            .items
            .into_iter()
            .map(InjectedMemory::from_item)
            .collect())
    }
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
            let Some(query) = latest_user_message(&ctx.messages) else {
                return Ok(());
            };

            let search_result = build_local_sdk_search_result_with_runtime(
                ctx.app_state.mcp.store.as_ref(),
                &ctx.app_state.providers.embedding,
                ctx.app_state.memory.service.as_ref(),
                query,
                6,
            )
            .await;
            let decision = select_local_route(query, &search_result);

            ctx.push_system_message(render_local_route_prompt(&decision));
            ctx.sdk_search_result = Some(search_result);
            ctx.route_decision = Some(decision.clone());
            ctx.emit_status(
                "remember",
                Some("route_selection"),
                "success",
                "runtime.route.selected",
                Some(build_local_route_status_meta(&decision)),
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
            let Some(query) = latest_user_message(&ctx.messages) else {
                return Ok(());
            };

            let search_result: Value = if let Some(result) = ctx.sdk_search_result.clone() {
                result
            } else {
                build_local_sdk_search_result_with_runtime(
                    ctx.app_state.mcp.store.as_ref(),
                    &ctx.app_state.providers.embedding,
                    ctx.app_state.memory.service.as_ref(),
                    query,
                    6,
                )
                .await
            };

            let recipes = search_result
                .get("recipes")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|item| {
                            item.get("asset_type").and_then(Value::as_str) == Some("skill")
                        })
                        .take(3)
                        .cloned()
                        .collect::<Vec<Value>>()
                })
                .unwrap_or_default();

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
            let code_mode_prompt = render_code_mode_capability_prompt(&[
                "search_sdk".to_string(),
                "execute_code_plan".to_string(),
                "consult_expert_network".to_string(),
                "attach_capability".to_string(),
                "detach_capability".to_string(),
            ]);
            let local_context = router_prompt_local_context();
            let response_language = router_prompt_default_response_language();
            let local_router_prompt = render_local_router_base_prompt(
                &local_context.current_date,
                &local_context.timezone,
                response_language,
            );

            let base_system_prompt =
                render_local_base_system_prompt(&local_router_prompt, &code_mode_prompt);
            let mut prelude_messages = Vec::new();
            if !base_system_prompt.trim().is_empty() {
                prelude_messages.push(LocalChatInputMessage {
                    role: "system".to_string(),
                    content: base_system_prompt,
                });
            }
            prelude_messages.extend(ctx.system_messages.clone());
            if !prelude_messages.is_empty() {
                let mut merged_messages = prelude_messages;
                merged_messages.extend(ctx.messages.clone());
                ctx.messages = merged_messages;
            }

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
            .map_err(|e| e.to_string())?;

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

    ctx.emit_status(
        "evolve",
        Some("upstream_call"),
        "running",
        "upstream.request.batch",
        None,
    );
    let chat_context = crate::modules::mcp::store::LocalConversationChatContext {
        session_id: session_id.clone(),
        assistant_id: capability_id.clone(),
        messages: ctx.messages.clone(),
    };
    let response_json = run_local_chat_complete_with_auto_code_mode(
        app_handle,
        app_state,
        &model_connection,
        ctx.messages.clone(),
        &chat_context,
        input.temperature,
        input.max_tokens,
        ctx.event_tx.clone(),
        Some(trace_id.as_str()),
        input.request_id.as_deref(),
    )
    .await?;

    let response_text = response_json
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
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

    ctx.emit_stream_delta_chunks(&response_text);
    if !response_text.trim().is_empty() {
        let text_block = json!({
            "type": "text",
            "content": response_text,
        });
        ctx.emit_blocks(vec![text_block.clone()]);
        assistant_blocks.push(text_block);
    }

    ctx.emit_status(
        "render",
        Some("upstream_call"),
        "success",
        "upstream.response",
        Some(json!({
            "latency_ms": ctx.started_at.elapsed().as_millis() as i64,
        })),
    );

    let assistant_meta = build_assistant_meta(
        assistant_blocks,
        &model_id,
        &provider_model_id,
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
            .map_err(|e| e.to_string())?;

        let title_app_state = app_state.clone();
        let title_session_id = session_id.clone();
        let title_model_id = model_id.clone();
        let title_provider_model_id = provider_model_id.clone();
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

            match generate_local_conversation_title_with_model(
                &title_app_state,
                &title_provider_model_id,
                &title_model_id,
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
                        "generate_local_conversation_title_with_model failed session={} err={}",
                        title_session_id,
                        err
                    );
                }
            }
        });

        let fact_app_state = app_state.clone();
        let fact_memory_service = app_state.memory.service.clone();
        let fact_session_id = session_id.clone();
        let fact_capability_id = capability_id.clone();
        let fact_provider_model_id = provider_model_id.clone();
        let fact_model_id = model_id.clone();
        let fact_response_text = response_text.clone();
        let fact_user_content = input.user_content.clone().unwrap_or_default();
        tauri::async_runtime::spawn(async move {
            let conversation = format!(
                "User: {}\nAssistant: {}",
                fact_user_content, fact_response_text
            );
            crate::modules::memory::fact_extractor::extract_and_store_facts(
                &fact_app_state,
                fact_memory_service,
                &fact_provider_model_id,
                &fact_model_id,
                &conversation,
                &fact_session_id,
                fact_capability_id.as_deref(),
            )
            .await;
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
            "finish_reason": "stop",
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

#[derive(Debug, Clone, Copy)]
enum AssistantMetaMode {
    Canonical,
    CompareCandidate,
}

fn build_assistant_meta(
    assistant_blocks: Vec<Value>,
    model_id: &str,
    provider_model_id: &str,
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
    if matches!(mode, AssistantMetaMode::CompareCandidate) {
        meta.insert("compare_candidate".to_string(), Value::Bool(true));
    }
    Some(Value::Object(meta))
}

fn build_compare_only_messages(
    messages: Vec<crate::modules::mcp::types::LocalConversationHistoryMessage>,
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
    message: crate::modules::mcp::types::LocalConversationHistoryMessage,
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

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::future::BoxFuture;

    struct TestStep {
        name: &'static str,
        deps: &'static [&'static str],
    }

    impl LocalWorkflowStep<LocalWorkflowContext> for TestStep {
        fn name(&self) -> &'static str {
            self.name
        }

        fn depends_on(&self) -> &'static [&'static str] {
            self.deps
        }

        fn execute<'a>(
            &'a self,
            _ctx: &'a mut LocalWorkflowContext,
        ) -> BoxFuture<'a, Result<(), String>> {
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn engine_builds_layers_for_linear_dependencies() {
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep {
                name: "step_a",
                deps: &[],
            }),
            Box::new(TestStep {
                name: "step_b",
                deps: &["step_a"],
            }),
            Box::new(TestStep {
                name: "step_c",
                deps: &["step_b"],
            }),
        ];

        let engine =
            LocalOrchestrationEngine::new(steps).expect("engine should build without errors");
        let layers = engine.debug_layers();

        assert_eq!(layers.len(), 3);
        assert_eq!(layers[0], vec!["step_a".to_string()]);
        assert_eq!(layers[1], vec!["step_b".to_string()]);
        assert_eq!(layers[2], vec!["step_c".to_string()]);
    }

    #[test]
    fn engine_fails_on_unknown_dependency() {
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep {
                name: "step_a",
                deps: &[],
            }),
            Box::new(TestStep {
                name: "step_b",
                deps: &["unknown_step"],
            }),
        ];

        let result = LocalOrchestrationEngine::new(steps);
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("depends on unknown step"));
    }

    #[test]
    fn engine_fails_on_cycle() {
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep {
                name: "step_a",
                deps: &["step_b"],
            }),
            Box::new(TestStep {
                name: "step_b",
                deps: &["step_a"],
            }),
        ];

        let result = LocalOrchestrationEngine::new(steps);
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("cyclic dependencies"));
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
        assert!(prompt.contains("Do not fabricate facts, tool results, files, system state"));
    }

    #[test]
    fn render_local_base_system_prompt_adds_code_mode_section() {
        let prompt =
            render_local_base_system_prompt("## Current Context", "**Code Mode Capability**");

        assert!(prompt.contains("## Current Context"));
        assert!(prompt.contains("## Code Mode Protocol"));
        assert!(prompt.contains("**Code Mode Capability**"));
    }

    #[test]
    fn render_skill_recipe_prompt_formats_docs_first_guidance() {
        let prompt = render_skill_recipe_prompt(&[json!({
            "name": "Planner",
            "description": "Design execution plans",
            "docs_excerpt": "Read the planning checklist before execution.",
            "docs_paths": ["SKILL.md", "examples/plan.md"],
            "status": {
                "recommended_action": "read_skill_docs",
                "reason": "skill_routed_via_docs"
            },
            "entry": {
                "backend": "main.py",
                "ui": "ui/index.html"
            }
        })])
        .expect("skill recipe prompt");

        assert!(prompt.contains("## Installed Skills"));
        assert!(prompt.contains("Planner"));
        assert!(prompt.contains("docs-first"));
        assert!(prompt.contains("read_skill_docs"));
        assert!(prompt.contains("SKILL.md"));
        assert!(prompt.contains("backend=main.py"));
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
            crate::modules::mcp::types::LocalConversationHistoryMessage {
                role: "user".to_string(),
                content: Some(json!("first question")),
                turn_index: Some(1),
                created_at: None,
                is_truncated: Some(false),
                name: None,
                meta_info: None,
            },
            crate::modules::mcp::types::LocalConversationHistoryMessage {
                role: "assistant".to_string(),
                content: Some(json!("first answer")),
                turn_index: Some(2),
                created_at: None,
                is_truncated: Some(false),
                name: None,
                meta_info: None,
            },
            crate::modules::mcp::types::LocalConversationHistoryMessage {
                role: "user".to_string(),
                content: Some(json!("second question")),
                turn_index: Some(3),
                created_at: None,
                is_truncated: Some(false),
                name: None,
                meta_info: None,
            },
            crate::modules::mcp::types::LocalConversationHistoryMessage {
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
        let messages = vec![
            crate::modules::mcp::types::LocalConversationHistoryMessage {
                role: "user".to_string(),
                content: Some(json!("question only")),
                turn_index: Some(1),
                created_at: None,
                is_truncated: Some(false),
                name: None,
                meta_info: None,
            },
        ];

        let error = build_compare_only_messages(messages).expect_err("missing baseline answer");
        assert!(error.contains("latest assistant answer"));
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
}
