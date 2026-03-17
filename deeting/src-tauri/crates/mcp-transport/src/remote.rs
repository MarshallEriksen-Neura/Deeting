use futures_util::StreamExt;
use log::warn;
use rmcp::{
    model::{CallToolRequestParams, ClientInfo, Implementation},
    service::{RoleClient, RunningService},
    transport::{
        child_process::TokioChildProcess, streamable_http_client::StreamableHttpClientTransport,
    },
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::io::AsyncBufReadExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDiscoveredTool {
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
                if looks_like_legacy_sse_endpoint_url(sse_url) {
                    match connect_legacy_sse_proxy_client(sse_url).await {
                        Ok(proxy_client) => return Ok(proxy_client),
                        Err(proxy_error) => {
                            return Err(format!(
                                "{}; legacy SSE proxy fallback failed: {}",
                                primary_error, proxy_error
                            ));
                        }
                    }
                }
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

            match connect_legacy_sse_proxy_client(sse_url).await {
                Ok(proxy_client) => Ok(proxy_client),
                Err(proxy_error) => Err(format!(
                    "{}; legacy SSE proxy fallback failed: {}",
                    streamable_error, proxy_error
                )),
            }
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
        match connect_local_stdio_client(&command, &args, None).await {
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
    let (transport, stderr_handle) = TokioChildProcess::builder(child_command)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;
    if let Some(stderr) = stderr_handle {
        let command_label = if args.is_empty() {
            command.to_string()
        } else {
            format!("{} {}", command, args.join(" "))
        };
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            let mut line_count = 0usize;
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    warn!(
                        "mcp subprocess stderr command='{}' line='{}'",
                        command_label, trimmed
                    );
                }
                line_count += 1;
                if line_count >= 30 {
                    break;
                }
            }
        });
    }
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

fn looks_like_legacy_sse_endpoint_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .map(|parsed| parsed.path().trim_end_matches('/').ends_with("/sse"))
        .unwrap_or(false)
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn binary_name_variants(binary_name: &str) -> Vec<String> {
    if cfg!(target_os = "windows") {
        return vec![
            format!("{}{}", binary_name, ".cmd"),
            format!("{}{}", binary_name, ".exe"),
            format!("{}{}", binary_name, ".bat"),
            binary_name.to_string(),
        ];
    }
    vec![binary_name.to_string()]
}

fn append_binary_from_dir(candidates: &mut Vec<String>, directory: &Path, variants: &[String]) {
    for variant in variants {
        let candidate = directory.join(variant);
        if is_executable_file(&candidate) {
            let candidate = candidate.to_string_lossy().to_string();
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
}

fn discover_binary_paths(binary_name: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let variants = binary_name_variants(binary_name);

    if let Ok(path_env) = std::env::var("PATH") {
        for segment in std::env::split_paths(&path_env) {
            if segment.as_os_str().is_empty() {
                continue;
            }
            append_binary_from_dir(&mut candidates, &segment, &variants);
        }
    }

    let mut static_dirs = Vec::new();
    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            static_dirs.push(PathBuf::from(app_data).join("npm"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            static_dirs.push(
                PathBuf::from(local_app_data)
                    .join("Programs")
                    .join("nodejs"),
            );
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            static_dirs.push(PathBuf::from(program_files).join("nodejs"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            static_dirs.push(PathBuf::from(program_files_x86).join("nodejs"));
        }
    } else {
        for prefix in [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/opt/homebrew/bin",
            "/opt/local/bin",
        ] {
            static_dirs.push(PathBuf::from(prefix));
        }
    }
    for directory in static_dirs {
        append_binary_from_dir(&mut candidates, &directory, &variants);
    }

    if let Ok(nvm_bin) = std::env::var("NVM_BIN") {
        append_binary_from_dir(&mut candidates, &PathBuf::from(nvm_bin), &variants);
    }

    if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
        let nvm_versions_dir = PathBuf::from(nvm_dir).join("versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
            let mut nvm_candidates = Vec::new();
            for entry in entries.flatten() {
                for variant in &variants {
                    let candidate = entry.path().join("bin").join(variant);
                    if is_executable_file(&candidate) {
                        nvm_candidates.push(candidate.to_string_lossy().to_string());
                    }
                }
            }
            nvm_candidates.sort();
            nvm_candidates.reverse();
            for candidate in nvm_candidates {
                if !candidates.contains(&candidate) {
                    candidates.push(candidate);
                }
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let nvm_versions_dir = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
            let mut nvm_candidates = Vec::new();
            for entry in entries.flatten() {
                for variant in &variants {
                    let candidate = entry.path().join("bin").join(variant);
                    if is_executable_file(&candidate) {
                        nvm_candidates.push(candidate.to_string_lossy().to_string());
                    }
                }
            }
            nvm_candidates.sort();
            nvm_candidates.reverse();
            for candidate in nvm_candidates {
                if !candidates.contains(&candidate) {
                    candidates.push(candidate);
                }
            }
        }
    }

    candidates
}

fn is_windows_cmd_script(command: &str) -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    let normalized = command.to_ascii_lowercase();
    normalized.ends_with(".cmd") || normalized.ends_with(".bat")
}

fn push_unique_command_candidate(
    candidates: &mut Vec<(String, Vec<String>)>,
    command: String,
    args: Vec<String>,
) {
    if !candidates.iter().any(|(existing_command, existing_args)| {
        existing_command == &command && existing_args == &args
    }) {
        candidates.push((command, args));
    }
}

fn legacy_sse_proxy_command_candidates(sse_url: &str) -> Vec<(String, Vec<String>)> {
    let mut candidates = Vec::new();
    let direct_args = vec![
        sse_url.to_string(),
        "--transport".to_string(),
        "sse-only".to_string(),
    ];
    let npx_args = vec![
        "-y".to_string(),
        "mcp-remote".to_string(),
        sse_url.to_string(),
        "--transport".to_string(),
        "sse-only".to_string(),
    ];

    for command in discover_binary_paths("mcp-remote") {
        if is_windows_cmd_script(&command) {
            push_unique_command_candidate(&mut candidates, "cmd".to_string(), {
                let mut args = vec!["/C".to_string(), "call".to_string(), command];
                args.extend(direct_args.clone());
                args
            });
        } else {
            push_unique_command_candidate(&mut candidates, command, direct_args.clone());
        }
    }
    for command in discover_binary_paths("npx") {
        if is_windows_cmd_script(&command) {
            push_unique_command_candidate(
                &mut candidates,
                "cmd".to_string(),
                vec![
                    "/C".to_string(),
                    "call".to_string(),
                    command,
                    "-y".to_string(),
                    "mcp-remote".to_string(),
                    sse_url.to_string(),
                    "--transport".to_string(),
                    "sse-only".to_string(),
                ],
            );
        } else {
            push_unique_command_candidate(&mut candidates, command, npx_args.clone());
        }
    }

    push_unique_command_candidate(
        &mut candidates,
        "mcp-remote".to_string(),
        direct_args.clone(),
    );
    push_unique_command_candidate(&mut candidates, "npx".to_string(), npx_args.clone());
    if cfg!(target_os = "windows") {
        push_unique_command_candidate(
            &mut candidates,
            "cmd".to_string(),
            vec![
                "/C".to_string(),
                "npx".to_string(),
                "-y".to_string(),
                "mcp-remote".to_string(),
                sse_url.to_string(),
                "--transport".to_string(),
                "sse-only".to_string(),
            ],
        );
    }

    candidates
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

pub async fn list_remote_sse_tools(sse_url: &str) -> Result<Vec<RemoteDiscoveredTool>, String> {
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

pub async fn call_remote_sse_tool(
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

pub async fn list_local_stdio_tools(
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

pub async fn call_local_stdio_tool(
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
        legacy_sse_proxy_command_candidates, looks_like_legacy_sse_endpoint_url,
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
    fn detects_legacy_sse_endpoint_url() {
        assert!(looks_like_legacy_sse_endpoint_url(
            "https://mcp.example.com/abc123/sse"
        ));
        assert!(!looks_like_legacy_sse_endpoint_url(
            "https://mcp.example.com/mcp"
        ));
    }

    #[test]
    fn builds_legacy_sse_proxy_command_candidates() {
        let candidates = legacy_sse_proxy_command_candidates("https://mcp.example.com/abc123/sse");
        assert!(candidates.iter().any(|item| item.0 == "mcp-remote"
            && item.1
                == vec![
                    "https://mcp.example.com/abc123/sse".to_string(),
                    "--transport".to_string(),
                    "sse-only".to_string()
                ]));
        assert!(candidates.iter().any(|item| item.0 == "npx"
            && item.1
                == vec![
                    "-y".to_string(),
                    "mcp-remote".to_string(),
                    "https://mcp.example.com/abc123/sse".to_string(),
                    "--transport".to_string(),
                    "sse-only".to_string()
                ]));
    }
}
