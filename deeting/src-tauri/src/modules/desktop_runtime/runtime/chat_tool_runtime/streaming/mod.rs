use crate::modules::desktop_runtime::runtime::append_streamable_local_tool_result_blocks;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalRealtimeToolTraceEmitter {
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
