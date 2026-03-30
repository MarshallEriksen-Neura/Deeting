use crate::modules::mcp::error::McpError;
use mcp_storage::helpers::expand_path;
use serde::Serialize;
use std::error::Error as StdError;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::Duration;
use tauri::Manager;
use tokio::process::Command as TokioCommand;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn resolve_database_url<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<String, McpError> {
    let db_path = non_empty_env("DESKTOP_DB_PATH").unwrap_or_else(|| default_db_path(app));
    if db_path == ":memory:" {
        return Ok("sqlite::memory:".to_string());
    }
    if db_path.starts_with("sqlite:") {
        return Ok(db_path);
    }
    let expanded = expand_path(&db_path);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|err| McpError::Storage(err.to_string()))?
            .join(expanded)
    };
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).map_err(|err| McpError::Storage(err.to_string()))?;
    }
    Ok(path_to_sqlite_url(&absolute))
}

pub fn configure_background_std_command(
    #[cfg(not(target_os = "windows"))] _command: &mut StdCommand,
    #[cfg(target_os = "windows")] command: &mut StdCommand,
) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn configure_background_tokio_command(command: &mut TokioCommand) {
    configure_background_std_command(command.as_std_mut());
}

pub fn default_db_path<R: tauri::Runtime>(app: &tauri::App<R>) -> String {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        return app_data_dir
            .join("deeting.db")
            .to_string_lossy()
            .to_string();
    }
    if let Some(home) = non_empty_env("HOME") {
        return format!("{home}/.config/deeting/deeting.db");
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        return format!("{user_profile}/.config/deeting/deeting.db");
    }
    "deeting.db".to_string()
}

pub fn resolve_lancedb_uri<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<String, McpError> {
    let path = non_empty_env("DESKTOP_LANCEDB_PATH").unwrap_or_else(|| default_lancedb_path(app));
    let expanded = expand_path(&path);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|err| McpError::Storage(err.to_string()))?
            .join(expanded)
    };
    std::fs::create_dir_all(&absolute).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(absolute.to_string_lossy().to_string())
}

pub fn resolve_boxrun_home_dir<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<PathBuf, McpError> {
    if let Some(path) = non_empty_env("BOXRUN_HOME") {
        let expanded = expand_path(&path);
        let absolute = if expanded.is_absolute() {
            expanded
        } else {
            std::env::current_dir()
                .map_err(|err| McpError::Storage(err.to_string()))?
                .join(expanded)
        };
        std::fs::create_dir_all(&absolute).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(absolute);
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let path = app_data_dir.join("boxrun");
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    if let Some(home) = non_empty_env("HOME") {
        let path = PathBuf::from(format!("{home}/.boxrun"));
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        let path = PathBuf::from(format!("{user_profile}/.boxrun"));
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    let path = PathBuf::from(".boxrun");
    std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(path)
}

pub fn default_lancedb_path<R: tauri::Runtime>(app: &tauri::App<R>) -> String {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        return app_data_dir
            .join("memory_lancedb")
            .to_string_lossy()
            .to_string();
    }
    if let Some(home) = non_empty_env("HOME") {
        return format!("{home}/.config/deeting/memory_lancedb");
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        return format!("{user_profile}/.config/deeting/memory_lancedb");
    }
    "memory_lancedb".to_string()
}

pub fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn path_to_sqlite_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    format!("sqlite:{normalized}")
}

pub fn resolve_cloud_base_url() -> String {
    std::env::var("NEXT_PUBLIC_API_BASE_URL")
        .unwrap_or_else(|_| "https://api.ethereals.space".to_string())
}

pub fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTransportDiagnostic {
    pub ok: bool,
    pub url: String,
    pub status: Option<u16>,
    pub message: String,
    pub error_code: Option<String>,
    pub source_chain: Vec<String>,
    pub is_timeout: bool,
    pub is_connect: bool,
    pub is_request: bool,
}

#[tauri::command]
pub async fn diagnose_auth_desktop_browser_start_request() -> Result<HttpTransportDiagnostic, String>
{
    let base_url = resolve_cloud_base_url();
    let url = format!(
        "{}/api/v1/auth/desktop/browser/start",
        base_url.trim().trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| err.to_string())?;

    let payload = serde_json::json!({
        "return_scheme": "deeting",
        "platform": "desktop",
    });

    match client.post(&url).json(&payload).send().await {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let message = if status.is_success() {
                format!("HTTP {}", status.as_u16())
            } else {
                extract_response_message(&body)
                    .unwrap_or_else(|| format!("HTTP {} {}", status.as_u16(), body.trim()))
            };

            Ok(HttpTransportDiagnostic {
                ok: status.is_success(),
                url,
                status: Some(status.as_u16()),
                message,
                error_code: if status.is_success() {
                    None
                } else {
                    Some(format!("HTTP_{}", status.as_u16()))
                },
                source_chain: Vec::new(),
                is_timeout: false,
                is_connect: false,
                is_request: false,
            })
        }
        Err(err) => {
            let source_chain = collect_error_sources(&err);
            let primary_source = source_chain
                .first()
                .cloned()
                .unwrap_or_else(|| err.to_string());

            Ok(HttpTransportDiagnostic {
                ok: false,
                url,
                status: err.status().map(|status| status.as_u16()),
                message: primary_source,
                error_code: Some(classify_reqwest_error(&err).to_string()),
                source_chain,
                is_timeout: err.is_timeout(),
                is_connect: err.is_connect(),
                is_request: err.is_request(),
            })
        }
    }
}

fn collect_error_sources(err: &reqwest::Error) -> Vec<String> {
    let mut sources = Vec::new();
    let mut current = err.source();
    while let Some(source) = current {
        let text = source.to_string();
        if !text.trim().is_empty() {
            sources.push(text);
        }
        current = source.source();
    }
    sources
}

fn classify_reqwest_error(err: &reqwest::Error) -> &'static str {
    let text = err.to_string().to_ascii_lowercase();
    if err.is_timeout() || text.contains("timed out") || text.contains("timeout") {
        "REQWEST_TIMEOUT"
    } else if text.contains("proxy") || text.contains("tunnel") || text.contains("407") {
        "REQWEST_PROXY"
    } else if text.contains("certificate")
        || text.contains("tls")
        || text.contains("ssl")
        || text.contains("handshake")
        || text.contains("unknown issuer")
        || text.contains("invalid peer certificate")
    {
        "REQWEST_TLS"
    } else if text.contains("dns")
        || text.contains("lookup")
        || text.contains("no such host")
        || text.contains("getaddrinfo")
        || text.contains("failed to lookup address information")
    {
        "REQWEST_DNS"
    } else if err.is_connect()
        || text.contains("connection refused")
        || text.contains("actively refused")
    {
        "REQWEST_CONNECT"
    } else if text.contains("connection reset")
        || text.contains("unexpected eof")
        || text.contains("broken pipe")
        || text.contains("connection closed")
    {
        "REQWEST_CONNECTION_RESET"
    } else {
        "REQWEST_TRANSPORT"
    }
}

fn extract_response_message(body: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok()?;

    if let Some(message) = parsed.get("message").and_then(serde_json::Value::as_str) {
        let message = message.trim();
        if !message.is_empty() {
            return Some(message.to_string());
        }
    }

    if let Some(error) = parsed.get("error").and_then(serde_json::Value::as_str) {
        let error = error.trim();
        if !error.is_empty() {
            return Some(error.to_string());
        }
    }

    if let Some(detail) = parsed.get("detail") {
        if let Some(detail_text) = detail.as_str() {
            let detail_text = detail_text.trim();
            if !detail_text.is_empty() {
                return Some(detail_text.to_string());
            }
        }

        if let Some(items) = detail.as_array() {
            let messages = items
                .iter()
                .filter_map(|item| {
                    item.get("msg")
                        .and_then(serde_json::Value::as_str)
                        .or_else(|| item.get("message").and_then(serde_json::Value::as_str))
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>();

            if !messages.is_empty() {
                return Some(messages.join("; "));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::path_to_sqlite_url;
    use std::path::PathBuf;

    #[test]
    fn sqlite_url_for_relative_path_keeps_filename() {
        let path = PathBuf::from("deeting.db");
        let url = path_to_sqlite_url(&path);
        assert_eq!(url, "sqlite:deeting.db");
    }

    #[test]
    fn sqlite_url_for_absolute_path_matches_sqlx_format() {
        let path = if cfg!(windows) {
            PathBuf::from(r"C:\Users\timeline\.config\deeting\deeting.db")
        } else {
            PathBuf::from("/home/timeline/.config/deeting/deeting.db")
        };
        let url = path_to_sqlite_url(&path);
        if cfg!(windows) {
            assert_eq!(url, "sqlite:C:/Users/timeline/.config/deeting/deeting.db");
        } else {
            assert_eq!(url, "sqlite:/home/timeline/.config/deeting/deeting.db");
        }
    }
}
