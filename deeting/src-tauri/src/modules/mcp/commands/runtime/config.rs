use super::super::support::*;

pub(crate) fn read_local_mcp_config(path: &Path) -> Result<String, McpError> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)
                    .map_err(|create_err| McpError::Storage(create_err.to_string()))?;
            }
            let default_config = r#"{"mcpServers":{}}"#;
            std::fs::write(path, default_config)
                .map_err(|write_err| McpError::Storage(write_err.to_string()))?;
            Ok(default_config.to_string())
        }
        Err(err) => Err(McpError::Storage(err.to_string())),
    }
}

pub(crate) async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::new();
    let is_read_only = source.source_type == McpSourceType::Cloud;

    for (name, config) in payload.mcp_servers {
        let identifier = format!("{}/{}", source.id, name);
        let existing_tool = state.store.get_tool_by_source_name(&source.id, &name).await?;

        let tool = match existing_tool {
            Some(existing_tool) => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                if config_hash == existing_tool.config_hash {
                    state
                        .store
                        .set_tool_status(&existing_tool.id, McpToolStatus::Healthy, None, None)
                        .await?;
                    existing_tool
                } else {
                    state
                        .store
                        .upsert_tool(ToolUpsert {
                            id: Some(existing_tool.id.clone()),
                            source_id: source.id.clone(),
                            identifier: Some(identifier),
                            name: name.clone(),
                            source_type: source.source_type.clone(),
                            status: McpToolStatus::Healthy,
                            ping_ms: None,
                            capabilities: config.capabilities.clone().unwrap_or_default(),
                            description: config.description.clone().unwrap_or_default(),
                            error: None,
                            command: config.command.clone(),
                            args: config.args.clone(),
                            env: config.env.clone(),
                            config_json,
                            config_hash,
                            pending_config_json: None,
                            pending_config_hash: None,
                            conflict_status: McpConflictStatus::None,
                            is_read_only,
                            is_new: existing_tool.is_new,
                        })
                        .await?
                }
            }
            None => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                state
                    .store
                    .upsert_tool(ToolUpsert {
                        id: None,
                        source_id: source.id.clone(),
                        identifier: Some(identifier),
                        name: name.clone(),
                        source_type: source.source_type.clone(),
                        status: McpToolStatus::Healthy,
                        ping_ms: None,
                        capabilities: config.capabilities.unwrap_or_default(),
                        description: config.description.unwrap_or_default(),
                        error: None,
                        command: config.command,
                        args: config.args,
                        env: config.env,
                        config_json,
                        config_hash,
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: McpConflictStatus::None,
                        is_read_only,
                        is_new: true,
                    })
                    .await?
            }
        };
        tools.push(tool);
    }

    Ok(tools)
}

pub(crate) fn hash_config(config_json: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(config_json.as_bytes());
    hex::encode(hasher.finalize())
}

pub(crate) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

