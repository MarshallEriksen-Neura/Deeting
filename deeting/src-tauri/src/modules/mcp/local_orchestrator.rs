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

    fn emit_status(&self, stage: &str, code: &str, meta: Option<Value>) {
        if !self.status_stream {
            return;
        }
        let mut payload = json!({
            "type": "status",
            "stage": stage,
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

trait LocalWorkflowStep: Send + Sync {
    fn execute<'a>(&'a self, ctx: &'a mut LocalWorkflowContext) -> BoxFuture<'a, Result<(), String>>;
}

struct AssistantPromptInjectionStep;

impl LocalWorkflowStep for AssistantPromptInjectionStep {
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

impl LocalWorkflowStep for SemanticMemoryInjectionStep {
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
                "semantic.memory.loaded",
                Some(json!({ "count": memories.items.len() })),
            );
            Ok(())
        })
    }
}

struct ActivePersonaInjectionStep;

impl LocalWorkflowStep for ActivePersonaInjectionStep {
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

impl LocalWorkflowStep for TemplateRenderStep {
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
                "listen",
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
        "routing.selected",
        Some(json!({
            "provider_model_id": provider_model_id,
            "model_id": model_id,
            "candidates": 1,
        })),
    );

    let steps: Vec<Box<dyn LocalWorkflowStep>> = vec![
        Box::new(AssistantPromptInjectionStep),
        Box::new(SemanticMemoryInjectionStep),
        Box::new(ActivePersonaInjectionStep),
        Box::new(TemplateRenderStep),
    ];
    for step in steps {
        step.execute(&mut ctx).await?;
    }

    ctx.emit_status("evolve", "upstream.request.batch", None);
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
    ctx.emit_status("render", "upstream.streaming", None);

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
