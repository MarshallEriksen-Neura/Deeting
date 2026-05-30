use crate::modules::desktop_runtime::runtime::append_streamable_local_tool_result_blocks;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalRealtimeToolTraceEmitter
{
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<String>,
    request_id: Option<String>,
    emitted_execution_section: bool,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) emitted_any: bool,
    captured_blocks: Vec<serde_json::Value>,
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

    fn drain_blocks(rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>) -> Vec<serde_json::Value> {
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
        assert_eq!(blocks[1]["content"], serde_json::json!("收到主人！傻妞马上帮你分析～"));
        assert_eq!(blocks[2]["type"], serde_json::json!("tool_call"));
        assert_eq!(blocks[2]["callId"], serde_json::json!("call_abc"));
    }
}
