use serde_json::Value;

pub(crate) fn extract_direct_callable_capability_names(
    search_result: &Value,
) -> Result<Vec<String>, String> {
    let capabilities = search_result
        .get("capabilities")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "search_sdk result is missing capabilities".to_string())?;

    let mut names = capabilities
        .iter()
        .filter(|item| {
            item.get("invocation_mode")
                .and_then(|value| value.as_str())
                .map(|value| value == "direct")
                .unwrap_or(false)
                && item
                    .get("status")
                    .and_then(|value| value.get("callable"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
        })
        .filter_map(|item| item.get("name").and_then(|value| value.as_str()))
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    if names.is_empty() {
        return Err(
            "search_sdk returned no callable direct capabilities; refine the search before execute_code_plan"
                .to_string(),
        );
    }

    names.sort();
    Ok(names)
}

pub(crate) async fn build_search_sdk_result(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    limit: usize,
) -> Value {
    crate::modules::mcp::commands::runtime::capability_discovery::build_capability_search_result(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        limit,
    )
    .await
}
