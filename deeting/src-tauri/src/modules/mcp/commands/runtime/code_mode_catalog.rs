use super::core_tool_contracts::build_core_tool_function_entries;

pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    let mut tools = build_core_tool_function_entries();
    tools.extend(vec![
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert capabilities by intent query and return top candidates. This tool only searches and does not change reply personality by itself.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": { "type": "string", "description": "The intent or task description to search for expert capabilities." },
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
                    "name": "attach_capability",
                    "description": "Attach an expert capability explicitly for the current request-scoped agent loop. This augments domain capability without changing reply personality.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "capability_id": { "type": "string", "description": "Capability id returned by consult_expert_network." },
                            "reason": { "type": "string", "description": "Optional reason for the capability attachment decision." }
                        },
                        "required": ["capability_id"]
                    }
                }
            }),
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "detach_capability",
                    "description": "Detach the current request-scoped expert capability and return to the default capability-neutral context.",
                    "parameters": { "type": "object", "properties": { "reason": { "type": "string", "description": "Optional reason for the capability detachment." } } }
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
