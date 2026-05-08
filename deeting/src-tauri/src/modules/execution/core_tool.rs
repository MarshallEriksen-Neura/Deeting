use super::config::ExecutionConfig;
use super::service::{ExecutionEngine, ExecutionService};
use super::types::ExecutionRequest;
use serde_json::{json, Value};
use std::path::PathBuf;

pub(crate) const SHELL_EXECUTE_TOOL_NAME: &str = "shell_execute";

const SHELL_EXECUTE_TOOL_DESCRIPTION: &str = "Execute commands in a background host execution runtime on the user's machine. This does not run inside the currently visible embedded terminal session and does not type into the terminal input buffer. Supports direct process execution, shell execution, and script execution. Automatically selects a platform shell when needed and decodes common terminal encodings.";

pub(crate) fn shell_execute_tool_description() -> &'static str {
    SHELL_EXECUTE_TOOL_DESCRIPTION
}

pub(crate) fn shell_execute_input_schema() -> Value {
    json!({
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
                "description": "Working directory for command execution."
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
    })
}

pub(crate) fn shell_execute_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "stdout": {"type": "string"},
            "stderr": {"type": "string"},
            "exit_code": {"type": "integer"},
            "command": {"type": "string"},
            "working_dir": {"type": "string"},
            "duration_ms": {"type": "integer"},
            "approval_level": {"type": "string"},
            "mode": {"type": "string"},
            "resolved_program": {"type": "string"},
            "resolved_args": {"type": "array", "items": {"type": "string"}},
            "shell_family": {"type": "string"},
            "encoding_stdout": {"type": "string"},
            "encoding_stderr": {"type": "string"},
            "diagnostics": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["stdout", "stderr", "exit_code", "command", "duration_ms", "approval_level"]
    })
}

pub(crate) fn shell_execute_example_arguments() -> Value {
    json!({
        "program": "git",
        "args": ["status"],
        "working_dir": "/home/user/project"
    })
}

pub fn get_shell_execute_tool_definition() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": SHELL_EXECUTE_TOOL_NAME,
            "description": shell_execute_tool_description(),
            "parameters": shell_execute_input_schema(),
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

#[cfg(test)]
mod tests {
    use super::{
        get_shell_execute_tool_definition, shell_execute_input_schema, shell_execute_output_schema,
        shell_execute_tool_description, SHELL_EXECUTE_TOOL_NAME,
    };
    use serde_json::Value;

    #[test]
    fn shell_execute_function_definition_uses_shared_contract_fields() {
        let definition = get_shell_execute_tool_definition();
        let function = definition
            .get("function")
            .and_then(Value::as_object)
            .expect("function object");

        assert_eq!(
            function.get("name").and_then(Value::as_str),
            Some(SHELL_EXECUTE_TOOL_NAME)
        );
        assert_eq!(
            function.get("description").and_then(Value::as_str),
            Some(shell_execute_tool_description())
        );
        assert_eq!(
            function.get("parameters").expect("parameters"),
            &shell_execute_input_schema()
        );
    }

    #[test]
    fn shell_execute_output_schema_keeps_observability_fields() {
        let output_schema = shell_execute_output_schema();
        let properties = output_schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("properties");

        for field in [
            "resolved_program",
            "resolved_args",
            "shell_family",
            "encoding_stdout",
            "encoding_stderr",
            "diagnostics",
            "warnings",
        ] {
            assert!(properties.contains_key(field), "missing field: {field}");
        }
    }
}
