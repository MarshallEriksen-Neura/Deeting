use super::config::ExecutionConfig;
use super::service::{ExecutionEngine, ExecutionService};
use super::types::ExecutionRequest;
use serde_json::{json, Value};
use std::path::PathBuf;

pub fn get_shell_execute_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "shell_execute",
            "description": "Execute commands on the user's machine through a cross-platform execution runtime. Supports direct process execution, shell execution, and script execution. Automatically selects a platform shell when needed (Windows: cmd or powershell, Linux/macOS: sh) and decodes common terminal encodings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["process", "shell", "script"],
                        "description": "Optional execution mode. Omit to let the runtime infer process vs shell vs script."
                    },
                    "shell": {
                        "type": "string",
                        "enum": ["auto", "cmd", "powershell", "pwsh", "sh", "bash", "zsh"],
                        "description": "Optional shell family for shell/script modes."
                    },
                    "command": {
                        "type": "string",
                        "description": "Command text. For compatibility, this may be either a shell command string or a program name when paired with args."
                    },
                    "program": {
                        "type": "string",
                        "description": "Program name for direct process execution."
                    },
                    "script": {
                        "type": "string",
                        "description": "Script body for script execution."
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional argv list for direct process execution."
                    },
                    "working_dir": {
                        "type": "string",
                        "description": "Working directory for command execution. Must be within allowed paths."
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "description": "Execution timeout in seconds.",
                        "default": 300,
                        "minimum": 5,
                        "maximum": 1800
                    },
                    "env": {
                        "type": "object",
                        "additionalProperties": { "type": "string" },
                        "description": "Environment variables for command execution."
                    }
                },
                "anyOf": [
                    { "required": ["command"] },
                    { "required": ["program"] },
                    { "required": ["script"] }
                ]
            }
        }
    })
}

pub struct ShellExecuteCoreTool {
    engine: Box<dyn ExecutionEngine>,
}

impl ShellExecuteCoreTool {
    pub fn new(home_dir: PathBuf) -> Self {
        Self {
            engine: Box::new(ExecutionService::new(home_dir, None)),
        }
    }

    pub fn new_with_config(home_dir: PathBuf, config: ExecutionConfig) -> Self {
        Self {
            engine: Box::new(ExecutionService::new(home_dir, Some(config))),
        }
    }

    pub async fn execute_request(&self, request: ExecutionRequest) -> Result<Value, String> {
        let result = self
            .engine
            .execute(request)
            .await
            .map_err(|err| err.to_string())?;
        serde_json::to_value(result).map_err(|err| format!("Failed to serialize result: {err}"))
    }

    pub async fn execute(&self, arguments: Value) -> Result<Value, String> {
        let request: ExecutionRequest =
            serde_json::from_value(arguments).map_err(|err| format!("Invalid arguments: {err}"))?;
        self.execute_request(request).await
    }

    pub fn assess_risk(
        &self,
        request: &ExecutionRequest,
    ) -> crate::modules::mcp::ToolRiskAssessment {
        self.engine.assess_risk(request)
    }

    pub fn definition() -> Value {
        get_shell_execute_tool_definition()
    }
}
