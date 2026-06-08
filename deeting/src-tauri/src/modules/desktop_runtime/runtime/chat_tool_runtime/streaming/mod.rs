use std::collections::{HashMap, HashSet};

use crate::modules::desktop_runtime::runtime::append_streamable_local_tool_result_blocks;
use crate::modules::providers::streaming::ProviderStreamEvent;
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
struct StreamedToolCallProjection {
    call_id: Option<String>,
    name: Option<String>,
    arguments: String,
    emitted: bool,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalRealtimeToolTraceEmitter
{
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<String>,
    request_id: Option<String>,
    emitted_execution_section: bool,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) emitted_any: bool,
    captured_blocks: Vec<serde_json::Value>,
    streamed_tool_calls: HashMap<String, StreamedToolCallProjection>,
    streamed_tool_call_live_ids: HashSet<String>,
}

impl LocalRealtimeToolTraceEmitter {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn new(
        tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
        trace_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Self {
        Self {
            tx,
            trace_id: trace_id
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            request_id: request_id
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            emitted_execution_section: false,
            emitted_any: false,
            captured_blocks: Vec::new(),
            streamed_tool_calls: HashMap::new(),
            streamed_tool_call_live_ids: HashSet::new(),
        }
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_execution_section_once(
        &mut self,
        title: &str,
    ) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![
            serde_json::json!({ "type": "execution_section", "title": title }),
        ]);
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_tool_call_running(
        &mut self,
        call_id: &str,
        tool_name: &str,
    ) {
        let call_id = call_id.trim();
        let tool_name = tool_name.trim();
        if call_id.is_empty() || tool_name.is_empty() {
            return;
        }
        if self.streamed_tool_call_live_ids.contains(call_id) {
            self.mark_streamed_tool_call_debug(call_id, "executing", None);
            return;
        }
        self.emit_blocks(vec![serde_json::json!({
            "id": format!("{}-tool-call", call_id),
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": "running",
        })]);
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_tool_result_meta(
        &mut self,
        meta: &serde_json::Value,
    ) {
        let mut streamed_blocks = Vec::new();
        append_streamable_local_tool_result_blocks(&mut streamed_blocks, meta);
        self.emit_blocks(streamed_blocks);
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_thought(
        &mut self,
        reasoning: &str,
    ) {
        let trimmed = reasoning.trim();
        if trimmed.is_empty() {
            return;
        }
        self.emit_blocks(vec![serde_json::json!({
            "type": "thought",
            "content": trimmed,
        })]);
    }

    /// Stream the assistant's visible `content` for an intermediate tool-call
    /// round as a text block. Without this, any preamble the model writes in the
    /// same turn it issues tool calls (e.g. "let me check that first…") is
    /// silently dropped — only the final, tool-call-free round's content ever
    /// reaches the UI via the orchestrator's terminal text block.
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_text(
        &mut self,
        content: &str,
    ) {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return;
        }
        self.emit_blocks(vec![serde_json::json!({
            "type": "text",
            "content": trimmed,
        })]);
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn capture_text(
        &mut self,
        content: &str,
    ) {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return;
        }
        self.captured_blocks.push(serde_json::json!({
            "type": "text",
            "content": trimmed,
        }));
        self.emitted_any = true;
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_provider_stream_event(
        &mut self,
        event: ProviderStreamEvent,
        model: &str,
    ) {
        match event {
            ProviderStreamEvent::TextDelta(delta) => self.emit_text_delta_chunk(&delta, model),
            ProviderStreamEvent::ReasoningDelta(delta) => self.emit_thought(&delta),
            ProviderStreamEvent::ToolCallDelta {
                call_id,
                index,
                name,
                arguments_delta,
            } => self.record_streamed_tool_call_delta(call_id, index, name, arguments_delta),
            ProviderStreamEvent::ToolCallDone {
                call_id,
                name,
                arguments,
            } => self.record_streamed_tool_call_done(call_id, name, arguments),
            ProviderStreamEvent::Usage(usage) => self.emit_usage(usage.raw),
            ProviderStreamEvent::Error { message, code, raw } => {
                self.emit_provider_stream_error(message, code, raw)
            }
            ProviderStreamEvent::Done { .. } => {}
        }
    }

    fn record_streamed_tool_call_delta(
        &mut self,
        call_id: Option<String>,
        index: Option<usize>,
        name: Option<String>,
        arguments_delta: String,
    ) {
        let Some(key) = streamed_tool_call_key(call_id.as_deref(), index) else {
            return;
        };
        let mut projection = self.streamed_tool_calls.remove(&key).unwrap_or_else(|| {
            if call_id.is_some() {
                index
                    .and_then(|index| {
                        self.streamed_tool_calls
                            .remove(&streamed_tool_call_index_key(index))
                    })
                    .unwrap_or_default()
            } else {
                StreamedToolCallProjection::default()
            }
        });
        if call_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            projection.call_id = call_id.map(|value| value.trim().to_string());
        }
        if name
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            projection.name = name.map(|value| value.trim().to_string());
        }
        projection.arguments.push_str(arguments_delta.as_str());
        self.streamed_tool_calls.insert(key.clone(), projection);
        self.maybe_emit_streamed_tool_call(&key);
    }

    fn record_streamed_tool_call_done(&mut self, call_id: String, name: String, arguments: Value) {
        let call_id = call_id.trim().to_string();
        let name = name.trim().to_string();
        if call_id.is_empty() || name.is_empty() {
            return;
        }
        let key = streamed_tool_call_id_key(&call_id);
        let mut projection = self.streamed_tool_calls.remove(&key).unwrap_or_default();
        projection.call_id = Some(call_id.clone());
        projection.name = Some(name);
        projection.arguments = tool_arguments_to_debug_string(&arguments);
        self.streamed_tool_calls.insert(key.clone(), projection);
        self.maybe_emit_streamed_tool_call(&key);
        self.mark_streamed_tool_call_debug(&call_id, "proposed", Some(arguments));
    }

    fn maybe_emit_streamed_tool_call(&mut self, key: &str) {
        let Some(projection) = self.streamed_tool_calls.get_mut(key) else {
            return;
        };
        if projection.emitted {
            return;
        }
        let Some(call_id) = projection
            .call_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        else {
            return;
        };
        let Some(tool_name) = projection
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        else {
            return;
        };
        projection.emitted = true;
        self.streamed_tool_call_live_ids.insert(call_id.clone());
        self.emit_blocks(vec![serde_json::json!({
            "id": format!("{}-tool-call", call_id),
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": "running",
            "debug": {
                "provider_stream": true,
                "stream_state": "streaming",
            },
        })]);
    }

    fn mark_streamed_tool_call_debug(
        &mut self,
        call_id: &str,
        stream_state: &str,
        arguments: Option<Value>,
    ) {
        let call_id = call_id.trim();
        if call_id.is_empty() {
            return;
        }
        for block in self.captured_blocks.iter_mut().rev() {
            if block.get("type").and_then(Value::as_str) != Some("tool_call") {
                continue;
            }
            if block.get("callId").and_then(Value::as_str) != Some(call_id) {
                continue;
            }
            let Some(object) = block.as_object_mut() else {
                return;
            };
            let debug = object
                .entry("debug".to_string())
                .or_insert_with(|| serde_json::json!({}));
            if !debug.is_object() {
                *debug = serde_json::json!({});
            }
            if let Some(debug_object) = debug.as_object_mut() {
                debug_object.insert("provider_stream".to_string(), serde_json::json!(true));
                debug_object.insert("stream_state".to_string(), serde_json::json!(stream_state));
                if let Some(arguments) = arguments {
                    debug_object.insert("streamed_arguments".to_string(), arguments);
                }
            }
            return;
        }
    }

    fn emit_text_delta_chunk(&mut self, delta: &str, model: &str) {
        if delta.is_empty() {
            return;
        }
        let Some(tx) = &self.tx else {
            self.emitted_any = true;
            return;
        };
        let mut payload = serde_json::json!({
            "id": format!("chatcmpl-local-{}", Uuid::new_v4()),
            "object": "chat.completion.chunk",
            "created": unix_seconds(),
            "model": model,
            "choices": [{
                "index": 0,
                "delta": { "content": delta },
            }],
        });
        self.enrich_payload(&mut payload);
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
            self.emitted_any = true;
        }
    }

    fn emit_usage(&mut self, usage: serde_json::Value) {
        let Some(tx) = &self.tx else {
            return;
        };
        let mut payload = serde_json::json!({
            "type": "usage",
            "usage": usage,
        });
        self.enrich_payload(&mut payload);
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
        }
    }

    fn emit_provider_stream_error(
        &mut self,
        message: String,
        code: Option<String>,
        raw: Option<serde_json::Value>,
    ) {
        let Some(tx) = &self.tx else {
            return;
        };
        let mut payload = serde_json::json!({
            "type": "provider_stream_error",
            "message": message,
            "code": code,
            "raw": raw,
        });
        self.enrich_payload(&mut payload);
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
        }
    }

    /// Chronological snapshot of every block emitted this turn, in the exact
    /// order the agentic loop produced them (thought -> text -> tool_call ->
    /// tool_result, per round). This is the same stream the live UI received,
    /// so persisting it as the reload source guarantees history renders
    /// identically to the live turn. Captured even when no `tx` is wired
    /// (non-stream / resume paths), so callers always get the real order.
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn captured_render_blocks(
        &self,
    ) -> &[serde_json::Value] {
        &self.captured_blocks
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn emit_blocks(
        &mut self,
        blocks: Vec<serde_json::Value>,
    ) {
        if blocks.is_empty() {
            return;
        }
        self.captured_blocks.extend(blocks.iter().cloned());
        let Some(tx) = &self.tx else {
            self.emitted_any = true;
            return;
        };
        let mut payload = serde_json::json!({ "type": "blocks", "blocks": blocks });
        if let Some(object) = payload.as_object_mut() {
            if let Some(trace_id) = self.trace_id.as_ref() {
                object.insert("trace_id".to_string(), serde_json::json!(trace_id));
            }
            if let Some(request_id) = self.request_id.as_ref() {
                object.insert("request_id".to_string(), serde_json::json!(request_id));
            }
        }
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
            self.emitted_any = true;
        }
    }

    fn enrich_payload(&self, payload: &mut serde_json::Value) {
        let Some(object) = payload.as_object_mut() else {
            return;
        };
        if let Some(trace_id) = self.trace_id.as_ref() {
            object.insert("trace_id".to_string(), serde_json::json!(trace_id));
        }
        if let Some(request_id) = self.request_id.as_ref() {
            object.insert("request_id".to_string(), serde_json::json!(request_id));
        }
    }
}

fn unix_seconds() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

fn streamed_tool_call_key(call_id: Option<&str>, index: Option<usize>) -> Option<String> {
    call_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(streamed_tool_call_id_key)
        .or_else(|| index.map(streamed_tool_call_index_key))
}

fn streamed_tool_call_id_key(call_id: &str) -> String {
    format!("id:{}", call_id.trim())
}

fn streamed_tool_call_index_key(index: usize) -> String {
    format!("index:{index}")
}

fn tool_arguments_to_debug_string(arguments: &Value) -> String {
    match arguments {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(arguments).unwrap_or_else(|_| "{}".to_string()),
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_runtime_bridge_stream_target(
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
) -> Option<crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget> {
    let tx = realtime_emitter.tx.as_ref()?.clone();
    Some(
        crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget {
            tx,
            trace_id: realtime_emitter.trace_id.clone(),
            request_id: realtime_emitter.request_id.clone(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain_blocks(
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
    ) -> Vec<serde_json::Value> {
        let mut blocks = Vec::new();
        while let Ok(payload) = rx.try_recv() {
            let value: serde_json::Value =
                serde_json::from_str(&payload).expect("emitted payload must be valid json");
            assert_eq!(value["type"], serde_json::json!("blocks"));
            if let Some(array) = value["blocks"].as_array() {
                blocks.extend(array.iter().cloned());
            }
        }
        blocks
    }

    #[test]
    fn emit_text_streams_intermediate_content_block() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), Some("trace-1"), None);

        emitter.emit_text("  收到主人，让我先侦察一下  ");

        let blocks = drain_blocks(&mut rx);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], serde_json::json!("text"));
        assert_eq!(
            blocks[0]["content"],
            serde_json::json!("收到主人，让我先侦察一下")
        );
    }

    #[test]
    fn emit_text_skips_blank_content() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), None, None);

        emitter.emit_text("   \n  ");

        assert!(drain_blocks(&mut rx).is_empty());
        assert!(!emitter.emitted_any);
    }

    #[test]
    fn capture_text_keeps_history_block_without_live_emit() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), None, None);

        emitter.capture_text(" streamed already ");

        assert!(drain_blocks(&mut rx).is_empty());
        assert!(emitter.emitted_any);
        assert_eq!(emitter.captured_render_blocks().len(), 1);
        assert_eq!(
            emitter.captured_render_blocks()[0]["content"],
            serde_json::json!("streamed already")
        );
    }

    #[test]
    fn provider_tool_call_delta_projects_running_block() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), Some("trace-3"), None);

        emitter.emit_provider_stream_event(
            ProviderStreamEvent::ToolCallDelta {
                call_id: Some("call_stream_1".to_string()),
                index: Some(0),
                name: Some("search_sdk".to_string()),
                arguments_delta: "{\"query\":".to_string(),
            },
            "model-a",
        );

        let blocks = drain_blocks(&mut rx);
        assert_eq!(blocks.len(), 1);
        assert_eq!(
            blocks[0]["id"],
            serde_json::json!("call_stream_1-tool-call")
        );
        assert_eq!(blocks[0]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[0]["callId"], serde_json::json!("call_stream_1"));
        assert_eq!(blocks[0]["toolName"], serde_json::json!("search_sdk"));
        assert_eq!(blocks[0]["status"], serde_json::json!("running"));
        assert_eq!(
            blocks[0]["debug"]["provider_stream"],
            serde_json::json!(true)
        );
        assert_eq!(emitter.captured_render_blocks().len(), 1);
    }

    #[test]
    fn streamed_tool_call_running_dedupes_final_execution_running_block() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), None, None);

        emitter.emit_provider_stream_event(
            ProviderStreamEvent::ToolCallDelta {
                call_id: Some("call_stream_2".to_string()),
                index: Some(0),
                name: Some("search_sdk".to_string()),
                arguments_delta: String::new(),
            },
            "model-a",
        );
        let first_blocks = drain_blocks(&mut rx);
        assert_eq!(first_blocks.len(), 1);

        emitter.emit_tool_call_running("call_stream_2", "search_sdk");
        assert!(drain_blocks(&mut rx).is_empty());

        emitter.emit_tool_result_meta(&serde_json::json!({
            "id": "call_stream_2",
            "name": "search_sdk",
            "status": "success",
            "result": { "ok": true }
        }));

        let result_blocks = drain_blocks(&mut rx);
        assert_eq!(result_blocks.len(), 1);
        assert_eq!(result_blocks[0]["type"], serde_json::json!("tool_result"));
        assert_eq!(
            result_blocks[0]["callId"],
            serde_json::json!("call_stream_2")
        );
        assert_eq!(emitter.captured_render_blocks().len(), 2);
    }

    #[test]
    fn provider_tool_call_done_marks_captured_block_proposed() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), None, None);

        emitter.emit_provider_stream_event(
            ProviderStreamEvent::ToolCallDelta {
                call_id: Some("call_stream_3".to_string()),
                index: Some(0),
                name: Some("search_sdk".to_string()),
                arguments_delta: "{\"query\":".to_string(),
            },
            "model-a",
        );
        let _ = drain_blocks(&mut rx);
        emitter.emit_provider_stream_event(
            ProviderStreamEvent::ToolCallDone {
                call_id: "call_stream_3".to_string(),
                name: "search_sdk".to_string(),
                arguments: serde_json::json!({ "query": "rust" }),
            },
            "model-a",
        );

        assert!(drain_blocks(&mut rx).is_empty());
        let captured = emitter.captured_render_blocks();
        assert_eq!(captured.len(), 1);
        assert_eq!(
            captured[0]["debug"]["stream_state"],
            serde_json::json!("proposed")
        );
        assert_eq!(
            captured[0]["debug"]["streamed_arguments"],
            serde_json::json!({ "query": "rust" })
        );
    }

    #[test]
    fn intermediate_round_emits_thought_then_text_then_tool_call_in_order() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut emitter = LocalRealtimeToolTraceEmitter::new(Some(tx), Some("trace-2"), None);

        // Mirrors the agentic-loop order: reasoning -> visible content -> tool call.
        emitter.emit_thought("The user wants me to analyze the vault.");
        emitter.emit_text("收到主人！傻妞马上帮你分析～");
        emitter.emit_tool_call_running("call_abc", "search_sdk");

        let blocks = drain_blocks(&mut rx);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0]["type"], serde_json::json!("thought"));
        assert_eq!(blocks[1]["type"], serde_json::json!("text"));
        assert_eq!(
            blocks[1]["content"],
            serde_json::json!("收到主人！傻妞马上帮你分析～")
        );
        assert_eq!(blocks[2]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[2]["callId"], serde_json::json!("call_abc"));
    }
}
