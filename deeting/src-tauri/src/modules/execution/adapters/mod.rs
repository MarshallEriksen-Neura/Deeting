use super::types::{ExecutionError, ExecutionShell};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct PreparedCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cleanup_path: Option<PathBuf>,
}

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
mod posix;

pub fn build_shell_command(
    shell: ExecutionShell,
    command: &str,
) -> Result<PreparedCommand, ExecutionError> {
    #[cfg(target_os = "windows")]
    {
        windows::build_shell_command(shell, command)
    }

    #[cfg(not(target_os = "windows"))]
    {
        posix::build_shell_command(shell, command)
    }
}

pub fn prepare_script(
    shell: ExecutionShell,
    script: &str,
) -> Result<PreparedCommand, ExecutionError> {
    #[cfg(target_os = "windows")]
    {
        windows::prepare_script(shell, script)
    }

    #[cfg(not(target_os = "windows"))]
    {
        posix::prepare_script(shell, script)
    }
}

fn write_temp_script(extension: &str, script: &str) -> Result<PathBuf, ExecutionError> {
    let dir = std::env::temp_dir().join("deeting-execution");
    std::fs::create_dir_all(&dir)
        .map_err(|err| ExecutionError::ExecutionFailed(err.to_string()))?;
    let path = dir.join(format!(
        "exec-{}.{}",
        uuid::Uuid::new_v4(),
        extension.trim_start_matches('.')
    ));
    std::fs::write(&path, script)
        .map_err(|err| ExecutionError::ExecutionFailed(err.to_string()))?;

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o700);
        std::fs::set_permissions(&path, permissions)
            .map_err(|err| ExecutionError::ExecutionFailed(err.to_string()))?;
    }

    Ok(path)
}
