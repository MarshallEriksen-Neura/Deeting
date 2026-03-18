use super::*;
use mcp_core::types::{McpTool, McpToolStatus};
use mcp_registry::types::LocalCapabilityRegistryUpsert;

impl McpStore {
    pub async fn sync_mcp_tool_registry_entry(&self, tool: &McpTool) -> Result<i64, McpError> {
        let generation = self.next_local_capability_registry_generation().await?;
        let entry = build_mcp_tool_registry_entry(tool, generation);
        self.replace_local_capability_registry_entries(&tool.id, &[entry])
            .await
    }

    pub async fn sync_all_mcp_tool_registry_entries(&self) -> Result<i64, McpError> {
        let tools = self.list_tools().await?;
        let generation = self.next_local_capability_registry_generation().await?;
        let mut registry_packages = self
            .list_local_capability_registry_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.source_kind == "mcp")
            .map(|entry| entry.package_id)
            .collect::<std::collections::BTreeSet<_>>();
        let mut count = 0i64;
        for tool in tools {
            let entry = build_mcp_tool_registry_entry(&tool, generation);
            count += self
                .replace_local_capability_registry_entries(&tool.id, &[entry])
                .await?;
            registry_packages.remove(&tool.id);
        }
        for stale_package in registry_packages {
            count += self
                .delete_local_capability_registry_entries(&stale_package)
                .await?;
        }
        Ok(count)
    }
}

fn mcp_tool_runtime_state(tool: &McpTool) -> &'static str {
    match tool.status {
        McpToolStatus::Healthy | McpToolStatus::Degraded => "ready",
        McpToolStatus::Stopped => "stopped",
        McpToolStatus::Pending | McpToolStatus::Starting | McpToolStatus::Updating => "pending",
        McpToolStatus::Crashed | McpToolStatus::Error | McpToolStatus::Orphaned => "error",
    }
}

fn build_mcp_tool_registry_entry(tool: &McpTool, generation: i64) -> LocalCapabilityRegistryUpsert {
    let runtime_state = mcp_tool_runtime_state(tool);
    LocalCapabilityRegistryUpsert {
        capability_id: tool.id.clone(),
        source_kind: "mcp".to_string(),
        asset_kind: "mcp_tool".to_string(),
        package_id: tool.id.clone(),
        package_version: None,
        title: tool.name.clone(),
        description: tool.description.clone(),
        tool_name: Some(tool.name.clone()),
        callable_name: None,
        binding_kind: None,
        execution_surface: tool.transport_label().to_string(),
        runtime: Some(tool.transport_label().to_string()),
        entry_path: tool.command.clone(),
        is_direct_callable: runtime_state == "ready",
        activation_state: "enabled".to_string(),
        runtime_state: runtime_state.to_string(),
        search_index_state: "not_required".to_string(),
        generation,
        descriptor_json: serde_json::json!({
            "tool_id": tool.id,
            "source_id": tool.source_id,
            "identifier": tool.identifier,
            "tool_name": tool.name,
            "description": tool.description,
            "transport": tool.transport_label(),
            "remote_sse_url": tool.remote_sse_url(),
            "remote_tool_name": tool.remote_tool_name(),
            "remote_server_name": tool.remote_server_name(),
            "capabilities": tool.capabilities,
            "read_only": tool.is_read_only,
            "command": tool.command,
            "args": tool.args,
            "status": tool.status.as_str(),
            "activation_state": "enabled",
            "runtime_state": runtime_state,
            "search_index_state": "not_required",
        })
        .to_string(),
    }
}
