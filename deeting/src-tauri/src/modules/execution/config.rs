use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    #[serde(default = "default_max_timeout_seconds")]
    pub max_timeout_seconds: u64,

    #[serde(default = "default_max_script_bytes")]
    pub max_script_bytes: usize,

    #[serde(default = "default_allowed_paths")]
    pub allowed_paths: Vec<String>,

    #[serde(default = "default_forbidden_paths")]
    pub forbidden_paths: Vec<String>,

    #[serde(default = "default_auto_approve_exact_commands")]
    pub auto_approve_exact_commands: Vec<String>,

    #[serde(default = "default_denied_patterns")]
    pub denied_patterns: Vec<String>,

    #[serde(default = "default_dangerous_patterns")]
    pub dangerous_patterns: Vec<String>,

    #[serde(default = "default_audit_enabled")]
    pub audit_enabled: bool,

    #[serde(default = "default_audit_log_file")]
    pub audit_log_file: String,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            max_timeout_seconds: default_max_timeout_seconds(),
            max_script_bytes: default_max_script_bytes(),
            allowed_paths: default_allowed_paths(),
            forbidden_paths: default_forbidden_paths(),
            auto_approve_exact_commands: default_auto_approve_exact_commands(),
            denied_patterns: default_denied_patterns(),
            dangerous_patterns: default_dangerous_patterns(),
            audit_enabled: default_audit_enabled(),
            audit_log_file: default_audit_log_file(),
        }
    }
}

fn default_max_timeout_seconds() -> u64 {
    1800
}

fn default_max_script_bytes() -> usize {
    256 * 1024
}

fn default_allowed_paths() -> Vec<String> {
    vec![
        "$HOME".to_string(),
        "$HOME/Documents".to_string(),
        "$HOME/Desktop".to_string(),
        "$HOME/Projects".to_string(),
        "$HOME/workspace".to_string(),
    ]
}

fn default_forbidden_paths() -> Vec<String> {
    vec![
        "/etc".to_string(),
        "/usr".to_string(),
        "/bin".to_string(),
        "/sbin".to_string(),
        "C:\\Windows".to_string(),
        "C:\\Program Files".to_string(),
        "C:\\Program Files (x86)".to_string(),
    ]
}

fn default_auto_approve_exact_commands() -> Vec<String> {
    vec![
        "git status".to_string(),
        "git log".to_string(),
        "git diff".to_string(),
        "git branch".to_string(),
        "ls".to_string(),
        "dir".to_string(),
        "cat".to_string(),
        "pwd".to_string(),
        "echo".to_string(),
        "node --version".to_string(),
        "npm --version".to_string(),
        "python --version".to_string(),
    ]
}

fn default_denied_patterns() -> Vec<String> {
    vec![
        "rm -rf /".to_string(),
        "rm -rf /*".to_string(),
        "del /s /q c:\\".to_string(),
        "curl | bash".to_string(),
        "wget | sh".to_string(),
        ":(){ :|:& };:".to_string(),
    ]
}

fn default_dangerous_patterns() -> Vec<String> {
    vec![
        "rm -rf".to_string(),
        "sudo".to_string(),
        "chmod 777".to_string(),
        "mkfs".to_string(),
        "dd if=".to_string(),
        "> /dev/sd".to_string(),
        "format ".to_string(),
        "reg delete".to_string(),
        "diskpart".to_string(),
    ]
}

fn default_audit_enabled() -> bool {
    true
}

fn default_audit_log_file() -> String {
    "$APP_DATA/deeting/logs/execution.log".to_string()
}
