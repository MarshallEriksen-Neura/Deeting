use super::core_tool_contracts::build_core_tool_function_entries;

pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    let mut tools = build_core_tool_function_entries();
    tools.extend(vec![
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert assistants by intent query and return top candidates. This tool only searches and does not switch persona context by itself.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": { "type": "string", "description": "The intent or task description to search for expert assistants." },
                            "k": { "type": "integer", "description": "Number of candidates to return.", "default": 3 },
                            "confidence": { "type": "number", "description": "Model confidence in the routing decision (0-1).", "default": 0 }
                        },
                        "required": ["intent_query", "confidence"]
                    }
                }
            }),
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "activate_assistant",
                    "description": "Activate an assistant explicitly for the current request-scoped agent loop. This switches persona context only after an explicit activation call.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assistant_id": { "type": "string", "description": "Assistant id returned by consult_expert_network." },
                            "reason": { "type": "string", "description": "Optional reason for the activation decision." }
                        },
                        "required": ["assistant_id"]
                    }
                }
            }),
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "deactivate_assistant",
                    "description": "Deactivate the current request-scoped assistant and return to the default base assistant context.",
                    "parameters": { "type": "object", "properties": { "reason": { "type": "string", "description": "Optional reason for the deactivation." } } }
                }
            })
        ]);
    serde_json::json!({
        "tools": tools
    })
}

pub(crate) async fn build_local_sdk_search_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
) -> serde_json::Value {
    crate::modules::capability_control_plane::build_search_sdk_result(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
    )
    .await
}
