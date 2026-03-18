use super::super::support::*;
use super::config::{apply_config_payload, read_local_mcp_config};

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json = read_local_mcp_config(&path)?;
            let config: McpConfigPayload = serde_json::from_str(&config_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
        McpSourceType::Skill => {
            return Err(McpError::validation(
                "skill-backed sources are managed internally and cannot be synced directly",
            ));
        }
        McpSourceType::Cloud
        | McpSourceType::Modelscope
        | McpSourceType::Github
        | McpSourceType::Url => {
            let mut request = state.transport.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "failed to fetch cloud config: {}",
                    response.status()
                )));
            }
            let config: McpConfigPayload = response
                .json()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
    };
    Ok(tools)
}
