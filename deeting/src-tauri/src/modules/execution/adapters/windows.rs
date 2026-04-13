use super::{write_temp_script, PreparedCommand};
use crate::modules::execution::types::{ExecutionError, ExecutionShell};

const CMD_UTF8_PREFIX: &str = "chcp 65001>nul & set PYTHONIOENCODING=utf-8 & set PYTHONUTF8=1 & ";
const CMD_SCRIPT_UTF8_PREAMBLE: &str =
    "@chcp 65001>nul\r\n@set PYTHONIOENCODING=utf-8\r\n@set PYTHONUTF8=1\r\n";
const POWERSHELL_UTF8_PREAMBLE: &str = concat!(
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); ",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); ",
    "$env:PYTHONIOENCODING = 'utf-8'; ",
    "$env:PYTHONUTF8 = '1'; "
);

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
                "/U".to_string(),
                "/C".to_string(),
                wrap_cmd_command(command),
            ],
        ),
        ExecutionShell::Powershell => (
            "powershell.exe".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                wrap_powershell_command(command),
            ],
        ),
        ExecutionShell::Pwsh => (
            "pwsh".to_string(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                wrap_powershell_command(command),
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
            let path = write_temp_script("cmd", &wrap_cmd_script(script))?;
            Ok(PreparedCommand {
                program: "cmd.exe".to_string(),
                args: vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/U".to_string(),
                    "/C".to_string(),
                    path.to_string_lossy().to_string(),
                ],
                cleanup_path: Some(path),
            })
        }
        ExecutionShell::Powershell => {
            let path = write_temp_script("ps1", "")?;
            write_utf8_bom_script(&path, &wrap_powershell_script(script))?;
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
            let path = write_temp_script("ps1", "")?;
            write_utf8_bom_script(&path, &wrap_powershell_script(script))?;
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

fn wrap_cmd_command(command: &str) -> String {
    format!("{CMD_UTF8_PREFIX}{command}")
}

fn wrap_cmd_script(script: &str) -> String {
    format!("{CMD_SCRIPT_UTF8_PREAMBLE}{script}")
}

fn wrap_powershell_command(command: &str) -> String {
    format!("{POWERSHELL_UTF8_PREAMBLE}{command}")
}

fn wrap_powershell_script(script: &str) -> String {
    format!("{POWERSHELL_UTF8_PREAMBLE}{script}")
}

fn write_utf8_bom_script(path: &std::path::Path, script: &str) -> Result<(), ExecutionError> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(script.as_bytes());
    std::fs::write(path, bytes).map_err(|err| ExecutionError::ExecutionFailed(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        build_shell_command, prepare_script, wrap_cmd_command, wrap_powershell_command,
        CMD_UTF8_PREFIX, POWERSHELL_UTF8_PREAMBLE,
    };
    use crate::modules::execution::types::ExecutionShell;

    #[test]
    fn cmd_shell_command_enables_unicode_output() {
        let prepared =
            build_shell_command(ExecutionShell::Cmd, "echo 你好").expect("build cmd shell command");
        let expected = wrap_cmd_command("echo 你好");
        assert_eq!(prepared.program, "cmd.exe");
        assert!(prepared.args.iter().any(|arg| arg == "/U"));
        assert_eq!(
            prepared.args.last().map(String::as_str),
            Some(expected.as_str())
        );
        assert!(prepared
            .args
            .last()
            .is_some_and(|arg| arg.starts_with(CMD_UTF8_PREFIX)));
    }

    #[test]
    fn powershell_shell_command_sets_utf8_console_encoding() {
        let prepared = build_shell_command(ExecutionShell::Powershell, "Write-Output '你好'")
            .expect("build powershell shell command");
        let expected = wrap_powershell_command("Write-Output '你好'");
        assert_eq!(prepared.program, "powershell.exe");
        assert_eq!(
            prepared.args.last().map(String::as_str),
            Some(expected.as_str())
        );
        assert!(prepared
            .args
            .last()
            .is_some_and(|arg| arg.starts_with(POWERSHELL_UTF8_PREAMBLE)));
    }

    #[test]
    fn powershell_script_is_written_with_utf8_bom() {
        let prepared = prepare_script(ExecutionShell::Powershell, "Write-Output '你好'")
            .expect("prepare powershell script");
        let path = prepared.cleanup_path.expect("cleanup path");
        let bytes = std::fs::read(&path).expect("read script bytes");
        std::fs::remove_file(&path).expect("remove temp script");

        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        let decoded = String::from_utf8(bytes[3..].to_vec()).expect("decode utf-8 script");
        assert!(decoded.starts_with(POWERSHELL_UTF8_PREAMBLE));
        assert!(decoded.contains("Write-Output '你好'"));
    }
}
