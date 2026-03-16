//! 命令构建器 - 跨平台命令构建

use std::env;

/// 命令构建器
pub struct CommandBuilder;

impl CommandBuilder {
    /// 构建命令和参数
    ///
    /// 根据平台自动选择 shell:
    /// - Windows: cmd.exe /C
    /// - Unix: sh -c
    pub fn build(command: &str, args: &[String]) -> (String, Vec<String>) {
        let full_command = if args.is_empty() {
            command.to_string()
        } else {
            format!("{} {}", command, args.join(" "))
        };

        if cfg!(target_os = "windows") {
            // Windows: 使用 cmd.exe
            ("cmd.exe".to_string(), vec!["/C".to_string(), full_command])
        } else {
            // Unix/Linux/macOS: 使用 sh
            ("sh".to_string(), vec!["-c".to_string(), full_command])
        }
    }

    /// 构建命令并返回完整命令字符串(用于日志)
    pub fn build_command_string(command: &str, args: &[String]) -> String {
        let (program, program_args) = Self::build(command, args);

        if program_args.is_empty() {
            program
        } else {
            format!("{} {}", program, program_args.join(" "))
        }
    }
}
