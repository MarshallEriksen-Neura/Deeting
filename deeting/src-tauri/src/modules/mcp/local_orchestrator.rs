use std::time::{Instant, SystemTime, UNIX_EPOCH};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::modules::code_mode::prompt::render_code_mode_capability_prompt;
use crate::modules::mcp::commands::{
    resolve_local_model_connection, run_local_chat_complete_with_auto_code_mode,
};
use crate::modules::mcp::types::{CreateConversationMessageRequest, LocalChatInputMessage};
use crate::modules::memory::types::LocalMemoryListQuery;
use crate::modules::providers::model_guard::ensure_required_local_models_configured;
use crate::state::AppState;

const LOCAL_ROUTER_BASE_PROMPT: &str = "You are Deeting desktop local orchestrator. \
Follow user intent strictly, be concise, and avoid fabricating facts.";
const LOCAL_DELTA_CHUNK_CHARS: usize = 64;

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
                    return Err(format!(
                        "step '{}' depends on unknown step '{}'",
                        name, dep
                    ));
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
fn build_desktop_local_chat_engine() -> Result<LocalOrchestrationEngine<LocalWorkflowContext>, String> {
    LocalOrchestrationEngine::new(vec![
        Box::new(AssistantPromptInjectionStep),
        Box::new(SemanticMemoryInjectionStep),
        Box::new(ActivePersonaInjectionStep),
        Box::new(TemplateRenderStep),
    ])
}

#[derive(Debug, Clone)]
pub struct LocalOrchestratorInput {
    pub model: String,
    pub provider_model_id: Option<String>,
    pub session_id: String,
    pub assistant_id: Option<String>,
    pub regenerate: bool,
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
    assistant_id: Option<String>,
    assistant_name: Option<String>,
    messages: Vec<LocalChatInputMessage>,
    prompt_fragments: Vec<String>,
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
            assistant_id: Option<String>,
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
                assistant_id,
                assistant_name: None,
                messages,
                prompt_fragments: Vec::new(),
                status_stage: None,
                status_step: None,
                status_state: None,
                status_code: None,
                status_meta: None,
            }
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

struct AssistantPromptInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for AssistantPromptInjectionStep {
    fn name(&self) -> &'static str {
        "assistant_prompt_injection"
    }

    fn execute<'a>(&'a self, ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let Some(assistant_id) = ctx.assistant_id.clone() else {
                return Ok(());
            };

            let assistant = ctx
                .app_state
                .mcp
                .store
                .get_local_assistant(&assistant_id)
                .await
                .map_err(|e| e.to_string())?;
            let Some(assistant) = assistant else {
                return Ok(());
            };

            let prompt = assistant.system_prompt.trim();
            if prompt.is_empty() {
                return Ok(());
            }

            ctx.assistant_name = Some(assistant.name.clone());
            ctx.prompt_fragments
                .push(format!("## Assistant Persona\n{}", prompt));
            ctx.emit_status(
                "remember",
                Some("assistant_prompt_injection"),
                "success",
                "assistant.selected",
                Some(json!({
                    "assistant_id": assistant.id,
                    "assistant_name": assistant.name,
                })),
            );
            Ok(())
        })
    }
}

struct SemanticMemoryInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for SemanticMemoryInjectionStep {
    fn name(&self) -> &'static str {
        "semantic_memory_injection"
    }

    fn execute<'a>(&'a self, ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let query = LocalMemoryListQuery {
                cursor: None,
                limit: Some(5),
                session_id: Some(ctx.session_id.clone()),
                assistant_id: ctx.assistant_id.clone(),
            };
            let memories = ctx
                .app_state
                .memory
                .store
                .list(query)
                .await
                .map_err(|e| e.to_string())?;
            if memories.items.is_empty() {
                ctx.emit_status(
                    "remember",
                    Some("semantic_memory_injection"),
                    "success",
                    "semantic.memory.loaded",
                    Some(json!({ "count": 0 })),
                );
                return Ok(());
            }

            let lines = memories
                .items
                .iter()
                .filter_map(|item| {
                    let text = item.content.trim();
                    if text.is_empty() {
                        None
                    } else {
                        Some(format!("- {}", text))
                    }
                })
                .collect::<Vec<String>>();
            if !lines.is_empty() {
                ctx.prompt_fragments
                    .push(format!("## Semantic Memories\n{}", lines.join("\n")));
            }

            ctx.emit_status(
                "remember",
                Some("semantic_memory_injection"),
                "success",
                "semantic.memory.loaded",
                Some(json!({ "count": memories.items.len() })),
            );
            Ok(())
        })
    }
}

struct ActivePersonaInjectionStep;

impl LocalWorkflowStep<LocalWorkflowContext> for ActivePersonaInjectionStep {
    fn name(&self) -> &'static str {
        "active_persona_hint"
    }

    fn execute<'a>(&'a self, ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>> {
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

            let vector = match ctx.app_state.providers.embedding.embed_text(&latest_user_query).await {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };

            let hits = match ctx
                .app_state
                .memory
                .store
                .search_assets(vector, 6, Some("assistant"))
                .await
            {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };

            let current_assistant_id = ctx.assistant_id.clone().unwrap_or_default();
            let candidate = hits.into_iter().find(|hit| {
                let id = hit
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .trim();
                !id.is_empty() && id != current_assistant_id
            });

            let Some(candidate) = candidate else {
                return Ok(());
            };

            let persona_name = candidate
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("assistant")
                .to_string();
            let persona_desc = candidate
                .get("description")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            let persona_score = candidate.get("_distance").cloned().unwrap_or(Value::Null);

            let mut section = format!("## Active Persona Hint\nPersona: {}", persona_name);
            if !persona_desc.is_empty() {
                section.push_str(&format!("\nSummary: {}", persona_desc));
            }
            section.push_str("\nUse this as soft preference only if relevant.");
            ctx.prompt_fragments.push(section);

            ctx.emit_status(
                "remember",
                Some("active_persona_hint"),
                "success",
                "semantic.persona.loaded",
                Some(json!({
                    "assistant_name": persona_name,
                    "score": persona_score,
                })),
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
            "assistant_prompt_injection",
            "semantic_memory_injection",
            "active_persona_hint",
        ]
    }

    fn execute<'a>(&'a self, ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let code_mode_prompt = render_code_mode_capability_prompt(&[
                "search_sdk".to_string(),
                "execute_code_plan".to_string(),
            ]);

            let mut sections = vec![LOCAL_ROUTER_BASE_PROMPT.to_string()];
            sections.extend(ctx.prompt_fragments.clone());
            sections.push(format!("## Code Mode Capability\n{}", code_mode_prompt.trim()));

            let system_prompt = sections.join("\n\n");
            if !system_prompt.trim().is_empty() {
                ctx.messages.insert(
                    0,
                    LocalChatInputMessage {
                        role: "system".to_string(),
                        content: system_prompt,
                    },
                );
            }

            ctx.emit_status(
                "evolve",
                Some("template_render"),
                "success",
                "template.rendered",
                Some(json!({ "engine": "desktop_local_orchestrator" })),
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
    let (assistant_id, messages) = if input.regenerate {
        let regenerate_ctx = store
            .prepare_local_conversation_regenerate(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let assistant_id = input.assistant_id.clone().or(regenerate_ctx.assistant_id);
        (assistant_id, regenerate_ctx.messages)
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

        let chat_ctx = store
            .get_local_conversation_chat_context(&session_id)
            .await
            .map_err(|e| e.to_string())?;
        let assistant_id = input.assistant_id.clone().or(chat_ctx.assistant_id);
        (assistant_id, chat_ctx.messages)
    };

    let mut ctx = LocalWorkflowContext::new(
        app_state.clone(),
        trace_id.clone(),
        input.request_id.clone(),
        &input,
        messages,
        assistant_id.clone(),
        event_tx,
    );
    ctx.emit_status(
        "remember",
        Some("conversation_load"),
        "success",
        "context.loaded",
        Some(json!({
            "count": ctx.messages.len(),
            "assistant_id": assistant_id,
            "has_summary": false,
        })),
    );

    let model_connection = resolve_local_model_connection(
        app_state,
        &input.model,
        input.provider_model_id.as_deref(),
    )
    .await?;
    let provider_model_id = model_connection.provider_model_id.clone();
    let model_id = model_connection.model_id.clone();
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

    ctx.emit_status("evolve", Some("upstream_call"), "running", "upstream.request.batch", None);
    let chat_context = crate::modules::mcp::store::LocalConversationChatContext {
        session_id: session_id.clone(),
        assistant_id: assistant_id.clone(),
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
    )
    .await?;

    let response_text = response_json
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    ctx.emit_status("render", Some("upstream_call"), "streaming", "upstream.streaming", None);

    let mut assistant_blocks = Vec::<Value>::new();
    if let Some(tool_trace_blocks) = response_json
        .get("tool_trace_blocks")
        .and_then(|value| value.as_array())
        .filter(|value| !value.is_empty())
    {
        let trace_blocks = tool_trace_blocks.to_vec();
        ctx.emit_blocks(trace_blocks.clone());
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

    let assistant_meta = if assistant_blocks.is_empty() {
        None
    } else {
        Some(json!({ "blocks": assistant_blocks }))
    };
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
    let _ = store.touch_local_conversation_summary_idle_task(&session_id).await;

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

fn extract_content_text(content: Value) -> String {
    match content {
        Value::String(text) => text,
        Value::Array(items) => {
            let mut out = Vec::new();
            for item in items {
                if let Some(obj) = item.as_object() {
                    let text = obj
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| obj.get("content").and_then(|value| value.as_str()));
                    if let Some(value) = text.map(|value| value.trim()).filter(|value| !value.is_empty()) {
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

        fn execute<'a>(&'a self, _ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>> {
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn engine_builds_layers_for_linear_dependencies() {
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep { name: "step_a", deps: &[] }),
            Box::new(TestStep { name: "step_b", deps: &["step_a"] }),
            Box::new(TestStep { name: "step_c", deps: &["step_b"] }),
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
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep { name: "step_a", deps: &[] }),
            Box::new(TestStep { name: "step_b", deps: &["unknown_step"] }),
        ];

        let result = LocalOrchestrationEngine::new(steps);
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("depends on unknown step"));
    }

    #[test]
    fn engine_fails_on_cycle() {
        let steps: Vec<Box<dyn LocalWorkflowStep<LocalWorkflowContext>>> = vec![
            Box::new(TestStep { name: "step_a", deps: &["step_b"] }),
            Box::new(TestStep { name: "step_b", deps: &["step_a"] }),
        ];

        let result = LocalOrchestrationEngine::new(steps);
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("cyclic dependencies"));
    }
}
