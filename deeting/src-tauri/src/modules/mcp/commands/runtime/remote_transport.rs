use super::super::support::*;
use futures_util::StreamExt;
use rmcp::{
    model::{CallToolRequestParams, ClientInfo, Implementation},
    service::{RoleClient, RunningService},
    transport::{
        child_process::TokioChildProcess, streamable_http_client::StreamableHttpClientTransport,
    },
    ServiceExt,
};
use std::{collections::HashMap, process::Stdio};

#[derive(Debug, Clone)]
pub(crate) struct RemoteDiscoveredTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

async fn connect_sse_client(
    sse_url: &str,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    match connect_streamable_http_client(sse_url).await {
        Ok(client) => Ok(client),
        Err(primary_error) => {
            if !is_http_405_method_not_allowed_error(&primary_error) {
                return Err(primary_error);
            }

            let fallback_candidates = collect_legacy_sse_fallback_candidates(sse_url).await;
            if fallback_candidates.is_empty() {
                return Err(primary_error);
            }

            let mut last_fallback_error: Option<(String, String)> = None;
            for candidate in fallback_candidates {
                if candidate == sse_url {
                    continue;
                }
                match connect_streamable_http_client(&candidate).await {
                    Ok(client) => {
                        warn!(
                            "remote MCP fallback succeeded after HTTP 405: original='{}' fallback='{}'",
                            sse_url, candidate
                        );
                        return Ok(client);
                    }
                    Err(err) => {
                        warn!(
                            "remote MCP fallback candidate failed after HTTP 405: original='{}' fallback='{}' err={}",
                            sse_url, candidate, err
                        );
                        last_fallback_error = Some((candidate, err));
                    }
                }
            }

            let streamable_error = if let Some((candidate, err)) = last_fallback_error {
                format!(
                    "{}; fallback from '{}' to '{}' also failed: {}",
                    primary_error, sse_url, candidate, err
                )
            } else {
                primary_error
            };

            if let Ok(proxy_client) = connect_legacy_sse_proxy_client(sse_url).await {
                return Ok(proxy_client);
            }

            Err(streamable_error)
        }
    }
}

async fn connect_streamable_http_client(
    url: &str,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    let transport = StreamableHttpClientTransport::from_uri(url);
    client_info()
        .serve(transport)
        .await
        .map_err(|err| err.to_string())
}

async fn connect_legacy_sse_proxy_client(
    sse_url: &str,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    let mut last_error: Option<String> = None;
    for (command, args) in legacy_sse_proxy_command_candidates(sse_url) {
        match connect_local_stdio_client(command, &args, None).await {
            Ok(client) => {
                warn!(
                    "remote MCP legacy SSE proxy fallback succeeded: url='{}' command='{}'",
                    sse_url, command
                );
                return Ok(client);
            }
            Err(err) => {
                warn!(
                    "remote MCP legacy SSE proxy fallback failed: url='{}' command='{}' err={}",
                    sse_url, command, err
                );
                last_error = Some(format!("{}: {}", command, err));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "no proxy command candidates".to_string()))
}

async fn connect_local_stdio_client(
    command: &str,
    args: &[String],
    env: Option<&HashMap<String, String>>,
) -> Result<RunningService<RoleClient, ClientInfo>, String> {
    let mut child_command = tokio::process::Command::new(command);
    child_command.args(args);
    if let Some(env) = env {
        child_command.envs(env);
    }
    let (transport, _stderr) = TokioChildProcess::builder(child_command)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;
    client_info()
        .serve(transport)
        .await
        .map_err(|err| err.to_string())
}

fn client_info() -> ClientInfo {
    let mut client_info = ClientInfo::default();
    client_info.client_info = Implementation::new("deeting-desktop", env!("CARGO_PKG_VERSION"));
    client_info
}

fn is_http_405_method_not_allowed_error(error_text: &str) -> bool {
    let normalized = error_text.to_ascii_lowercase();
    normalized.contains("http 405") || normalized.contains("405 method not allowed")
}

fn legacy_sse_proxy_command_candidates(sse_url: &str) -> Vec<(&'static str, Vec<String>)> {
    vec![
        ("mcp-remote", vec![sse_url.to_string()]),
        (
            "npx",
            vec![
                "-y".to_string(),
                "mcp-remote".to_string(),
                sse_url.to_string(),
            ],
        ),
    ]
}

fn build_url_with_same_origin(origin: &reqwest::Url, endpoint: &str) -> Option<String> {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        return Some(endpoint.to_string());
    }

    if endpoint.starts_with('/') {
        let host = origin.host_str()?;
        let mut result = format!("{}://{}", origin.scheme(), host);
        if let Some(port) = origin.port() {
            result.push(':');
            result.push_str(&port.to_string());
        }
        result.push_str(endpoint);
        return Some(result);
    }

    origin.join(endpoint).ok().map(|value| value.to_string())
}

fn extract_legacy_sse_endpoint_path(payload: &str) -> Option<String> {
    for line in payload.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data.is_empty() {
            continue;
        }
        if data.contains("session_id=")
            && (data.starts_with('/')
                || data.starts_with("http://")
                || data.starts_with("https://"))
        {
            return Some(data.to_string());
        }
    }
    None
}

async fn discover_legacy_sse_message_endpoint_url(sse_url: &str) -> Option<String> {
    let origin = reqwest::Url::parse(sse_url).ok()?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .ok()?;
    let response = client
        .get(sse_url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    for _ in 0..6 {
        let chunk = stream.next().await?;
        let chunk = chunk.ok()?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        if let Some(endpoint) = extract_legacy_sse_endpoint_path(&buffer) {
            return build_url_with_same_origin(&origin, &endpoint);
        }
    }
    None
}

fn heuristic_streamable_http_fallback_urls(sse_url: &str) -> Vec<String> {
    let parsed = match reqwest::Url::parse(sse_url) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut candidates = Vec::new();
    let normalized_path = parsed.path().trim_end_matches('/');

    if let Some(prefix) = normalized_path.strip_suffix("/sse") {
        let mut candidate = parsed.clone();
        let fallback_path = if prefix.is_empty() {
            "/mcp".to_string()
        } else {
            format!("{}/mcp", prefix)
        };
        candidate.set_path(&fallback_path);
        candidate.set_query(None);
        candidates.push(candidate.to_string());
    }

    let mut root_mcp = parsed;
    root_mcp.set_path("/mcp");
    root_mcp.set_query(None);
    candidates.push(root_mcp.to_string());
    candidates
}

async fn collect_legacy_sse_fallback_candidates(sse_url: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(discovered) = discover_legacy_sse_message_endpoint_url(sse_url).await {
        candidates.push(discovered);
    }
    for candidate in heuristic_streamable_http_fallback_urls(sse_url) {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn normalized_call_arguments(
    arguments: &Value,
    label: &str,
) -> Result<Option<serde_json::Map<String, Value>>, String> {
    match arguments {
        Value::Null => Ok(None),
        Value::Object(map) => Ok(Some(map.clone())),
        _ => Err(format!("{} arguments must be a JSON object", label)),
    }
}

pub(crate) async fn list_remote_sse_tools(
    sse_url: &str,
) -> Result<Vec<RemoteDiscoveredTool>, String> {
    let mut client = connect_sse_client(sse_url).await?;
    let result = client
        .peer()
        .list_all_tools()
        .await
        .map_err(|err| err.to_string())
        .map(|tools| {
            tools
                .into_iter()
                .map(|tool| RemoteDiscoveredTool {
                    name: tool.name.into_owned(),
                    description: tool.description.map(|value| value.into_owned()),
                    input_schema: Value::Object(tool.input_schema.as_ref().clone()),
                })
                .collect()
        });
    let _ = client.close().await;
    result
}

pub(crate) async fn call_remote_sse_tool(
    sse_url: &str,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let args = normalized_call_arguments(arguments, "remote MCP tool")?;
    let mut client = connect_sse_client(sse_url).await?;
    let request = args.map_or_else(
        || CallToolRequestParams::new(tool_name.to_string()),
        |arguments| CallToolRequestParams::new(tool_name.to_string()).with_arguments(arguments),
    );
    let response = client
        .peer()
        .call_tool(request)
        .await
        .map_err(|err| err.to_string())?;
    let _ = client.close().await;
    serde_json::to_value(response).map_err(|err| err.to_string())
}

pub(crate) async fn list_local_stdio_tools(
    command: &str,
    args: &[String],
    env: Option<&HashMap<String, String>>,
) -> Result<Vec<RemoteDiscoveredTool>, String> {
    let mut client = connect_local_stdio_client(command, args, env).await?;
    let result = client
        .peer()
        .list_all_tools()
        .await
        .map_err(|err| err.to_string())
        .map(|tools| {
            tools
                .into_iter()
                .map(|tool| RemoteDiscoveredTool {
                    name: tool.name.into_owned(),
                    description: tool.description.map(|value| value.into_owned()),
                    input_schema: Value::Object(tool.input_schema.as_ref().clone()),
                })
                .collect()
        });
    let _ = client.close().await;
    result
}

pub(crate) async fn call_local_stdio_tool(
    command: &str,
    args: &[String],
    env: Option<&HashMap<String, String>>,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let normalized_arguments = normalized_call_arguments(arguments, "local stdio MCP tool")?;
    let mut client = connect_local_stdio_client(command, args, env).await?;
    let request = normalized_arguments.map_or_else(
        || CallToolRequestParams::new(tool_name.to_string()),
        |arguments| CallToolRequestParams::new(tool_name.to_string()).with_arguments(arguments),
    );
    let response = client
        .peer()
        .call_tool(request)
        .await
        .map_err(|err| err.to_string())?;
    let _ = client.close().await;
    serde_json::to_value(response).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_url_with_same_origin, extract_legacy_sse_endpoint_path,
        heuristic_streamable_http_fallback_urls, is_http_405_method_not_allowed_error,
        legacy_sse_proxy_command_candidates,
    };

    #[test]
    fn detects_http_405_method_not_allowed_error_text() {
        assert!(is_http_405_method_not_allowed_error(
            "unexpected server response: HTTP 405 Method Not Allowed: Method Not Allowed"
        ));
        assert!(!is_http_405_method_not_allowed_error(
            "unexpected server response: HTTP 404 Not Found"
        ));
    }

    #[test]
    fn extracts_legacy_sse_endpoint_path() {
        let payload =
            "event: endpoint\ndata: /messages/?session_id=abc123\n\n: ping - 2026-03-13\n\n";
        assert_eq!(
            extract_legacy_sse_endpoint_path(payload).as_deref(),
            Some("/messages/?session_id=abc123")
        );
    }

    #[test]
    fn builds_absolute_fallback_url_from_relative_endpoint() {
        let origin = reqwest::Url::parse("https://mcp.example.com/project/sse").unwrap();
        assert_eq!(
            build_url_with_same_origin(&origin, "/messages/?session_id=test").as_deref(),
            Some("https://mcp.example.com/messages/?session_id=test")
        );
    }

    #[test]
    fn derives_streamable_http_heuristic_fallback_urls() {
        let candidates =
            heuristic_streamable_http_fallback_urls("https://mcp.example.com/abc123/sse");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0], "https://mcp.example.com/abc123/mcp");
        assert_eq!(candidates[1], "https://mcp.example.com/mcp");
    }

    #[test]
    fn builds_legacy_sse_proxy_command_candidates() {
        let candidates = legacy_sse_proxy_command_candidates("https://mcp.example.com/abc123/sse");
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].0, "mcp-remote");
        assert_eq!(candidates[0].1, vec!["https://mcp.example.com/abc123/sse"]);
        assert_eq!(candidates[1].0, "npx");
        assert_eq!(
            candidates[1].1,
            vec!["-y", "mcp-remote", "https://mcp.example.com/abc123/sse"]
        );
    }
}
