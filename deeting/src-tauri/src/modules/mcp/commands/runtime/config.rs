use super::super::support::*;
use super::remote_transport::{
    list_local_stdio_tools, list_remote_sse_tools, RemoteDiscoveredTool,
};
use crate::modules::custom_task_agents::skill_actions::sanitize_callable_name;
use crate::modules::mcp::store::McpStore;
use std::collections::{HashMap, HashSet};

struct ToolUpsertSpec {
    identifier: String,
    name: String,
    service_key: String,
    service_display_name: String,
    service_description: Option<String>,
    capabilities: Vec<String>,
    description: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    config_json: String,
    config_hash: String,
    is_read_only: bool,
}

fn normalize_service_key(server_name: &str) -> String {
    let sanitized = sanitize_callable_name(server_name);
    if sanitized.trim().is_empty() {
        "mcp".to_string()
    } else {
        sanitized
    }
}

fn humanize_service_display_name(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => {
                    let mut word = first.to_uppercase().collect::<String>();
                    word.push_str(chars.as_str());
                    word
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn resolve_service_metadata(
    server_name: &str,
    server_config: &McpToolConfigPayload,
) -> (String, String, Option<String>) {
    let explicit_service_key = server_config
        .extra
        .get("service_key")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let explicit_display_name = server_config
        .extra
        .get("service_display_name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let explicit_description = server_config
        .extra
        .get("service_description")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let service_key = explicit_service_key
        .map(normalize_service_key)
        .unwrap_or_else(|| normalize_service_key(server_name));
    let service_display_name = explicit_display_name
        .map(str::to_string)
        .unwrap_or_else(|| humanize_service_display_name(server_name));
    let service_description = explicit_description.or_else(|| {
        server_config
            .description
            .clone()
            .filter(|value| !value.trim().is_empty())
    });

    (service_key, service_display_name, service_description)
}

fn legacy_server_identifier(source: &McpSource, server_name: &str) -> String {
    format!("{}/{}", source.id, server_name)
}

fn discovered_tool_identifier(
    source: &McpSource,
    transport_segment: &str,
    server_name: &str,
    tool_name: &str,
) -> String {
    format!(
        "{}/{}/{}/{}",
        source.id, transport_segment, server_name, tool_name
    )
}

async fn upsert_or_refresh_tool(
    store: &McpStore,
    source: &McpSource,
    existing_tool: Option<McpTool>,
    spec: ToolUpsertSpec,
) -> Result<McpTool, McpError> {
    match existing_tool {
        Some(existing_tool) if existing_tool.config_hash == spec.config_hash => {
            store
                .set_tool_status(&existing_tool.id, McpToolStatus::Healthy, None, None)
                .await?;
            Ok(existing_tool)
        }
        Some(existing_tool) => {
            store
                .upsert_tool(ToolUpsert {
                    id: Some(existing_tool.id.clone()),
                    source_id: source.id.clone(),
                    identifier: Some(spec.identifier),
                    name: spec.name,
                    service_key: Some(spec.service_key),
                    service_display_name: Some(spec.service_display_name),
                    service_description: spec.service_description,
                    source_type: source.source_type.clone(),
                    status: McpToolStatus::Healthy,
                    ping_ms: None,
                    capabilities: spec.capabilities,
                    description: spec.description,
                    error: None,
                    command: spec.command,
                    args: spec.args,
                    env: spec.env,
                    config_json: spec.config_json,
                    config_hash: spec.config_hash,
                    pending_config_json: None,
                    pending_config_hash: None,
                    conflict_status: McpConflictStatus::None,
                    is_read_only: spec.is_read_only,
                    is_new: existing_tool.is_new,
                })
                .await
        }
        None => {
            store
                .upsert_tool(ToolUpsert {
                    id: None,
                    source_id: source.id.clone(),
                    identifier: Some(spec.identifier),
                    name: spec.name,
                    service_key: Some(spec.service_key),
                    service_display_name: Some(spec.service_display_name),
                    service_description: spec.service_description,
                    source_type: source.source_type.clone(),
                    status: McpToolStatus::Healthy,
                    ping_ms: None,
                    capabilities: spec.capabilities,
                    description: spec.description,
                    error: None,
                    command: spec.command,
                    args: spec.args,
                    env: spec.env,
                    config_json: spec.config_json,
                    config_hash: spec.config_hash,
                    pending_config_json: None,
                    pending_config_hash: None,
                    conflict_status: McpConflictStatus::None,
                    is_read_only: spec.is_read_only,
                    is_new: true,
                })
                .await
        }
    }
}

fn build_discovered_tool_config_json(
    server_name: &str,
    service_key: &str,
    service_display_name: &str,
    service_description: Option<&str>,
    transport: &str,
    server_config: &McpToolConfigPayload,
    discovered: &RemoteDiscoveredTool,
) -> Result<String, McpError> {
    let mut config_value =
        serde_json::to_value(server_config).map_err(|err| McpError::Storage(err.to_string()))?;
    let Some(map) = config_value.as_object_mut() else {
        return Err(McpError::Storage(
            "MCP server config did not serialize to an object".to_string(),
        ));
    };
    map.insert(
        "transport".to_string(),
        serde_json::Value::String(transport.to_string()),
    );
    map.insert(
        "server_type".to_string(),
        serde_json::Value::String(transport.to_string()),
    );
    map.insert(
        "type".to_string(),
        serde_json::Value::String(transport.to_string()),
    );
    map.insert(
        "server_name".to_string(),
        serde_json::Value::String(server_name.to_string()),
    );
    map.insert(
        "source_entry_name".to_string(),
        serde_json::Value::String(server_name.to_string()),
    );
    map.insert(
        "service_key".to_string(),
        serde_json::Value::String(service_key.to_string()),
    );
    map.insert(
        "service_display_name".to_string(),
        serde_json::Value::String(service_display_name.to_string()),
    );
    if let Some(description) = service_description.filter(|value| !value.is_empty()) {
        map.insert(
            "service_description".to_string(),
            serde_json::Value::String(description.to_string()),
        );
    }
    if transport.eq_ignore_ascii_case("sse") {
        let sse_url = server_config.remote_sse_url().ok_or_else(|| {
            McpError::Validation(format!(
                "remote MCP server '{}' is missing sse url",
                server_name
            ))
        })?;
        map.insert(
            "sse_url".to_string(),
            serde_json::Value::String(sse_url.to_string()),
        );
        map.insert(
            "url".to_string(),
            serde_json::Value::String(sse_url.to_string()),
        );
        map.insert(
            "remote_tool_name".to_string(),
            serde_json::Value::String(discovered.name.clone()),
        );
    } else {
        map.insert(
            "runtime_protocol".to_string(),
            serde_json::Value::String("mcp".to_string()),
        );
        map.insert(
            "mcp_tool_name".to_string(),
            serde_json::Value::String(discovered.name.clone()),
        );
    }
    map.insert("input_schema".to_string(), discovered.input_schema.clone());
    serde_json::to_string(&config_value).map_err(|err| McpError::Storage(err.to_string()))
}

async fn delete_stale_discovered_tools(
    store: &McpStore,
    source: &McpSource,
    server_name: &str,
    transport_kind: McpTransportKind,
    desired_identifiers: &HashSet<String>,
    legacy_identifier: &str,
) -> Result<(), McpError> {
    let stale_ids = store
        .list_tools()
        .await?
        .into_iter()
        .filter(|tool| tool.source_id.as_deref() == Some(source.id.as_str()))
        .filter(|tool| {
            if tool.identifier.as_deref() == Some(legacy_identifier) {
                return true;
            }

            if tool.transport_kind() != transport_kind {
                return false;
            }

            if tool.remote_server_name().as_deref() != Some(server_name) {
                return false;
            }

            match tool.identifier.as_deref() {
                Some(identifier) => !desired_identifiers.contains(identifier),
                None => true,
            }
        })
        .map(|tool| tool.id)
        .collect::<Vec<_>>();

    if stale_ids.is_empty() {
        return Ok(());
    }

    store.delete_tools_by_ids(&stale_ids).await?;
    Ok(())
}

async fn upsert_remote_sse_tool(
    store: &McpStore,
    source: &McpSource,
    server_name: &str,
    server_config: &McpToolConfigPayload,
    discovered: &RemoteDiscoveredTool,
    is_read_only: bool,
) -> Result<McpTool, McpError> {
    let _sse_url = server_config.remote_sse_url().ok_or_else(|| {
        McpError::Validation(format!(
            "remote MCP server '{}' is missing sse url",
            server_name
        ))
    })?;
    let sanitized_name = sanitize_callable_name(&discovered.name);
    let identifier = discovered_tool_identifier(source, "remote", server_name, &sanitized_name);
    let (service_key, service_display_name, service_description) =
        resolve_service_metadata(server_name, server_config);
    let existing_tool = store
        .get_tool_by_source_identifier(&source.id, &identifier)
        .await?;
    let config_json = build_discovered_tool_config_json(
        server_name,
        &service_key,
        &service_display_name,
        service_description.as_deref(),
        "sse",
        server_config,
        discovered,
    )?;
    let config_hash = hash_config(&config_json);
    let capabilities = server_config.capabilities.clone().unwrap_or_default();
    let description = discovered
        .description
        .clone()
        .or_else(|| server_config.description.clone())
        .unwrap_or_default();

    upsert_or_refresh_tool(
        store,
        source,
        existing_tool,
        ToolUpsertSpec {
            identifier,
            name: sanitized_name,
            service_key,
            service_display_name,
            service_description,
            capabilities,
            description,
            command: None,
            args: None,
            env: None,
            config_json,
            config_hash,
            is_read_only,
        },
    )
    .await
}

async fn sync_remote_sse_tools(
    store: &McpStore,
    source: &McpSource,
    server_name: &str,
    server_config: &McpToolConfigPayload,
    is_read_only: bool,
) -> Result<Vec<McpTool>, McpError> {
    let sse_url = server_config.remote_sse_url().ok_or_else(|| {
        McpError::Validation(format!(
            "remote MCP server '{}' is missing sse url",
            server_name
        ))
    })?;
    let headers = server_config.remote_headers();
    let discovered = list_remote_sse_tools(sse_url, &headers)
        .await
        .map_err(McpError::Network)?;
    let desired_identifiers = discovered
        .iter()
        .map(|tool| discovered_tool_identifier(source, "remote", server_name, &tool.name))
        .collect::<HashSet<_>>();
    let legacy_identifier = legacy_server_identifier(source, server_name);
    delete_stale_discovered_tools(
        store,
        source,
        server_name,
        McpTransportKind::Sse,
        &desired_identifiers,
        &legacy_identifier,
    )
    .await?;
    let mut tools = Vec::with_capacity(discovered.len());
    for tool in discovered {
        tools.push(
            upsert_remote_sse_tool(
                store,
                source,
                server_name,
                server_config,
                &tool,
                is_read_only,
            )
            .await?,
        );
    }
    Ok(tools)
}

async fn upsert_local_stdio_tool(
    store: &McpStore,
    source: &McpSource,
    server_name: &str,
    server_config: &McpToolConfigPayload,
    discovered: &RemoteDiscoveredTool,
    is_read_only: bool,
) -> Result<McpTool, McpError> {
    let command = server_config.command.clone().ok_or_else(|| {
        McpError::Validation(format!(
            "stdio MCP server '{}' is missing command",
            server_name
        ))
    })?;
    let sanitized_name = sanitize_callable_name(&discovered.name);
    let identifier = discovered_tool_identifier(source, "stdio", server_name, &sanitized_name);
    let (service_key, service_display_name, service_description) =
        resolve_service_metadata(server_name, server_config);
    let existing_tool = store
        .get_tool_by_source_identifier(&source.id, &identifier)
        .await?;
    let config_json = build_discovered_tool_config_json(
        server_name,
        &service_key,
        &service_display_name,
        service_description.as_deref(),
        "stdio",
        server_config,
        discovered,
    )?;
    let config_hash = hash_config(&config_json);
    let capabilities = server_config.capabilities.clone().unwrap_or_default();
    let description = discovered
        .description
        .clone()
        .or_else(|| server_config.description.clone())
        .unwrap_or_default();
    let args = server_config.args.clone();
    let env = server_config.env.clone();

    upsert_or_refresh_tool(
        store,
        source,
        existing_tool,
        ToolUpsertSpec {
            identifier,
            name: sanitized_name,
            service_key,
            service_display_name,
            service_description,
            capabilities,
            description,
            command: Some(command),
            args,
            env,
            config_json,
            config_hash,
            is_read_only,
        },
    )
    .await
}

async fn sync_local_stdio_tools(
    store: &McpStore,
    source: &McpSource,
    server_name: &str,
    server_config: &McpToolConfigPayload,
    is_read_only: bool,
) -> Result<Vec<McpTool>, McpError> {
    let command = server_config.command.clone().ok_or_else(|| {
        McpError::Validation(format!(
            "stdio MCP server '{}' is missing command",
            server_name
        ))
    })?;
    let args = server_config.args.clone().unwrap_or_default();
    let discovered = list_local_stdio_tools(&command, &args, server_config.env.as_ref())
        .await
        .map_err(McpError::Network)?;
    let desired_identifiers = discovered
        .iter()
        .map(|tool| discovered_tool_identifier(source, "stdio", server_name, &tool.name))
        .collect::<HashSet<_>>();
    let legacy_identifier = legacy_server_identifier(source, server_name);
    delete_stale_discovered_tools(
        store,
        source,
        server_name,
        McpTransportKind::Stdio,
        &desired_identifiers,
        &legacy_identifier,
    )
    .await?;
    let mut tools = Vec::with_capacity(discovered.len());
    for tool in discovered {
        tools.push(
            upsert_local_stdio_tool(
                store,
                source,
                server_name,
                server_config,
                &tool,
                is_read_only,
            )
            .await?,
        );
    }
    Ok(tools)
}

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

pub(crate) async fn apply_config_payload_to_store(
    store: &McpStore,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::new();
    let is_read_only = source.source_type == McpSourceType::Cloud;

    for (name, config) in payload.mcp_servers {
        if config.transport_kind() == McpTransportKind::Sse {
            tools.extend(sync_remote_sse_tools(store, source, &name, &config, is_read_only).await?);
            continue;
        }

        if config.transport_kind() == McpTransportKind::Stdio && config.command.is_some() {
            tools
                .extend(sync_local_stdio_tools(store, source, &name, &config, is_read_only).await?);
            continue;
        }

        let identifier = legacy_server_identifier(source, &name);
        let (service_key, service_display_name, service_description) =
            resolve_service_metadata(&name, &config);
        let existing_tool = store.get_tool_by_source_name(&source.id, &name).await?;
        let mut config_value =
            serde_json::to_value(&config).unwrap_or(serde_json::Value::Object(Default::default()));
        if let Some(map) = config_value.as_object_mut() {
            map.insert(
                "service_key".to_string(),
                serde_json::Value::String(service_key.clone()),
            );
            map.insert(
                "service_display_name".to_string(),
                serde_json::Value::String(service_display_name.clone()),
            );
            if let Some(description) = service_description
                .as_ref()
                .filter(|value| !value.is_empty())
            {
                map.insert(
                    "service_description".to_string(),
                    serde_json::Value::String(description.clone()),
                );
            }
        }
        let config_json = serde_json::to_string(&config_value).unwrap();
        let config_hash = hash_config(&config_json);

        let tool = upsert_or_refresh_tool(
            store,
            source,
            existing_tool,
            ToolUpsertSpec {
                identifier,
                name: name,
                service_key,
                service_display_name,
                service_description,
                capabilities: config.capabilities.unwrap_or_default(),
                description: config.description.unwrap_or_default(),
                command: config.command,
                args: config.args,
                env: config.env,
                config_json,
                config_hash,
                is_read_only,
            },
        )
        .await?;
        tools.push(tool);
    }

    Ok(tools)
}

pub(crate) async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    apply_config_payload_to_store(state.store.as_ref(), source, payload).await
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
