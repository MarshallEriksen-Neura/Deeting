use super::super::support::*;
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
    let transport = StreamableHttpClientTransport::from_uri(sse_url);
    client_info()
        .serve(transport)
        .await
        .map_err(|err| err.to_string())
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
