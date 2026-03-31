use super::{write_temp_script, PreparedCommand};
use crate::modules::execution::types::{ExecutionError, ExecutionShell};

pub fn build_shell_command(
    shell: ExecutionShell,
    command: &str,
) -> Result<PreparedCommand, ExecutionError> {
    let (program, args) = match shell {
        ExecutionShell::Auto | ExecutionShell::Cmd => (
            "cmd.exe".to_string(),
            vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                command.to_string(),
            ],
        ),
        ExecutionShell::Powershell => (
            "powershell.exe".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                command.to_string(),
            ],
        ),
        ExecutionShell::Pwsh => (
            "pwsh".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                command.to_string(),
            ],
        ),
        ExecutionShell::Sh => (
            "sh".to_string(),
            vec!["-c".to_string(), command.to_string()],
        ),
        ExecutionShell::Bash => (
            "bash".to_string(),
            vec!["-lc".to_string(), command.to_string()],
        ),
        ExecutionShell::Zsh => (
            "zsh".to_string(),
            vec!["-lc".to_string(), command.to_string()],
        ),
    };

    Ok(PreparedCommand {
        program,
        args,
        cleanup_path: None,
    })
}

pub fn prepare_script(
    shell: ExecutionShell,
    script: &str,
) -> Result<PreparedCommand, ExecutionError> {
    match shell {
        ExecutionShell::Auto | ExecutionShell::Cmd => {
            let path = write_temp_script("cmd", script)?;
            Ok(PreparedCommand {
                program: "cmd.exe".to_string(),
                args: vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/C".to_string(),
                    path.to_string_lossy().to_string(),
                ],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Powershell => {
            let path = write_temp_script("ps1", script)?;
            Ok(PreparedCommand {
                program: "powershell.exe".to_string(),
                args: vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-File".to_string(),
                    path.to_string_lossy().to_string(),
                ],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Pwsh => {
            let path = write_temp_script("ps1", script)?;
            Ok(PreparedCommand {
                program: "pwsh".to_string(),
                args: vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-File".to_string(),
                    path.to_string_lossy().to_string(),
                ],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Sh => {
            let path = write_temp_script("sh", script)?;
            Ok(PreparedCommand {
                program: "sh".to_string(),
                args: vec![path.to_string_lossy().to_string()],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Bash => {
            let path = write_temp_script("sh", script)?;
            Ok(PreparedCommand {
                program: "bash".to_string(),
                args: vec![path.to_string_lossy().to_string()],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Zsh => {
            let path = write_temp_script("sh", script)?;
            Ok(PreparedCommand {
                program: "zsh".to_string(),
                args: vec![path.to_string_lossy().to_string()],
                cleanup_path: Some(path),
            })
        }
    }
}
