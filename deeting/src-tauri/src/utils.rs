use crate::modules::mcp::error::McpError;
use mcp_storage::helpers::expand_path;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
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
    String::new()
}

pub fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
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
